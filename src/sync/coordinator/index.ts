import { SyncEngine } from '../../core/sync';
import { DriveAdapter, SyncFile, SyncState, SyncResult, DriveFileMetadata, CURRENT_STATE_VERSION, PendingRename } from './types';
import { VaultSyncFilePolicy } from './file-policy';
import { normalizeVaultPath } from './path-utils';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as pathModule from 'path';

const KNOWN_TEXT_EXTENSIONS = new Set([
  '.md', '.base', '.txt', '.json', '.yaml', '.yml', '.toml',
  '.csv', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.rb', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sh',
]);

function isBinaryByContent(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 8192);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function isKnownTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of KNOWN_TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export interface ConflictArtifact {
  originalPath: string;
  localContent: Uint8Array;
  remoteContent: Uint8Array;
  localSha256: string;
  remoteSha256: string;
  remoteFileId: string | null;
  isBinary: boolean;
  timestamp: string;
  localExists: boolean;
  remoteExists: boolean;
}

export interface ConflictRegistry {
  getConflicts(): ConflictArtifact[];
  resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive'): Promise<void>;
}

export interface PairingItem {
  path: string;
  status: 'identical' | 'remote_only' | 'local_only' | 'divergent';
  localHash: string | null;
  remoteHash: string | null;
}

export interface PairingSummary {
  identical: PairingItem[];
  remoteOnly: PairingItem[];
  localOnly: PairingItem[];
  divergent: PairingItem[];
}

export class DriveSyncCoordinator implements ConflictRegistry {
  private syncState: SyncState;
  private driveAdapter: DriveAdapter;
  private vaultPath: string;
  private stateStorePath: string;
  private syncMutex: boolean = false;
  private syncQueue: Array<() => Promise<void>> = [];
  private backoffMs: number = 1000;
  private maxBackoffMs: number = 30000;
  private conflicts: Map<string, ConflictArtifact> = new Map();
  private pendingRenames: PendingRename[] = [];
  private pendingDeletes: Set<string> = new Set();

  constructor(driveAdapter: DriveAdapter, vaultPath: string, stateStorePath?: string) {
    this.driveAdapter = driveAdapter;
    this.vaultPath = vaultPath;
    this.stateStorePath = stateStorePath || '';
    this.syncState = {
      files: new Map(),
      lastSyncTime: 0,
      driveChangeToken: null,
      driveFolderId: null,
      version: CURRENT_STATE_VERSION
    };
  }

  getConflicts(): ConflictArtifact[] {
    return Array.from(this.conflicts.values());
  }

  async resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive'): Promise<void> {
    const normalized = normalizeVaultPath(originalPath);
    const artifact = this.conflicts.get(normalized);
    if (!artifact) return;

    const effectiveRemoteFileId = artifact.remoteFileId || this.syncState.files.get(normalized)?.remoteFileId || null;

