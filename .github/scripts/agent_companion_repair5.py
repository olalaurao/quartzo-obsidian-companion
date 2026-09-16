from pathlib import Path
import re


def read(p): return Path(p).read_text(encoding='utf-8')
def write(p, s): Path(p).write_text(s, encoding='utf-8')
def once(s, old, new, label):
    if old not in s:
        raise SystemExit(f'missing patch target: {label}')
    return s.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Drive operation idempotency / rename target safety.
# Runs after repair1, which provides errorStatus/listNamedChildren and boundary
# guards.
# ---------------------------------------------------------------------------
adapter_path = 'src/integrations/google/drive/adapter.ts'
adapter = read(adapter_path)
start = adapter.index('  async deleteFile(')
end = adapter.index('  async resolveExactPath(', start)
replacement = r'''  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.assertInsideSelectedVault(fileId);
    } catch (error) {
      if (this.errorStatus(error) === 404) return; // retry after a committed delete
      throw error;
    }
    try {
      await this.withRetry(async () => {
        const driveClient = this.getDriveClient();
        await driveClient.files.delete({ fileId });
      });
    } catch (error) {
      if (this.errorStatus(error) === 404) return;
      throw error;
    }
  }

  async renameFile(fileId: string, newName: string, newParentId?: string): Promise<DriveFileMetadata> {
    await this.assertInsideSelectedVault(fileId);
    if (newParentId) await this.assertInsideSelectedVault(newParentId);

    return this.withRetry(async () => {
      const driveClient = this.getDriveClient();
      const currentResponse = await driveClient.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      });
      const current = currentResponse.data;
      const currentParents = current.parents || [];

      if (newParentId) {
        const parent = this.escapeQueryParam(newParentId);
        const name = this.escapeQueryParam(newName);
        let pageToken: string | undefined;
        const collisions: string[] = [];
        do {
          const response = await driveClient.files.list({
            q: `'${parent}' in parents and name = '${name}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id)',
            pageSize: 100,
            pageToken
          });
          for (const candidate of response.data.files || []) {
            if (candidate.id && candidate.id !== fileId) collisions.push(candidate.id);
          }
          pageToken = response.data.nextPageToken || undefined;
        } while (pageToken);
        if (collisions.length > 0) {
          throw new Error(`Ambiguous remote rename target: ${newName} already exists under ${newParentId}`);
        }
      }

      const alreadyAtTarget = current.name === newName &&
        (!newParentId || currentParents.includes(newParentId));
      if (alreadyAtTarget) {
        return {
          id: current.id || fileId,
          name: current.name || newName,
          mimeType: current.mimeType || '',
          modifiedTime: current.modifiedTime || new Date().toISOString(),
          md5Checksum: current.md5Checksum || undefined,
          parents: current.parents || undefined,
          quartzoHash: this.extractQuartzoHash(current)
        };
      }

      const movingParent = !!newParentId && !currentParents.includes(newParentId);
      const response = await driveClient.files.update({
        fileId,
        requestBody: { name: newName },
        addParents: movingParent ? newParentId : undefined,
        removeParents: movingParent && currentParents.length > 0 ? currentParents.join(',') : undefined,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      });
      const data = response.data;
      return {
        id: data.id || fileId,
        name: data.name || newName,
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash: this.extractQuartzoHash(data)
      };
    });
  }

'''
adapter = adapter[:start] + replacement + adapter[end:]
write(adapter_path, adapter)

# ---------------------------------------------------------------------------
# Coordinator: fail closed on full/incremental duplicate identities, treat a
# move into excluded scope as remote absence, expand folder changes to tracked
# descendants, preflight local rename destinations, and route focus triggers
# through canonical coalescing.
# ---------------------------------------------------------------------------
coord_path = 'src/sync/coordinator/index.ts'
coord = read(coord_path)

