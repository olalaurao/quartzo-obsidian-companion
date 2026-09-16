from pathlib import Path


def read(p): return Path(p).read_text(encoding='utf-8')
def write(p, s): Path(p).write_text(s, encoding='utf-8')
def once(s, old, new, label):
    if old not in s:
        raise SystemExit(f'missing patch target: {label}')
    return s.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Pairing must fail closed for duplicate remote path identities.
# ---------------------------------------------------------------------------
coord_path = 'src/sync/coordinator/index.ts'
coord = read(coord_path)
coord = once(coord,
"  status: 'identical' | 'remote_only' | 'local_only' | 'divergent';",
"  status: 'identical' | 'remote_only' | 'local_only' | 'divergent' | 'ambiguous';",
'pairing status')
coord = once(coord,
"  divergent: PairingItem[];\n}",
"  divergent: PairingItem[];\n  ambiguous: PairingItem[];\n}",
'pairing ambiguous type')
coord = once(coord,
"    const summary: PairingSummary = { identical: [], remoteOnly: [], localOnly: [], divergent: [] };",
"    const summary: PairingSummary = { identical: [], remoteOnly: [], localOnly: [], divergent: [], ambiguous: [] };",
'pairing summary init')
old_map = """    const remoteMap = new Map<string, DriveFileMetadata>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath) continue;
      const normalizedRemote = normalizeVaultPath(remotePath);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedRemote)) continue;
      remoteMap.set(normalizedRemote, file);
    }

    const allPaths = new Set([...localInventory.keys(), ...remoteMap.keys()]);
"""
new_map = """    const remoteMap = new Map<string, DriveFileMetadata>();
    const remoteCandidates = new Map<string, DriveFileMetadata[]>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath) continue;
      const normalizedRemote = normalizeVaultPath(remotePath);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedRemote)) continue;
      const candidates = remoteCandidates.get(normalizedRemote) || [];
      candidates.push(file);
      remoteCandidates.set(normalizedRemote, candidates);
    }

    for (const [remotePath, candidates] of remoteCandidates) {
      const uniqueIds = new Set(candidates.map(candidate => candidate.id));
      if (uniqueIds.size > 1) {
        summary.ambiguous.push({ path: remotePath, status: 'ambiguous', localHash: localInventory.get(remotePath)?.hash || null, remoteHash: null });
        continue;
      }
      remoteMap.set(remotePath, candidates[0]);
    }

    const ambiguousPaths = new Set(summary.ambiguous.map(item => item.path));
    const allPaths = new Set([...localInventory.keys(), ...remoteMap.keys()]);
"""
coord = once(coord, old_map, new_map, 'pairing duplicate map')
coord = once(coord,
"    for (const filePath of allPaths) {\n      const localEntry = localInventory.get(filePath);",
"    for (const filePath of allPaths) {\n      if (ambiguousPaths.has(filePath)) continue;\n      const localEntry = localInventory.get(filePath);",
'pairing ambiguous skip')
old_hash = """      let remoteHash = remoteEntry?.quartzoHash || null;

      if (remoteEntry && remoteEntry.id && remoteHash === null) {
        try {
          const downloaded = await this.driveAdapter.downloadFile(remoteEntry.id);
          remoteHash = crypto.createHash('sha256').update(downloaded).digest('hex');
        } catch { /* skip */ }
      }
"""
new_hash = """      let remoteHash: string | null = null;
      if (remoteEntry) {
        remoteHash = await this.driveAdapter.resolveRemoteHash(remoteEntry);
      }
"""
coord = once(coord, old_hash, new_hash, 'pairing canonical hash resolver')
coord = once(coord,
"    const driveFolderId = this.syncState.driveFolderId || '';\n\n    if (decisions.autoAdopt) {",
"    const driveFolderId = this.syncState.driveFolderId || '';\n\n    if (summary.ambiguous.length > 0 || summary.divergent.length > 0) {\n      result.errors.push('Pairing decisions blocked: unresolved divergent or ambiguous identities remain.');\n      return result;\n    }\n\n    if (decisions.autoAdopt) {",
'pairing decisions fail closed')
write(coord_path, coord)

# Pairing UI must explicitly show/block ambiguous remote identities.
main_path = 'src/main.ts'
main = read(main_path)
main = once(main,
"    const hasDivergent = summary.divergent.length > 0;\n\n    if (hasDivergent) {\n      new Notice(`Pairing blocked: ${summary.divergent.length} divergent file(s) require resolution.`);\n      return;\n    }",
"    const hasDivergent = summary.divergent.length > 0;\n    const hasAmbiguous = summary.ambiguous.length > 0;\n\n    if (hasDivergent || hasAmbiguous) {\n      new Notice(`Pairing blocked: ${summary.divergent.length} divergent and ${summary.ambiguous.length} ambiguous file(s) require resolution.`);\n      return;\n    }",
'pairing block ambiguous')
main = once(main,
"            <li>Local-only (to adopt): ${summary.localOnly.length}</li>\n          </ul>",
"            <li>Local-only (to adopt): ${summary.localOnly.length}</li>\n            <li>Ambiguous (blocked): ${summary.ambiguous.length}</li>\n          </ul>",
'pairing modal ambiguous count')
write(main_path, main)