    if (resolution === 'keep_local') {
      if (!artifact.localExists) {
        // Local delete wins
        if (effectiveRemoteFileId) {
          const deletedPath = `_deleted/${normalized}`;
          const folderId = this.syncState.driveFolderId || '';
          await this.driveAdapter.uploadFile({ 
            folderId, 
            name: deletedPath, 
            content: artifact.remoteContent, 
            quartzoHash: artifact.remoteSha256 
          });
          await this.driveAdapter.deleteFile(effectiveRemoteFileId);
        }
        this.syncState.files.delete(normalized);
      } else {
        // Local edit wins
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        const dir = pathModule.dirname(localFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(localFilePath, Buffer.from(artifact.localContent));

        let newRemoteId = effectiveRemoteFileId;
        if (effectiveRemoteFileId && artifact.remoteExists) {
          await this.driveAdapter.updateFile(effectiveRemoteFileId, artifact.localContent, artifact.localSha256);
        } else {
          const driveFolderId = this.syncState.driveFolderId || '';
          const meta = await this.driveAdapter.uploadFile({ folderId: driveFolderId, name: normalized, content: artifact.localContent, quartzoHash: artifact.localSha256 });
          newRemoteId = meta.id!;
        }

        const syncFile = this.syncState.files.get(normalized) || this.createSyncFile(normalized, { hash: artifact.localSha256, exists: true });
        syncFile.baseHash = artifact.localSha256;
        syncFile.localHash = artifact.localSha256;
        syncFile.remoteHash = artifact.localSha256;
        syncFile.localExists = true;
        syncFile.remoteExists = true;
        if (newRemoteId) syncFile.remoteFileId = newRemoteId;
        this.syncState.files.set(normalized, syncFile);
      }
    } else {
      if (!artifact.remoteExists) {
        // Remote delete wins
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        this.syncState.files.delete(normalized);
      } else {
        // Remote edit wins
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        const dir = pathModule.dirname(localFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(localFilePath, Buffer.from(artifact.remoteContent));

        const syncFile = this.syncState.files.get(normalized) || this.createSyncFile(normalized, { hash: artifact.remoteSha256, exists: true });
        syncFile.baseHash = artifact.remoteSha256;
        syncFile.localHash = artifact.remoteSha256;
        syncFile.remoteHash = artifact.remoteSha256;
        syncFile.localExists = true;
        syncFile.remoteExists = true;
        if (effectiveRemoteFileId) syncFile.remoteFileId = effectiveRemoteFileId;
        this.syncState.files.set(normalized, syncFile);
      }
    }

    await this.saveSyncState();
    this.conflicts.delete(normalized);
    this.removeConflictArtifacts(normalized);
  }

  private removeConflictArtifacts(originalPath: string): void {
    const paths = [
      pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.local`),
      pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.remote`),
      pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.conflict.json`),
      pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.conflict`),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  private rehydrateConflicts(): void {
    const conflictDir = pathModule.join(this.vaultPath, '_conflicts');
    if (!fs.existsSync(conflictDir)) return;

    const walkDir = (dir: string, relativeBase: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        const fullPath = pathModule.join(dir, entry.name);
        const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walkDir(fullPath, relativePath);
          continue;
        }

        if (!entry.isFile()) continue;

        if (relativePath.endsWith('.conflict.json')) {
          try {
            const meta = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const originalPath = meta.originalPath;
            if (!originalPath) continue;

            let localContent = new Uint8Array();
            let remoteContent = new Uint8Array();

            if (meta.conflictType === 'binary') {
              const localPath = pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.local`);
              const remotePath = pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.remote`);
              localContent = fs.existsSync(localPath) ? new Uint8Array(fs.readFileSync(localPath)) : new Uint8Array();
              remoteContent = fs.existsSync(remotePath) ? new Uint8Array(fs.readFileSync(remotePath)) : new Uint8Array();
            } else {
              const conflictFilePath = pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.conflict`);
              if (fs.existsSync(conflictFilePath)) {
                const rawBuf = fs.readFileSync(conflictFilePath);
                const SEPARATOR = Buffer.from('\n\n---QUARTZO_CONFLICT_SEPARATOR---\n\n');
                const sepIdx = rawBuf.indexOf(SEPARATOR);
                if (sepIdx >= 0) {
                  localContent = new Uint8Array(rawBuf.subarray(0, sepIdx));
                  remoteContent = new Uint8Array(rawBuf.subarray(sepIdx + SEPARATOR.length));
                } else {
                  localContent = new Uint8Array(rawBuf);
                }
              }
            }

            const localSha256 = meta.local?.sha256 || crypto.createHash('sha256').update(localContent).digest('hex');
            const remoteSha256 = meta.remote?.sha256 || crypto.createHash('sha256').update(remoteContent).digest('hex');

            this.conflicts.set(originalPath, {
              originalPath,
              localContent,
              remoteContent,
              localSha256,
              remoteSha256,
              remoteFileId: meta.remote?.fileId || null,
              isBinary: meta.conflictType === 'binary',
              timestamp: meta.timestamp || new Date().toISOString(),
              localExists: meta.local?.exists ?? true,
              remoteExists: meta.remote?.exists ?? (meta.remote?.fileId != null)
            });
          } catch { /* skip corrupt artifact */ }
        } else if (relativePath.endsWith('.conflict') && !relativePath.endsWith('.conflict.json')) {
          const originalPath = relativePath.slice(0, -'.conflict'.length);
          if (this.conflicts.has(originalPath)) continue;
          try {
            const conflictJsonPath = pathModule.join(this.vaultPath, '_conflicts', `${originalPath}.conflict.json`);
            let metaExists = false;
            let metaFileId: string | null = null;
            let metaLocalExists = true;
            let metaRemoteExists = true;
            try {
              if (fs.existsSync(conflictJsonPath)) {
                const meta = JSON.parse(fs.readFileSync(conflictJsonPath, 'utf-8'));
                metaFileId = meta.remote?.fileId || null;
                metaLocalExists = meta.local?.exists ?? true;
                metaRemoteExists = meta.remote?.exists ?? (metaFileId != null);
                metaExists = true;
              }
            } catch { /* no json meta */ }

            const rawContent = new Uint8Array(fs.readFileSync(fullPath));
            const SEPARATOR = Buffer.from('\n\n---QUARTZO_CONFLICT_SEPARATOR---\n\n');
            const rawBuf = Buffer.from(rawContent);

            const sepIdx = rawBuf.indexOf(SEPARATOR);
            const trackedSyncFile = this.syncState.files.get(originalPath);
            const knownRemoteFileId = metaFileId || trackedSyncFile?.remoteFileId || null;
            if (sepIdx >= 0) {
              const localContent = new Uint8Array(rawBuf.subarray(0, sepIdx));
              const remoteContent = new Uint8Array(rawBuf.subarray(sepIdx + SEPARATOR.length));
              const localSha256 = crypto.createHash('sha256').update(localContent).digest('hex');
              const remoteSha256 = crypto.createHash('sha256').update(remoteContent).digest('hex');

              this.conflicts.set(originalPath, {
                originalPath,
                localContent,
                remoteContent,
                localSha256,
                remoteSha256,
                remoteFileId: knownRemoteFileId,
                isBinary: false,
                timestamp: new Date().toISOString(),
                localExists: metaLocalExists,
                remoteExists: metaRemoteExists
              });
            } else {
              const localSha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
              this.conflicts.set(originalPath, {
                originalPath,
                localContent: rawContent,
                remoteContent: new Uint8Array(),
                localSha256,
                remoteSha256: '',
                remoteFileId: knownRemoteFileId,
                isBinary: false,
                timestamp: new Date().toISOString(),
                localExists: metaLocalExists,
                remoteExists: metaRemoteExists
              });
            }
          } catch { /* skip corrupt artifact */ }
        }
      }
    };

    walkDir(conflictDir, '');
  }

  async reconcile(): Promise<SyncResult> {
    if (this.syncMutex) {
      this.queueSync();
      return { synced: 0, conflicts: 0, errors: ['Sync already in progress, queued'] };
    }

    this.syncMutex = true;
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };

    try {
      await this.loadSyncState();
      this.rehydrateConflicts();
      this.ancestryCache.clear();
      this.parentNameCache.clear();

      const driveFolderId = await this.driveAdapter.getFolderId();
      if (!driveFolderId) {
        throw new Error('Drive folder not configured');
      }

      this.syncState.driveFolderId = driveFolderId;

      const localInventory = await this.buildLocalInventory();

      if (this.syncState.driveChangeToken) {
        await this.processChanges(localInventory, result);
        const freshLocalInventory = await this.buildLocalInventory();
        await this.processLocalDirty(freshLocalInventory, result);
      } else {
        await this.fullInventory(localInventory, result);
        const startToken = await this.driveAdapter.getStartPageToken();
        this.syncState.driveChangeToken = startToken;
      }

      this.syncState.lastSyncTime = Date.now();
      await this.saveSyncState();
      this.backoffMs = 1000;
    } catch (error) {
      result.errors.push(`Sync failed: ${error}`);
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    } finally {
      this.syncMutex = false;
      this.processSyncQueue();
    }

    return result;
  }

  private async fullInventory(
    localInventory: Map<string, { hash: string; exists: boolean }>,
    result: SyncResult
  ): Promise<void> {
    const driveFolderId = this.syncState.driveFolderId || '';
    const remoteFiles = await this.driveAdapter.listAllFiles(driveFolderId);

    const remoteFileMap = new Map<string, DriveFileMetadata>();
    const remoteIdSeen = new Map<string, string>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath) continue;

      if (!VaultSyncFilePolicy.shouldSyncFile(remotePath)) continue;

      const normalizedRemote = normalizeVaultPath(remotePath);
      if (remoteFileMap.has(normalizedRemote)) {
        const existingId = remoteFileMap.get(normalizedRemote)!.id;
        if (existingId !== file.id) {
          result.errors.push(`Ambiguous remote identity for ${normalizedRemote}: ${existingId} vs ${file.id}`);
          this.conflicts.set(normalizedRemote, {
            originalPath: normalizedRemote,
            localContent: new Uint8Array(),
            remoteContent: new Uint8Array(),
            localSha256: '',
            remoteSha256: '',
            remoteFileId: file.id,
            isBinary: false,
            timestamp: new Date().toISOString(),
            localExists: false,
            remoteExists: true
          });
          result.conflicts++;
          continue;
        }
      }

      remoteFileMap.set(normalizedRemote, file);
    }

    for (const [localPath, localFile] of localInventory) {
      const normalizedLocal = normalizeVaultPath(localPath);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedLocal)) continue;

      const remoteFile = remoteFileMap.get(normalizedLocal);
      const syncFile = this.syncState.files.get(normalizedLocal) || this.createSyncFile(normalizedLocal, localFile);

      let remoteHash = remoteFile ? (remoteFile.quartzoHash || null) : null;
      if (remoteFile && remoteFile.id && remoteHash === null) {
        try {
          const downloaded = await this.driveAdapter.downloadFile(remoteFile.id);
          remoteHash = crypto.createHash('sha256').update(downloaded).digest('hex');
          remoteFile.quartzoHash = remoteHash;
        } catch { /* fallback to conflict */ }
      }
      const localHash = localFile.hash;
      const baseHash = syncFile.baseHash;

      if (remoteFile && remoteFile.id) {
        syncFile.remoteFileId = remoteFile.id;
      }

      const vector = {
        id: normalizedLocal,
        baseHash,
        localHash,
        remoteHash,
        localExists: true,
        remoteExists: remoteFile !== undefined,
        expected: ''
      };

      const syncDecision = SyncEngine.reconcile(vector);

      switch (syncDecision.action) {
        case 'push':
          await this.pushFile(normalizedLocal, localFile, syncFile);
          result.synced++;
          break;
        case 'pull':
          if (remoteFile) {
            await this.pullFile(normalizedLocal, remoteFile, syncFile);
            result.synced++;
          }
          break;
        case 'delete_local':
          await this.deleteLocalFile(normalizedLocal);
          result.synced++;
          break;
        case 'conflict':
          result.conflicts++;
          await this.handleConflict(normalizedLocal, localFile, remoteFile, syncFile);
          break;
        case 'advance_baseline':
          syncFile.baseHash = localHash;
          if (remoteFile && remoteFile.id) {
            syncFile.remoteHash = remoteFile.quartzoHash || null;
            syncFile.remoteFileId = remoteFile.id;
          }
          syncFile.localHash = localHash;
          this.syncState.files.set(normalizedLocal, syncFile);
          break;
        case 'adoption_required':
          this.recordAdoptionPending(normalizedLocal, syncFile);
          break;
      }
    }

    for (const [remotePath, remoteFile] of remoteFileMap) {
      if (!localInventory.has(remotePath)) {
        const vector = {
          id: remotePath,
          baseHash: null,
          localHash: null,
          remoteHash: remoteFile.quartzoHash || null,
          localExists: false,
          remoteExists: true,
          expected: 'pull'
        };

        const syncDecision = SyncEngine.reconcile(vector);
        if (syncDecision.action === 'pull') {
          const syncFile = this.createSyncFile(remotePath, { hash: '', exists: false });
          syncFile.remoteFileId = remoteFile.id;
          await this.pullFile(remotePath, remoteFile, syncFile);
          result.synced++;
        }
      }
    }

    const allKnown = new Set([...localInventory.keys(), ...remoteFileMap.keys()]);
    for (const key of this.syncState.files.keys()) {
      if (!allKnown.has(key)) {
        this.syncState.files.delete(key);
      }
    }
  }

  private async processChanges(
    localInventory: Map<string, { hash: string; exists: boolean }>,
    result: SyncResult
  ): Promise<void> {
    let pageToken = this.syncState.driveChangeToken;
    let newStartPageToken: string | null = null;
    const driveFolderId = this.syncState.driveFolderId || '';

    do {
      const response = await this.driveAdapter.listChanges(pageToken!);
      newStartPageToken = response.newStartPageToken;

      for (const change of response.changes) {
        if (change.removed) {
          const syncFile = this.findSyncFileByRemoteId(change.fileId);
          if (syncFile) {
            const localHash = localInventory.get(syncFile.path)?.hash || null;
            if (localHash && localHash === syncFile.baseHash) {
              await this.deleteLocalFile(syncFile.path);
              result.synced++;
            } else if (localHash) {
              result.conflicts++;
              await this.handleConflict(syncFile.path, { hash: localHash, exists: true }, undefined, syncFile);
            }
          }
          continue;
        }

        if (!change.file) continue;
        const remotePath = await this.resolveRemotePath(change.file, driveFolderId);
        if (!remotePath) continue;
        const normalizedRemote = normalizeVaultPath(remotePath);
        if (!VaultSyncFilePolicy.shouldSyncFile(normalizedRemote)) continue;

        const hasAncestry = await this.proveAncestryToRoot(change.file, driveFolderId);
        if (!hasAncestry) {
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
              await this.handleConflict(trackedFile.path, { hash: localHash, exists: true }, undefined, trackedFile);
            }
          }
          continue;
        }

        const localFile = localInventory.get(normalizedRemote);
        let syncFile = this.syncState.files.get(normalizedRemote);

        if (!syncFile) {
          const existingSyncFile = this.findSyncFileByRemoteId(change.file.id);
          if (existingSyncFile && existingSyncFile.path !== normalizedRemote) {
            const oldKey = existingSyncFile.path;
            const localFileAtOld = localInventory.get(oldKey);
            const localFileAtNew = localInventory.get(normalizedRemote);
            
            const isOldEdited = localFileAtOld && localFileAtOld.hash !== existingSyncFile.localHash;
            const collisionAtNew = !!localFileAtNew;

            if (isOldEdited || collisionAtNew) {
              // Fail-closed: Cannot silently rename locally.
              // Leave the old local file alone. 
              // Create a conflict for the new path using the remote file.
              this.syncState.files.delete(oldKey);
              existingSyncFile.path = normalizedRemote;
              this.syncState.files.set(normalizedRemote, existingSyncFile);
              syncFile = existingSyncFile;
              
              // To prevent duplicate remote or overwriting, we simulate a conflict at new path.
              // The local candidate is either the collision file, or the old file we didn't move!
              // But we can't merge them. We just trigger handleConflict.
              const conflictCandidate = localFileAtNew || localFileAtOld!;
              result.conflicts++;
              await this.handleConflict(normalizedRemote, conflictCandidate, change.file, syncFile);
              
              // We also mark oldKey to not be pushed as a new file during processLocalDirty
              // by removing it from localInventory temporarily, but since we can't easily,
              // we just add it to a quarantine or let it be pushed? 
              // The user said: "Não sobrescrever nenhum deles e não criar duplicate remote."
              // So if we quarantine oldKey:
              this.conflicts.set(oldKey, this.conflicts.get(normalizedRemote)!); // Fake conflict to prevent push
              continue;
            } else {
              // Safe to rename locally
              this.syncState.files.delete(oldKey);
              existingSyncFile.path = normalizedRemote;
              this.syncState.files.set(normalizedRemote, existingSyncFile);
              syncFile = existingSyncFile;
              
              if (localFileAtOld) {
                const oldLocalPath = pathModule.join(this.vaultPath, oldKey);
                const newLocalPath = pathModule.join(this.vaultPath, normalizedRemote);
                const newDir = pathModule.dirname(newLocalPath);
                if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
                if (fs.existsSync(oldLocalPath)) fs.renameSync(oldLocalPath, newLocalPath);
                localInventory.delete(oldKey);
                localInventory.set(normalizedRemote, localFileAtOld);
              } else {
                await this.pullFile(normalizedRemote, change.file, syncFile);
                result.synced++;
                continue;
              }
            }
          } else {
            syncFile = this.createSyncFile(normalizedRemote, localFile || { hash: '', exists: false });
          }
        }

        const remoteHash = change.file.quartzoHash || null;
        syncFile.remoteFileId = change.file.id;

        if (!localFile) {
          if (this.pendingDeletes.has(normalizedRemote)) {
            result.conflicts++;
            await this.handleConflict(normalizedRemote, { hash: syncFile.localHash, exists: false }, change.file, syncFile);
          } else {
            await this.pullFile(normalizedRemote, change.file, syncFile);
            result.synced++;
          }
          continue;
        }

        const vector = {
          id: normalizedRemote,
          baseHash: syncFile.baseHash,
          localHash: localFile.hash,
          remoteHash,
          localExists: true,
          remoteExists: true,
          expected: ''
        };

        const syncDecision = SyncEngine.reconcile(vector);
        switch (syncDecision.action) {
          case 'push':
            await this.pushFile(normalizedRemote, localFile, syncFile);
            result.synced++;
            break;
          case 'pull':
            await this.pullFile(normalizedRemote, change.file, syncFile);
            result.synced++;
            break;
          case 'delete_local':
            await this.deleteLocalFile(normalizedRemote);
            result.synced++;
            break;
          case 'conflict':
            result.conflicts++;
            await this.handleConflict(normalizedRemote, localFile, change.file, syncFile);
            break;
          case 'advance_baseline':
            syncFile.baseHash = localFile.hash;
            syncFile.remoteHash = remoteHash;
            syncFile.localHash = localFile.hash;
            this.syncState.files.set(normalizedRemote, syncFile);
            break;
        }
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    if (newStartPageToken) {
      this.syncState.driveChangeToken = newStartPageToken;
    }
  }

  private async processLocalDirty(
    localInventory: Map<string, { hash: string; exists: boolean }>,
    result: SyncResult
  ): Promise<void> {
    const processedPaths = new Set<string>();
    const driveFolderId = this.syncState.driveFolderId || '';

    const remainingRenames: PendingRename[] = [];
    for (const rename of this.pendingRenames) {
      const oldSyncFile = this.syncState.files.get(rename.oldPath);
      if (!oldSyncFile || !oldSyncFile.remoteFileId) {
        continue; // Discard invalid intents
      }

      const newLocalFile = localInventory.get(rename.newPath);
      if (newLocalFile) {
        try {
          const newFileName = rename.newPath.split('/').pop() || rename.newPath;
          const newParentId = await this.driveAdapter.ensureParentFolder(driveFolderId, rename.newPath);
          await this.driveAdapter.renameFile(oldSyncFile.remoteFileId, newFileName, newParentId);
          
          oldSyncFile.path = rename.newPath;
          this.syncState.files.delete(rename.oldPath);
          this.syncState.files.set(rename.newPath, oldSyncFile);
          
          if (newLocalFile.hash === oldSyncFile.localHash) {
            processedPaths.add(rename.newPath);
          }
          processedPaths.add(rename.oldPath);
          result.synced++;
        } catch (error) {
          result.errors.push(`Rename failed ${rename.oldPath} -> ${rename.newPath}: ${error}`);
          remainingRenames.push(rename); // Fail-closed: keep in pending
          processedPaths.add(rename.oldPath);
          processedPaths.add(rename.newPath);
        }
      } else {
        // Local file no longer exists at new path, discard intent.
        // The oldPath will be processed as a standard local delete.
      }
    }
    this.pendingRenames = remainingRenames;

    for (const deletedPath of this.pendingDeletes) {
      if (this.conflicts.has(deletedPath)) {
        processedPaths.add(deletedPath);
        continue;
      }
      const syncFile = this.syncState.files.get(deletedPath);
      if (syncFile && syncFile.remoteFileId) {
        if (syncFile.baseHash !== null && syncFile.baseHash === syncFile.localHash) {
          await this.deleteRemoteFile(deletedPath, syncFile);
          result.synced++;
        } else {
          result.conflicts++;
          const localHash = localInventory.get(deletedPath)?.hash || null;
          await this.handleConflict(deletedPath, { hash: localHash || syncFile.localHash, exists: false }, undefined, syncFile);
        }
      } else if (syncFile) {
        this.syncState.files.delete(deletedPath);
      }
      processedPaths.add(deletedPath);
    }
    this.pendingDeletes.clear();

    for (const [syncedPath, syncFile] of this.syncState.files) {
      if (processedPaths.has(syncedPath) || this.conflicts.has(syncedPath)) {
        processedPaths.add(syncedPath);
        continue;
      }
      if (!syncFile.remoteFileId) continue;

      const localFile = localInventory.get(syncedPath);
      if (!localFile) {
        if (syncFile.baseHash !== null && syncFile.baseHash === syncFile.localHash) {
          await this.deleteRemoteFile(syncedPath, syncFile);
          result.synced++;
        } else {
          result.conflicts++;
          await this.handleConflict(syncedPath, { hash: syncFile.localHash, exists: false }, undefined, syncFile);
        }
        processedPaths.add(syncedPath);
      }
    }

    for (const [localPath, localFile] of localInventory) {
      const normalizedLocal = normalizeVaultPath(localPath);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedLocal)) continue;
      if (processedPaths.has(normalizedLocal) || this.conflicts.has(normalizedLocal)) {
        processedPaths.add(normalizedLocal);
        continue;
      }

      const syncFile = this.syncState.files.get(normalizedLocal);

      if (!syncFile) {
        const newSyncFile = this.createSyncFile(normalizedLocal, localFile);
        newSyncFile.baseHash = localFile.hash;
        newSyncFile.localHash = localFile.hash;
        this.syncState.files.set(normalizedLocal, newSyncFile);
        await this.pushFile(normalizedLocal, localFile, newSyncFile);
        result.synced++;
        processedPaths.add(normalizedLocal);
        continue;
      }

      if (!syncFile.remoteFileId) {
        if (localFile.hash !== syncFile.localHash) {
          syncFile.localHash = localFile.hash;
          this.syncState.files.set(normalizedLocal, syncFile);
        }
        processedPaths.add(normalizedLocal);
        continue;
      }

      if (localFile.hash === syncFile.localHash) {
        processedPaths.add(normalizedLocal);
        continue;
      }

      const vector = {
        id: normalizedLocal,
        baseHash: syncFile.baseHash,
        localHash: localFile.hash,
        remoteHash: syncFile.remoteHash,
        localExists: true,
        remoteExists: true,
        expected: ''
      };

      const syncDecision = SyncEngine.reconcile(vector);
      switch (syncDecision.action) {
        case 'push':
          await this.pushFile(normalizedLocal, localFile, syncFile);
          result.synced++;
          break;
        case 'pull':
          if (syncFile.remoteHash) {
            const remoteMetadata = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId);
            await this.pullFile(normalizedLocal, remoteMetadata, syncFile);
            result.synced++;
          }
          break;
        case 'conflict':
          result.conflicts++;
          const remoteMetadata = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId);
          await this.handleConflict(normalizedLocal, localFile, remoteMetadata, syncFile);
          break;
        case 'advance_baseline':
          syncFile.baseHash = localFile.hash;
          syncFile.localHash = localFile.hash;
          this.syncState.files.set(normalizedLocal, syncFile);
          break;
      }
      processedPaths.add(normalizedLocal);
    }
  }

  private findSyncFileByRemoteId(remoteId: string): SyncFile | undefined {
    for (const syncFile of this.syncState.files.values()) {
      if (syncFile.remoteFileId === remoteId) return syncFile;
    }
    return undefined;
  }

  private parentNameCache: Map<string, string> = new Map();
  private ancestryCache: Map<string, boolean> = new Map();

  private async proveAncestryToRoot(file: DriveFileMetadata, rootFolderId: string): Promise<boolean> {
    const cacheKey = file.id;
    if (this.ancestryCache.has(cacheKey)) {
      return this.ancestryCache.get(cacheKey)!;
    }

    if (!file.parents || file.parents.length === 0) {
      this.ancestryCache.set(cacheKey, false);
      return false;
    }

    let currentParentId = file.parents[0];
    let depth = 0;
    const MAX_DEPTH = 20;

    while (currentParentId && depth < MAX_DEPTH) {
      if (currentParentId === rootFolderId) {
        this.ancestryCache.set(cacheKey, true);
        return true;
      }
      try {
        const parentMeta = await this.driveAdapter.getFileMetadata(currentParentId);
        if (!parentMeta.parents || parentMeta.parents.length === 0) {
          this.ancestryCache.set(cacheKey, false);
          return false;
        }
        currentParentId = parentMeta.parents[0];
      } catch {
        this.ancestryCache.set(cacheKey, false);
        return false;
      }
      depth++;
    }

    this.ancestryCache.set(cacheKey, false);
    return false;
  }

  private async resolveRemotePath(file: DriveFileMetadata, rootFolderId: string): Promise<string | null> {
    if (file.name && file.name.includes('/')) return file.name;

    if (!file.parents || file.parents.length === 0) return file.name || null;

    const segments: string[] = [file.name || ''];
    let currentParentId = file.parents[0];
    let depth = 0;
    const MAX_DEPTH = 20;

    while (currentParentId && currentParentId !== rootFolderId && depth < MAX_DEPTH) {
      let parentName: string | undefined;

      if (this.parentNameCache.has(currentParentId)) {
        parentName = this.parentNameCache.get(currentParentId);
      } else {
        try {
          const metadata = await this.driveAdapter.getFileMetadata(currentParentId);
          parentName = metadata.name || undefined;
          if (parentName) {
            this.parentNameCache.set(currentParentId, parentName);
          }
        } catch {
          break;
        }
      }

      if (!parentName) break;
      segments.unshift(parentName);

      try {
        const parentMeta = await this.driveAdapter.getFileMetadata(currentParentId);
        currentParentId = parentMeta.parents && parentMeta.parents.length > 0 ? parentMeta.parents[0] : '';
      } catch {
        break;
      }
      depth++;
    }

    return segments.join('/');
  }

  private recordAdoptionPending(filePath: string, syncFile: SyncFile): void {
    syncFile.localExists = true;
    syncFile.remoteExists = false;
    syncFile.baseHash = null;
    this.syncState.files.set(filePath, syncFile);
  }

  private async pushFile(filePath: string, localFile: { hash: string; exists: boolean }, syncFile: SyncFile): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const content = new Uint8Array(fs.readFileSync(localFilePath));
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    const folderId = this.syncState.driveFolderId || '';

    let metadata: DriveFileMetadata;

    if (syncFile.remoteFileId) {
      metadata = await this.driveAdapter.updateFile(syncFile.remoteFileId, content, quartzoHash);
    } else {
      metadata = await this.driveAdapter.uploadFile({ folderId, name: filePath, content, quartzoHash });
    }

    syncFile.remoteHash = quartzoHash;
    syncFile.remoteFileId = metadata.id;
    syncFile.baseHash = localFile.hash;
    syncFile.localHash = localFile.hash;
    syncFile.localExists = true;
    syncFile.remoteExists = true;

    this.syncState.files.set(filePath, syncFile);
  }

  private async pullFile(filePath: string, remoteFile: DriveFileMetadata, syncFile: SyncFile): Promise<void> {
    const content = await this.driveAdapter.downloadFile(remoteFile.id);
    const localFilePath = pathModule.join(this.vaultPath, filePath);

    const localDir = pathModule.dirname(localFilePath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    fs.writeFileSync(localFilePath, Buffer.from(content));

    const localHash = crypto.createHash('sha256').update(content).digest('hex');
    const remoteSha256 = remoteFile.quartzoHash || localHash;

    syncFile.localHash = localHash;
    syncFile.remoteHash = remoteSha256;
    syncFile.baseHash = remoteSha256;
    syncFile.remoteFileId = remoteFile.id;
    syncFile.localExists = true;
    syncFile.remoteExists = true;
    syncFile.isBinary = !isKnownTextFile(filePath) && isBinaryByContent(content);

    this.syncState.files.set(filePath, syncFile);
  }

  private async deleteLocalFile(filePath: string): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    this.syncState.files.delete(filePath);
  }

  private async deleteRemoteFile(filePath: string, syncFile: SyncFile): Promise<void> {
    if (syncFile.remoteFileId) {
      const deletedPath = `_deleted/${filePath}`;
      const content = await this.driveAdapter.downloadFile(syncFile.remoteFileId);
      const folderId = this.syncState.driveFolderId || '';
      await this.driveAdapter.uploadFile({ folderId, name: deletedPath, content, quartzoHash: syncFile.remoteHash || '' });
      await this.driveAdapter.deleteFile(syncFile.remoteFileId);
    }
    this.syncState.files.delete(filePath);
  }

  private async handleConflict(
    filePath: string,
    localFile: { hash: string; exists: boolean },
    remoteFile: DriveFileMetadata | undefined,
    syncFile: SyncFile
  ): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const isBinary = !isKnownTextFile(filePath) && fs.existsSync(localFilePath) && isBinaryByContent(fs.readFileSync(localFilePath));

    let localContent = new Uint8Array();
    let remoteContent = new Uint8Array();

    if (fs.existsSync(localFilePath)) {
      localContent = new Uint8Array(fs.readFileSync(localFilePath));
    }

    if (remoteFile) {
      remoteContent = await this.driveAdapter.downloadFile(remoteFile.id);
    }

    const localSha256 = crypto.createHash('sha256').update(localContent).digest('hex');
    const remoteSha256 = remoteFile?.quartzoHash || crypto.createHash('sha256').update(remoteContent).digest('hex');

    const conflictBase = `_conflicts/${filePath}`;

    const conflictDirForFile = pathModule.dirname(pathModule.join(this.vaultPath, conflictBase));
    if (!fs.existsSync(conflictDirForFile)) {
      fs.mkdirSync(conflictDirForFile, { recursive: true });
    }

    if (isBinary) {
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.local`), Buffer.from(localContent));
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.remote`), Buffer.from(remoteContent));

      const metadata = {
        originalPath: filePath,
        conflictType: 'binary',
        local: { sha256: localSha256, size: localContent.length, exists: localFile.exists },
        remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || syncFile.remoteFileId || null, exists: remoteFile != null },
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.conflict.json`), JSON.stringify(metadata, null, 2));
    } else {
      const SEPARATOR = Buffer.from('\n\n---QUARTZO_CONFLICT_SEPARATOR---\n\n');
      const conflictContent = Buffer.concat([
        Buffer.from(localContent),
        SEPARATOR,
        Buffer.from(remoteContent)
      ]);
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.conflict`), conflictContent);

      const metadata = {
        originalPath: filePath,
        conflictType: 'text',
        local: { sha256: localSha256, size: localContent.length, exists: localFile.exists },
        remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || syncFile.remoteFileId || null, exists: remoteFile != null },
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.conflict.json`), JSON.stringify(metadata, null, 2));
    }

    this.conflicts.set(filePath, {
      originalPath: filePath,
      localContent,
      remoteContent,
      localSha256,
      remoteSha256,
      remoteFileId: remoteFile?.id || syncFile.remoteFileId || null,
      isBinary,
      timestamp: new Date().toISOString(),
      localExists: localFile.exists,
      remoteExists: remoteFile != null
    });
  }

  private calculateHash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  getSyncState(): SyncState {
    return { ...this.syncState, files: new Map(this.syncState.files) };
  }

  async setDriveFolderId(folderId: string): Promise<void> {
    await this.driveAdapter.setFolderId(folderId);
    this.syncState.driveFolderId = folderId;
  }

  async generatePairingSummary(): Promise<PairingSummary> {
    const summary: PairingSummary = { identical: [], remoteOnly: [], localOnly: [], divergent: [] };
    const driveFolderId = this.syncState.driveFolderId || '';
    if (!driveFolderId) return summary;

    const localInventory = await this.buildLocalInventory();
    const remoteFiles = await this.driveAdapter.listAllFiles(driveFolderId);
    const remoteMap = new Map<string, DriveFileMetadata>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath) continue;
      const normalizedRemote = normalizeVaultPath(remotePath);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedRemote)) continue;
      remoteMap.set(normalizedRemote, file);
    }

    const allPaths = new Set([...localInventory.keys(), ...remoteMap.keys()]);

    for (const filePath of allPaths) {
      const localEntry = localInventory.get(filePath);
      const remoteEntry = remoteMap.get(filePath);
      let remoteHash = remoteEntry?.quartzoHash || null;

      if (remoteEntry && remoteEntry.id && remoteHash === null) {
        try {
          const downloaded = await this.driveAdapter.downloadFile(remoteEntry.id);
          remoteHash = crypto.createHash('sha256').update(downloaded).digest('hex');
        } catch { /* skip */ }
      }

      const localHash = localEntry?.hash || null;
      const localExists = localEntry?.exists ?? false;
      const remoteExists = remoteEntry != null;

      if (localExists && remoteExists) {
        if (localHash === remoteHash) {
          summary.identical.push({ path: filePath, status: 'identical', localHash, remoteHash });
        } else {
          summary.divergent.push({ path: filePath, status: 'divergent', localHash, remoteHash });
        }
      } else if (localExists && !remoteExists) {
        summary.localOnly.push({ path: filePath, status: 'local_only', localHash, remoteHash: null });
      } else if (!localExists && remoteExists) {
        summary.remoteOnly.push({ path: filePath, status: 'remote_only', localHash: null, remoteHash });
      }
    }

    return summary;
  }

  async applyPairingDecisions(summary: PairingSummary, decisions: { autoAdopt: boolean; autoPull: boolean }): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };
    const driveFolderId = this.syncState.driveFolderId || '';

    if (decisions.autoAdopt) {
      for (const item of summary.localOnly) {
        try {
          await this.explicitAdopt(item.path);
          result.synced++;
        } catch (error) {
          result.errors.push(`Failed to adopt ${item.path}: ${error}`);
        }
      }
    }

    if (decisions.autoPull) {
      for (const item of summary.remoteOnly) {
        const remoteFiles = await this.driveAdapter.listAllFiles(driveFolderId);
        let remoteEntry: DriveFileMetadata | undefined;
        let matchedCount = 0;
        for (const f of remoteFiles) {
          const remotePath = await this.resolveRemotePath(f, driveFolderId);
          if (remotePath === item.path) {
            remoteEntry = f;
            matchedCount++;
          }
        }
        if (matchedCount > 1) {
          result.errors.push(`Failed to pull ${item.path}: Ambiguous duplicate remote files found.`);
          continue;
        }
        if (!remoteEntry) continue;
        const syncFile = this.createSyncFile(item.path, { hash: '', exists: false });
        syncFile.remoteFileId = remoteEntry.id;
        try {
          await this.pullFile(item.path, remoteEntry, syncFile);
          result.synced++;
        } catch (error) {
          result.errors.push(`Failed to pull ${item.path}: ${error}`);
        }
      }
    }

    await this.saveSyncState();
    return result;
  }

  async explicitAdopt(filePath: string): Promise<void> {
    const normalized = normalizeVaultPath(filePath);
    const localFilePath = pathModule.join(this.vaultPath, normalized);
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local file not found: ${normalized}`);
    }

    const existingSyncFile = this.syncState.files.get(normalized);
    if (existingSyncFile && existingSyncFile.remoteFileId) {
      throw new Error(`File ${normalized} already has a remote counterpart. Use sync instead of adopt.`);
    }
    if (existingSyncFile && existingSyncFile.baseHash !== null) {
      throw new Error(`File ${normalized} is not in adoption_required state (baseHash is set).`);
    }

    const content = new Uint8Array(fs.readFileSync(localFilePath));
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    const folderId = this.syncState.driveFolderId || '';

    const remoteFiles = await this.driveAdapter.listAllFiles(folderId);
    let duplicateRemote: DriveFileMetadata | undefined;
    let matchedCount = 0;
    for (const f of remoteFiles) {
      const remotePath = await this.resolveRemotePath(f, folderId);
      if (remotePath === normalized) {
        duplicateRemote = f;
        matchedCount++;
      }
    }
    if (matchedCount > 1) {
      throw new Error('Ambiguous duplicate remote files found');
    }

    if (duplicateRemote) {
      let remoteHash = duplicateRemote.quartzoHash || null;
      if (!remoteHash) {
        const remoteContent = await this.driveAdapter.downloadFile(duplicateRemote.id!);
        remoteHash = crypto.createHash('sha256').update(remoteContent).digest('hex');
      }
      if (remoteHash === quartzoHash) {
        const syncFile = this.createSyncFile(normalized, { hash: quartzoHash, exists: true });
        syncFile.baseHash = quartzoHash;
        syncFile.localHash = quartzoHash;
        syncFile.remoteHash = quartzoHash;
        syncFile.remoteFileId = duplicateRemote.id!;
        syncFile.remoteExists = true;
        syncFile.localExists = true;
        this.syncState.files.set(normalized, syncFile);
        await this.saveSyncState();
      } else {
        const syncFile = this.createSyncFile(normalized, { hash: quartzoHash, exists: true });
        syncFile.remoteFileId = duplicateRemote.id!;
        syncFile.remoteExists = true;
        this.syncState.files.set(normalized, syncFile);
        await this.saveSyncState();
        await this.handleConflict(normalized, { hash: quartzoHash, exists: true }, duplicateRemote, syncFile);
      }
      return;
    }

    const metadata = await this.driveAdapter.uploadFile({ folderId, name: normalized, content, quartzoHash });

    const syncFile = this.createSyncFile(normalized, { hash: quartzoHash, exists: true });
    syncFile.baseHash = quartzoHash;
    syncFile.localHash = quartzoHash;
    syncFile.remoteHash = quartzoHash;
    syncFile.remoteFileId = metadata.id;
    syncFile.remoteExists = true;
    syncFile.localExists = true;

    this.syncState.files.set(normalized, syncFile);
    await this.saveSyncState();
  }

  private async buildLocalInventory(): Promise<Map<string, { hash: string; exists: boolean }>> {
    const inventory = new Map<string, { hash: string; exists: boolean }>();

    const scanDirectory = (dirPath: string, relativePath: string = '') => {
      if (!fs.existsSync(dirPath)) return;

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = pathModule.join(dirPath, entry.name);
        const relativeFilePath = relativePath
          ? normalizeVaultPath(`${relativePath}/${entry.name}`)
          : normalizeVaultPath(entry.name);

        if (entry.isDirectory()) {
          if (VaultSyncFilePolicy.shouldSyncDirectory(relativeFilePath)) {
            scanDirectory(fullPath, relativeFilePath);
          }
        } else if (entry.isFile()) {
          if (VaultSyncFilePolicy.shouldSyncFile(relativeFilePath)) {
            try {
              const content = fs.readFileSync(fullPath);
              const hash = this.calculateHash(new Uint8Array(content));
              inventory.set(relativeFilePath, { hash, exists: true });
            } catch (error) {
              console.error(`Failed to read file ${relativeFilePath}:`, error);
            }
          }
        }
      }
    };

    scanDirectory(this.vaultPath);
    return inventory;
  }

  private createSyncFile(filePath: string, localFile: { hash: string; exists: boolean }): SyncFile {
    return {
      path: filePath,
      localHash: localFile.hash,
      remoteHash: null,
      baseHash: null,
      remoteFileId: null,
      localExists: localFile.exists,
      remoteExists: false,
      isBinary: !isKnownTextFile(filePath)
    };
  }

  private async loadSyncState(): Promise<void> {
    if (!this.stateStorePath) {
      return;
    }

    try {
      if (fs.existsSync(this.stateStorePath)) {
        const content = fs.readFileSync(this.stateStorePath, 'utf-8');
        const data = JSON.parse(content);

        if (data.version && data.version !== CURRENT_STATE_VERSION) {
          throw new Error(`Incompatible sync state version: ${data.version}. Expected: ${CURRENT_STATE_VERSION}`);
        }

        this.syncState = {
          files: new Map(data.files || []),
          lastSyncTime: data.lastSyncTime || 0,
          driveChangeToken: data.driveChangeToken || null,
          driveFolderId: data.driveFolderId || null,
          version: data.version || CURRENT_STATE_VERSION
        };
        this.pendingRenames = data.pendingRenames || [];
        this.pendingDeletes = new Set(data.pendingDeletes || []);
      } else {
        this.syncState = {
          files: new Map(),
          lastSyncTime: 0,
          driveChangeToken: null,
          driveFolderId: null,
          version: CURRENT_STATE_VERSION
        };
        this.pendingRenames = [];
        this.pendingDeletes = new Set();
      }
    } catch (error) {
      throw new Error(`Failed to load sync state: ${error}. Sync aborted to prevent data loss.`);
    }
  }

  private async saveSyncState(): Promise<void> {
    if (!this.stateStorePath) return;

    try {
      const data = {
        files: Array.from(this.syncState.files.entries()),
        lastSyncTime: this.syncState.lastSyncTime,
        driveChangeToken: this.syncState.driveChangeToken,
        driveFolderId: this.syncState.driveFolderId,
        version: this.syncState.version,
        pendingRenames: this.pendingRenames,
        pendingDeletes: Array.from(this.pendingDeletes)
      };

      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.stateStorePath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save sync state: ${error}. Sync aborted to prevent data loss.`);
    }
  }

  private queueSync(): void {
    this.syncQueue.push(async () => { await this.reconcile(); });
  }

  private async processSyncQueue(): Promise<void> {
    if (this.syncQueue.length > 0 && !this.syncMutex) {
      const nextSync = this.syncQueue.shift();
      if (nextSync) {
        await nextSync();
      }
    }
  }

  async triggerManualSync(): Promise<SyncResult> {
    return this.reconcile();
  }

  async triggerStartupSync(): Promise<SyncResult> {
    await new Promise(resolve => setTimeout(resolve, this.backoffMs));
    return this.reconcile();
  }

  async triggerFocusSync(): Promise<SyncResult> {
    if (!this.syncMutex) {
      return this.reconcile();
    }
    return { synced: 0, conflicts: 0, errors: ['Sync already in progress'] };
  }

  queueRename(oldPath: string, newPath: string): void {
    this.pendingRenames.push({ oldPath: normalizeVaultPath(oldPath), newPath: normalizeVaultPath(newPath), timestamp: Date.now() });
    this.saveSyncState().catch(e => console.error("Failed to save pending rename", e));
  }

  queueDelete(filePath: string): void {
    this.pendingDeletes.add(normalizeVaultPath(filePath));
    this.saveSyncState().catch(e => console.error("Failed to save pending delete", e));
  }
}