# A full scan with ambiguity cannot establish a safe baseline/change token.
needle = """    for (const [localPath, localFile] of localInventory) {
"""
insert = """    if (this.quarantinedPaths.size > 0) {
      throw new Error(`Ambiguous remote path identity detected for: ${[...this.quarantinedPaths].join(', ')}`);
    }

    for (const [localPath, localFile] of localInventory) {
"""
coord = once(coord, needle, insert, 'full inventory ambiguity abort')

# Folder changes can move many descendants without individual file changes.
folder_hook = """        if (!change.file) continue;
        const remotePath = await this.resolveRemotePath(change.file, driveFolderId);
"""
folder_replacement = """        if (!change.file) continue;

        if (change.file.mimeType === 'application/vnd.google-apps.folder') {
          const queuedIds = new Set(response.changes.map(candidate => candidate.fileId));
          for (const tracked of this.syncState.files.values()) {
            if (!tracked.remoteFileId || queuedIds.has(tracked.remoteFileId)) continue;
            try {
              const metadata = await this.driveAdapter.getFileMetadata(tracked.remoteFileId);
              response.changes.push({ fileId: tracked.remoteFileId, removed: false, file: metadata });
              queuedIds.add(tracked.remoteFileId);
            } catch {
              // A missing tracked child will be handled by its own removed change;
              // do not infer deletion from a metadata read failure.
            }
          }
          continue;
        }

        const remotePath = await this.resolveRemotePath(change.file, driveFolderId);
"""
coord = once(coord, folder_hook, folder_replacement, 'folder change expansion')

# An excluded path is outside sync scope even when still under the Drive root.
old_scope = """        const normalizedRemote = normalizeVaultPath(remotePath);
        if (!VaultSyncFilePolicy.shouldSyncFile(normalizedRemote)) continue;

        const hasAncestry = await this.proveAncestryToRoot(change.file, driveFolderId);
"""
new_scope = """        const normalizedRemote = normalizeVaultPath(remotePath);
        if (!VaultSyncFilePolicy.shouldSyncFile(normalizedRemote)) {
          const trackedFile = this.findSyncFileByRemoteId(change.file.id);
          if (trackedFile) {
            this.syncState.files.delete(trackedFile.path);
            const localHash = localInventory.get(trackedFile.path)?.hash || null;
            if (localHash && localHash === trackedFile.baseHash) {
              await this.deleteLocalFile(trackedFile.path);
              result.synced++;
            } else if (localHash) {
              result.conflicts++;
              trackedFile.remoteFileId = null;
              trackedFile.remoteExists = false;
              await this.handleConflict(trackedFile.path, { hash: localHash, exists: true }, undefined, trackedFile);
            }
          }
          continue;
        }

        const hasAncestry = await this.proveAncestryToRoot(change.file, driveFolderId);
"""
coord = once(coord, old_scope, new_scope, 'excluded remote scope removal')

# Before applying a remote change at a path, reject a different tracked remote
# ID already owning that exact path. Throwing keeps the Changes token unadvanced.
identity_guard = """        let localFile = localInventory.get(normalizedRemote);
        let syncFile = this.syncState.files.get(normalizedRemote);
"""
identity_replacement = """        const pathOwner = this.syncState.files.get(normalizedRemote);
        if (pathOwner?.remoteFileId && pathOwner.remoteFileId !== change.file.id) {
          throw new Error(`Ambiguous incremental remote identity for ${normalizedRemote}: ${pathOwner.remoteFileId} vs ${change.file.id}`);
        }

        let localFile = localInventory.get(normalizedRemote);
        let syncFile = pathOwner;
"""
coord = once(coord, identity_guard, identity_replacement, 'incremental duplicate identity guard')