# Permanent CI/release must use a read-only cross-repo token for the private
# canonical repository. It must never silently skip verification in normal CI.
ci_path = '.github/workflows/ci.yml'
ci = read(ci_path)
ci = once(ci,
"    - run: npm run contracts:verify\n",
"    - name: Verify canonical contracts\n      run: npm run contracts:verify\n      env:\n        GITHUB_TOKEN: ${{ secrets.QUARTZO_UPSTREAM_TOKEN }}\n",
'ci contract token')
write(ci_path, ci)

release_path = '.github/workflows/release.yml'
release = read(release_path)
release = once(release,
"      - name: Verify contracts\n        run: npm run contracts:verify\n",
"      - name: Verify contracts\n        run: npm run contracts:verify\n        env:\n          GITHUB_TOKEN: ${{ secrets.QUARTZO_UPSTREAM_TOKEN }}\n",
'release contract token')
write(release_path, release)

# ---------------------------------------------------------------------------
# Behavioral regressions for the new hardening paths. These run production
# coordinator code; no source-string assertions are used here.
# ---------------------------------------------------------------------------
p0_path = 'tests/sync/p0-regression.test.ts'
p0 = read(p0_path)
append = r'''

describe('P0 hardening — ambiguity, watcher suppression, coalescing, state recovery', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-hardening-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('pairing summary quarantines duplicate exact remote paths and refuses decisions', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const first: DriveFileMetadata = { id: 'dup-a', name: 'nested/note.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: h('A'), parents: ['root-folder-id'] };
    const second: DriveFileMetadata = { id: 'dup-b', name: 'nested/note.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: h('A'), parents: ['root-folder-id'] };
    adapter.listAllFiles = async () => [first, second];
    adapter.resolveExactPath = async (id: string) => id === 'dup-a' || id === 'dup-b' ? 'nested/note.md' : id;

    const summary = await coordinator.generatePairingSummary();
    expect(summary.ambiguous).toHaveLength(1);
    expect(summary.ambiguous[0].path).toBe('nested/note.md');
    expect(summary.remoteOnly).toHaveLength(0);

    const result = await coordinator.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });
    expect(result.synced).toBe(0);
    expect(result.errors).toContain('Pairing decisions blocked: unresolved divergent or ambiguous identities remain.');
    expect(adapter.uploadCalls).toBe(0);
  });

  it('watcher suppression consumes only the exact coordinator-written hash', async () => {
    const remote = adapter.addRemoteFile('watch.md', Buffer.from('A'));
    adapter.pendingChanges.length = 0;
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();

    expect(fs.readFileSync(path.join(tmpDir, 'watch.md'), 'utf8')).toBe('A');
    expect(coordinator.consumeExpectedWatcherEvent('watch.md', Buffer.from('B'))).toBe(false);
    expect(coordinator.consumeExpectedWatcherEvent('watch.md', Buffer.from('A'))).toBe(true);
    expect(coordinator.consumeExpectedWatcherEvent('watch.md', Buffer.from('A'))).toBe(false);
    expect(remote.id).toBeTruthy();
  });

  it('concurrent sync triggers coalesce to a single rerun', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    let releaseFirst!: () => void;
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const originalListAll = adapter.listAllFiles.bind(adapter);
    let fullInventoryCalls = 0;
    adapter.listAllFiles = async (folderId: string) => {
      fullInventoryCalls++;
      if (fullInventoryCalls === 1) await gate;
      return originalListAll(folderId);
    };

    const first = coordinator.triggerManualSync();
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = coordinator.triggerManualSync();
    const third = coordinator.triggerManualSync();
    releaseFirst();
    await Promise.all([first, second, third]);
    await new Promise(resolve => setTimeout(resolve, 25));

    // Initial full inventory once. The coalesced rerun uses Changes API once.
    expect(fullInventoryCalls).toBe(1);
    expect(adapter.listChangesCalls).toBe(1);
  });

  it('recovers a complete atomic temp state when the primary state is absent', async () => {
    const statePath = path.join(tmpDir, '.quartzo-sync-state.json');
    const tempPath = `${statePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({
      files: [],
      lastSyncTime: 123,
      driveChangeToken: 'saved-token',
      driveFolderId: 'root-folder-id',
      version: '1.1.0',
      pendingRenames: [],
      pendingDeletes: []
    }));

    const recovered = new DriveSyncCoordinator(adapter, tmpDir, statePath);
    await recovered.reconcile();
    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(recovered.getSyncState().driveFolderId).toBe('root-folder-id');
  });
});
'''
if "P0 hardening — ambiguity, watcher suppression, coalescing, state recovery" not in p0:
    p0 += append
write(p0_path, p0)