# Preflight local rename targets using a recursive inventory so Drive cannot
# silently create duplicate path identities.
coord = once(coord,
"""    const remainingRenames: PendingRename[] = [];
    for (const rename of this.pendingRenames) {
""",
"""    const remainingRenames: PendingRename[] = [];
    let renameRemoteInventory: DriveFileMetadata[] | null = null;
    for (const rename of this.pendingRenames) {
""",
'local rename inventory cache')
coord = once(coord,
"""      const newLocalFile = localInventory.get(rename.newPath);
      if (newLocalFile) {
        try {
          const newFileName = rename.newPath.split('/').pop() || rename.newPath;
""",
"""      const newLocalFile = localInventory.get(rename.newPath);
      if (newLocalFile) {
        try {
          if (!renameRemoteInventory) renameRemoteInventory = await this.driveAdapter.listAllFiles(driveFolderId);
          const targetIds: string[] = [];
          for (const candidate of renameRemoteInventory) {
            const candidatePath = await this.resolveRemotePath(candidate, driveFolderId);
            if (candidatePath && normalizeVaultPath(candidatePath) === rename.newPath && candidate.id !== oldSyncFile.remoteFileId) {
              targetIds.push(candidate.id);
            }
          }
          if (targetIds.length > 0) {
            throw new Error(`Ambiguous remote rename target ${rename.newPath}: ${targetIds.join(', ')}`);
          }

          const newFileName = rename.newPath.split('/').pop() || rename.newPath;
""",
'local rename target preflight')

# Focus/watcher/interval triggers use the same canonical coalescing path.
old_focus = """  async triggerFocusSync(): Promise<SyncResult> {
    if (!this.syncMutex) {
      return this.reconcile();
    }
    return { synced: 0, conflicts: 0, errors: ['Sync already in progress'] };
  }
"""
new_focus = """  async triggerFocusSync(): Promise<SyncResult> {
    return this.reconcile();
  }
"""
coord = once(coord, old_focus, new_focus, 'focus coalescing')
write(coord_path, coord)

# ---------------------------------------------------------------------------
# Main composition: auth state must not claim success without durable refresh;
# pairing validates a marked Quartzo vault and only commits after all decisions
# succeed; excluded files never wake sync; _deleted stays out of the live index.
# ---------------------------------------------------------------------------
main_path = 'src/main.ts'
main = read(main_path)
main = once(main,
"import { normalizeVaultPath } from './sync/coordinator/path-utils';",
"import { normalizeVaultPath } from './sync/coordinator/path-utils';\nimport { VaultSyncFilePolicy } from './sync/coordinator/file-policy';",
'main policy import')

# Move authenticating state after client-id validation.
main = once(main,
"""  async startPairingFlow() {
    this.authState = 'authenticating';
    const clientId = this.getResolvedClientId();
    if (!clientId || clientId === 'PLACEHOLDER_CLIENT_ID') {
      new Notice('Configure your Google OAuth Client ID in settings first.');
      return;
    }

    const config = { ...OAUTH_CONFIG, clientId };
""",
"""  async startPairingFlow() {
    const clientId = this.getResolvedClientId();
    if (!clientId || clientId === 'PLACEHOLDER_CLIENT_ID') {
      this.authState = 'disconnected';
      new Notice('Configure your Google OAuth Client ID in settings first.');
      return;
    }

    this.authState = 'authenticating';
    const config = { ...OAUTH_CONFIG, clientId };
""",
'auth state after validation')
main = once(main,
"""          new Notice('No refresh token received. Please re-authorize with full access.');
          await this.oauthClient.disconnect();
          return;
""",
"""          new Notice('No refresh token received. Please re-authorize with full access.');
          await this.oauthClient.disconnect();
          this.driveAdapter?.setAccessToken('');
          this.authState = 'disconnected';
          return;
""",
'missing refresh rollback')
# firstRunCompleted belongs to successful pairing, not auth-only.
main = once(main,
"""      this.settings.firstRunCompleted = true;
      this.authState = 'authenticated_unpaired';
      await this.saveSettings();

      new Notice('Google Drive authenticated. Select your vault folder.');
""",
"""      this.authState = 'authenticated_unpaired';
      new Notice('Google Drive authenticated. Select your vault folder.');
""",
'first run pairing completion timing')

# Validate the selected ID is still an explicit marked Quartzo candidate.
main = once(main,
"""    await this.driveSyncCoordinator.setDriveFolderId(folderId);
    this.settings.googleDriveFolderId = folderId;
    this.settings.googleDriveFolderName = folderName;

    const summary = await this.driveSyncCoordinator.generatePairingSummary();
""",
"""    const candidates = await this.driveAdapter.listQuartzoVaultCandidates();
    const selected = candidates.find(candidate => candidate.id === folderId);
    if (!selected) {
      new Notice('Pairing blocked: the selected folder is no longer a valid Quartzo vault.');
      return;
    }

    await this.driveSyncCoordinator.setDriveFolderId(folderId);
    this.settings.googleDriveFolderId = folderId;
    this.settings.googleDriveFolderName = selected.name || folderName;

    const summary = await this.driveSyncCoordinator.generatePairingSummary();
""",
'pairing folder validation')

# Both direct and modal decision paths must remain unpaired on partial failure.
main = once(main,
"""      await this.driveSyncCoordinator.applyPairingDecisions(summary, { autoAdopt, autoPull });
      this.settings.isPaired = true;
      this.authState = 'paired';
      await this.saveSettings();
""",
"""      const pairingResult = await this.driveSyncCoordinator.applyPairingDecisions(summary, { autoAdopt, autoPull });
      if (pairingResult.errors.length > 0) {
        new Notice(`Pairing incomplete: ${pairingResult.errors.join('; ')}`);
        return;
      }
      this.settings.isPaired = true;
      this.settings.firstRunCompleted = true;
      this.authState = 'paired';
      await this.saveSettings();
""",
'direct pairing result check')
main = once(main,
"""          await this.driveSyncCoordinator!.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });
          this.settings.isPaired = true;
          await this.saveSettings();
""",
"""          const pairingResult = await this.driveSyncCoordinator!.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });
          if (pairingResult.errors.length > 0) {
            new Notice(`Pairing incomplete: ${pairingResult.errors.join('; ')}`);
            return;
          }
          this.settings.isPaired = true;
          this.settings.firstRunCompleted = true;
          this.authState = 'paired';
          await this.saveSettings();
""",
'modal pairing result check')

# Disconnect must reset in-memory auth state too.
main = once(main,
"""    this.settings.isPaired = false;
    this.settings.googleDriveFolderId = null;
""",
"""    this.settings.isPaired = false;
    this.authState = 'disconnected';
    this.settings.googleDriveFolderId = null;
""",
'disconnect auth state')

# Live index excludes device/sync artifacts plus canonical tombstones.
helper_marker = '  private async initializeVaultIndex() {'
helper = """  private shouldIndexPath(rawPath: string): boolean {
    const normalized = normalizeVaultPath(rawPath);
    if (normalized === '_deleted' || normalized.startsWith('_deleted/')) return false;
    return VaultSyncFilePolicy.shouldSyncFile(normalized);
  }

"""
main = main.replace(helper_marker, helper + helper_marker, 1)
main = once(main,
"    const files = this.app.vault.getMarkdownFiles();",
"    const files = this.app.vault.getMarkdownFiles().filter(file => this.shouldIndexPath(file.path));",
'initial live index filter')
main = main.replace(
"if (file instanceof TFile && this.vaultIndexEngine) {",
"if (file instanceof TFile && this.vaultIndexEngine && this.shouldIndexPath(file.path)) {",
3)

# Replace live-index rename handling so excluded -> live also indexes correctly.
old_index_rename = """    const onrename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile && this.vaultIndexEngine) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.vaultIndexEngine.setIndex(
            VaultIndexEngine.updateIndex(idx, [
              { type: 'deleted', path: normalizeVaultPath(oldPath) },
              { type: 'added', path: normalizeVaultPath(file.path) }
            ])
          );
        }
      }
    });
"""
new_index_rename = """    const onrename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile) || !this.vaultIndexEngine) return;
      const idx = this.vaultIndexEngine.getIndex();
      if (!idx) return;
      const changes: Array<{ type: 'deleted'; path: string } | { type: 'added'; path: string; object: { id: string; type: string; path: string; frontmatter: Record<string, unknown>; body: string } }> = [];
      if (this.shouldIndexPath(oldPath)) changes.push({ type: 'deleted', path: normalizeVaultPath(oldPath) });
      if (!this.shouldIndexPath(file.path)) {
        if (changes.length > 0) this.vaultIndexEngine.setIndex(VaultIndexEngine.updateIndex(idx, changes));
        return;
      }
      this.app.vault.read(file).then(content => {
        try {
          const result = ObjectParser.parse(content);
          changes.push({
            type: 'added',
            path: normalizeVaultPath(file.path),
            object: {
              id: result.object.id,
              type: result.object.type,
              path: file.path,
              frontmatter: result.object as Record<string, unknown>,
              body: (result.object as { body?: string }).body || ''
            }
          });
          this.vaultIndexEngine!.setIndex(VaultIndexEngine.updateIndex(idx, changes));
        } catch {
          if (changes.length > 0) this.vaultIndexEngine!.setIndex(VaultIndexEngine.updateIndex(idx, changes));
        }
      }).catch(() => {
        if (changes.length > 0) this.vaultIndexEngine!.setIndex(VaultIndexEngine.updateIndex(idx, changes));
      });
    });
"""
main = once(main, old_index_rename, new_index_rename, 'live index rename')

# Sync watcher events obey the canonical sync policy. _deleted remains included;
# _conflicts/.obsidian/etc are ignored.
main = main.replace(
"if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {",
"if (file instanceof TFile && VaultSyncFilePolicy.shouldSyncFile(file.path) && this.settings.isPaired && this.driveSyncCoordinator) {",
3)
# The rename handler needs old/new scope-aware behavior rather than a simple guard.
old_sync_rename = """    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          const oldSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(oldPath, null) ?? false;
          const newSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes)) ?? false;
          if (oldSuppressed && newSuppressed) return;
          this.driveSyncCoordinator?.queueRename(oldPath, file.path);
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
"""
new_sync_rename = """    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile) || !this.settings.isPaired || !this.driveSyncCoordinator) return;
      const oldSyncable = VaultSyncFilePolicy.shouldSyncFile(oldPath);
      const newSyncable = VaultSyncFilePolicy.shouldSyncFile(file.path);
      if (!oldSyncable && !newSyncable) return;

      if (oldSyncable && !newSyncable) {
        if (this.driveSyncCoordinator.consumeExpectedWatcherEvent(oldPath, null)) return;
        this.driveSyncCoordinator.queueDelete(oldPath);
        if (this.settings.syncAuto) this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
        return;
      }

      this.app.vault.readBinary(file).then(bytes => {
        const content = new Uint8Array(bytes);
        if (!oldSyncable && newSyncable) {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, content)) return;
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
          return;
        }
        const oldSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(oldPath, null) ?? false;
        const newSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, content) ?? false;
        if (oldSuppressed && newSuppressed) return;
        this.driveSyncCoordinator?.queueRename(oldPath, file.path);
        if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
      }).catch(() => {});
    });
"""
main = once(main, old_sync_rename, new_sync_rename, 'scope-aware watcher rename')
write(main_path, main)

# ---------------------------------------------------------------------------
# Behavioral sync regressions.
# ---------------------------------------------------------------------------
p0_path = 'tests/sync/p0-regression.test.ts'
p0 = read(p0_path)
append = r'''

describe('P0 hardening — path scope and rename collision semantics', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-scope-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('local rename fails closed when a different remote ID already owns the destination path', async () => {
    const content = Buffer.from('A');
    fs.writeFileSync(path.join(tmpDir, 'old.md'), content);
    const original = adapter.addRemoteFile('old.md', content);
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const collisionId = 'collision-id';
    adapter.files.set('new.md', { id: collisionId, content, quartzoHash: h('A'), parents: ['root-folder-id'] });
    fs.renameSync(path.join(tmpDir, 'old.md'), path.join(tmpDir, 'new.md'));
    coordinator.queueRename('old.md', 'new.md');

    const result = await coordinator.reconcile();
    expect(result.errors.some(error => error.includes('Ambiguous remote rename target'))).toBe(true);
    expect(adapter.renameCalls).toHaveLength(0);
    expect(coordinator.getSyncState().files.get('old.md')?.remoteFileId).toBe(original.id);
    expect(fs.readFileSync(path.join(tmpDir, 'new.md'), 'utf8')).toBe('A');
  });

  it('remote move into excluded scope behaves as remote absence and removes unchanged local copy', async () => {
    const content = Buffer.from('A');
    const remote = adapter.addRemoteFileWithId('note.md', 'excluded-move-id', content);
    fs.writeFileSync(path.join(tmpDir, 'note.md'), content);
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    adapter.files.delete('note.md');
    adapter.files.set('_conflicts/note.md', { id: remote.id, content, quartzoHash: h('A'), parents: ['root-folder-id'] });
    adapter.pendingChanges.push({
      fileId: remote.id,
      removed: false,
      file: { id: remote.id, name: '_conflicts/note.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: h('A'), parents: ['root-folder-id'] }
    });

    const result = await coordinator.reconcile();
    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'note.md'))).toBe(false);
    expect(coordinator.getSyncState().files.has('note.md')).toBe(false);
  });

  it('parent folder rename expands to tracked child identity and preserves a local edit', async () => {
    const base = Buffer.from('A');
    const edited = Buffer.from('B');
    fs.mkdirSync(path.join(tmpDir, 'Folder'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Folder', 'note.md'), base);
    const child = adapter.addRemoteFileWithId('Folder/note.md', 'folder-child-id', base);
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    fs.writeFileSync(path.join(tmpDir, 'Folder', 'note.md'), edited);
    adapter.files.delete('Folder/note.md');
    adapter.files.set('Renamed/note.md', { id: child.id, content: base, quartzoHash: h('A'), parents: ['root-folder-id'] });
    adapter.pendingChanges.push({
      fileId: 'folder-id',
      removed: false,
      file: { id: 'folder-id', name: 'Renamed', mimeType: 'application/vnd.google-apps.folder', modifiedTime: new Date().toISOString(), parents: ['root-folder-id'] }
    });

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'Folder', 'note.md'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, 'Renamed', 'note.md'), 'utf8')).toBe('B');
    expect(coordinator.getSyncState().files.get('Renamed/note.md')?.remoteFileId).toBe(child.id);
    expect(Buffer.from(await adapter.downloadFile(child.id)).toString()).toBe('B');
  });

  it('focus triggers during an active sync coalesce instead of being dropped', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    let releaseFirst!: () => void;
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const originalListAll = adapter.listAllFiles.bind(adapter);
    let listAllCalls = 0;
    adapter.listAllFiles = async (folderId: string) => {
      listAllCalls++;
      if (listAllCalls === 1) await gate;
      return originalListAll(folderId);
    };

    const first = coordinator.triggerManualSync();
    await new Promise(resolve => setTimeout(resolve, 5));
    const focusA = coordinator.triggerFocusSync();
    const focusB = coordinator.triggerFocusSync();
    releaseFirst();
    await Promise.all([first, focusA, focusB]);
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(listAllCalls).toBe(1);
    expect(adapter.listChangesCalls).toBe(1);
  });
});
'''
if "P0 hardening — path scope and rename collision semantics" not in p0:
    p0 += append
write(p0_path, p0)
