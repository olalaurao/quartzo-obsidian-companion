import { SyncEngine } from '../../core/sync';
import {
  DriveAdapter,
  SyncFile,
  SyncState,
  SyncResult,
  DriveFileMetadata,
  CURRENT_STATE_VERSION,
  PendingRename,
  TemporaryDriveQuotaError,
} from './types';
import { VaultSyncFilePolicy } from './file-policy';
import { normalizeVaultPath } from './path-utils';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as pathModule from 'path';

const PAIRING_HASH_CONCURRENCY = 8;

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

export type ConflictResolution = 'keep_local' | 'keep_drive' | 'keep_newest';

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
  localModifiedAt: string | null;
  remoteModifiedAt: string | null;
}

export type SyncCenterStatus = 'synced' | 'local_changes' | 'syncing' | 'conflict' | 'error';

export interface SyncStatusSnapshot {
  status: SyncCenterStatus;
  lastSuccessfulSyncAt: string | null;
  pendingLocalChanges: number;
  conflictCount: number;
  lastError: string | null;
}

export function chooseNewestConflictResolution(artifact: ConflictArtifact): 'keep_local' | 'keep_drive' | null {
  if (!artifact.localExists || !artifact.remoteExists) return null;
  if (!artifact.localModifiedAt || !artifact.remoteModifiedAt) return null;
  const localTime = Date.parse(artifact.localModifiedAt);
  const remoteTime = Date.parse(artifact.remoteModifiedAt);
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime) || localTime === remoteTime) return null;
  return localTime > remoteTime ? 'keep_local' : 'keep_drive';
}

export interface ConflictRegistry {
  getConflicts(): ConflictArtifact[];
  resolveConflict(originalPath: string, resolution: ConflictResolution): Promise<void>;
}

export interface PairingRemoteCandidate {
  id: string;
  modifiedTime: string | null;
  quartzoHash: string | null;
  canTrash?: boolean | null;
  resolvedSha256: string;
  matchesLocal: boolean | null;
}

export interface PairingItem {
  path: string;
  status: 'identical' | 'remote_only' | 'local_only' | 'divergent' | 'ambiguous';
  localHash: string | null;
  remoteHash: string | null;
  remoteFileId?: string | null;
  remoteModifiedAt?: string | null;
  remoteCandidates?: PairingRemoteCandidate[];
}

export interface PairingScanProgress {
  phase: 'local_inventory' | 'remote_inventory' | 'resolving_ambiguities' | 'comparing';
  completed: number;
  total: number;
}

export interface PairingApplyProgress {
  phase: 'revalidating_remote' | 'baselining' | 'adopting_local' | 'pulling_remote' | 'finalizing';
  completed: number;
  total: number;
  currentPath?: string;
}

export interface PairingSummary {
  identical: PairingItem[];
  remoteOnly: PairingItem[];
  localOnly: PairingItem[];
  divergent: PairingItem[];
  ambiguous: PairingItem[];
}

export type SafeDuplicateResolutionReason = 'byte_identical' | 'single_local_match';

export interface SafeDuplicateResolution {
  path: string;
  keepFileId: string;
  trashFileIds: string[];
  reason: SafeDuplicateResolutionReason;
}

export interface SafeDuplicateTrashPlan {
  resolutions: SafeDuplicateResolution[];
  unresolvedPaths: string[];
  totalTrashFiles: number;
}

export interface SafeDuplicateTrashResult {
  trashed: number;
  resolvedPaths: number;
  skippedPaths: string[];
  errors: string[];
}

export class DriveSyncCoordinator implements ConflictRegistry {
  private syncState: SyncState;
  private driveAdapter: DriveAdapter;
  private vaultPath: string;
  private stateStorePath: string;
  private syncMutex: boolean = false;
  private syncRerunRequested = false;
  private syncRerunForceFull = false;
  private quarantinedPaths = new Set<string>();
  private expectedWatcherWrites = new Map<string, { transactionId: string; hash: string | null }>();
  private transactionCounter = 0;
  private currentTransactionId: string | null = null;
  private backoffMs: number = 1000;
  private maxBackoffMs: number = 30000;
  private conflicts: Map<string, ConflictArtifact> = new Map();
  private pendingRenames: PendingRename[] = [];
  private pendingDeletes: Set<string> = new Set();
  private lastError: string | null = null;
  private pairingRemoteHashCache = new Map<string, { modifiedTime: string | null; hash: string }>();
  private pairingApplyInProgress = false;
  private pairingApplyProgress: PairingApplyProgress | null = null;
  private pairingLastError: string | null = null;

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

  isPairingApplyInProgress(): boolean {
    return this.pairingApplyInProgress;
  }

  getPairingApplyProgress(): PairingApplyProgress | null {
    return this.pairingApplyProgress ? { ...this.pairingApplyProgress } : null;
  }

  getPairingLastError(): string | null {
    return this.pairingLastError;
  }

  private reportPairingApplyProgress(
    progress: PairingApplyProgress,
    onProgress?: (progress: PairingApplyProgress) => void
  ): void {
    this.pairingApplyProgress = { ...progress };
    onProgress?.(progress);
  }

  async resolveConflict(originalPath: string, resolution: ConflictResolution): Promise<void> {
    const normalized = normalizeVaultPath(originalPath);
    const artifact = this.conflicts.get(normalized);
    if (!artifact) return;

    const effectiveResolution = resolution === 'keep_newest'
      ? chooseNewestConflictResolution(artifact)
      : resolution;
    if (!effectiveResolution) {
      throw new Error('Keep newest is unavailable because the conflict does not have two distinct, trustworthy modification times. Choose Keep local or Keep Drive explicitly.');
    }

    const effectiveRemoteFileId = artifact.remoteFileId || this.syncState.files.get(normalized)?.remoteFileId || null;

    if (effectiveResolution === 'keep_local') {
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
        this.registerExpectedWatcherWrite(normalized, artifact.localContent);
        fs.writeFileSync(localFilePath, Buffer.from(artifact.localContent));

        let newRemoteId = effectiveRemoteFileId;
        let resolvedRemoteModifiedAt: string | null = artifact.remoteModifiedAt;
        if (effectiveRemoteFileId && artifact.remoteExists) {
          const meta = await this.driveAdapter.updateFile(effectiveRemoteFileId, artifact.localContent, artifact.localSha256);
          resolvedRemoteModifiedAt = meta.modifiedTime || resolvedRemoteModifiedAt;
        } else {
          const driveFolderId = this.syncState.driveFolderId || '';
          const meta = await this.driveAdapter.uploadFile({ folderId: driveFolderId, name: normalized, content: artifact.localContent, quartzoHash: artifact.localSha256 });
          newRemoteId = meta.id!;
          resolvedRemoteModifiedAt = meta.modifiedTime || resolvedRemoteModifiedAt;
        }

        const syncFile = this.syncState.files.get(normalized) || this.createSyncFile(normalized, { hash: artifact.localSha256, exists: true });
        syncFile.baseHash = artifact.localSha256;
        syncFile.localHash = artifact.localSha256;
        syncFile.remoteHash = artifact.localSha256;
        syncFile.localExists = true;
        syncFile.remoteExists = true;
        syncFile.localModifiedAt = fs.statSync(localFilePath).mtime.toISOString();
        syncFile.remoteModifiedAt = resolvedRemoteModifiedAt;
        if (newRemoteId) syncFile.remoteFileId = newRemoteId;
        this.syncState.files.set(normalized, syncFile);
      }
    } else {
      if (!artifact.remoteExists) {
        // Remote delete wins
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        if (fs.existsSync(localFilePath)) {
          this.registerExpectedWatcherWrite(normalized, null);
          fs.unlinkSync(localFilePath);
        }
        this.syncState.files.delete(normalized);
      } else {
        // Remote edit wins
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        const dir = pathModule.dirname(localFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.registerExpectedWatcherWrite(normalized, artifact.remoteContent);
        fs.writeFileSync(localFilePath, Buffer.from(artifact.remoteContent));

        const syncFile = this.syncState.files.get(normalized) || this.createSyncFile(normalized, { hash: artifact.remoteSha256, exists: true });
        syncFile.baseHash = artifact.remoteSha256;
        syncFile.localHash = artifact.remoteSha256;
        syncFile.remoteHash = artifact.remoteSha256;
        syncFile.localExists = true;
        syncFile.remoteExists = true;
        syncFile.localModifiedAt = fs.statSync(localFilePath).mtime.toISOString();
        syncFile.remoteModifiedAt = artifact.remoteModifiedAt;
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
              remoteExists: meta.remote?.exists ?? (meta.remote?.fileId != null),
              localModifiedAt: typeof meta.local?.modifiedAt === 'string' ? meta.local.modifiedAt : null,
              remoteModifiedAt: typeof meta.remote?.modifiedAt === 'string' ? meta.remote.modifiedAt : null
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
                remoteExists: metaRemoteExists,
                localModifiedAt: null,
                remoteModifiedAt: null
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
                remoteExists: metaRemoteExists,
                localModifiedAt: null,
                remoteModifiedAt: null
              });
            }
          } catch { /* skip corrupt artifact */ }
        }
      }
    };

    walkDir(conflictDir, '');
  }

  async reconcile(forceFull = false): Promise<SyncResult> {
    if (this.syncMutex) {
      this.syncRerunRequested = true;
      this.syncRerunForceFull = this.syncRerunForceFull || forceFull;
      return { synced: 0, conflicts: 0, errors: ['Sync already in progress, coalesced'] };
    }

    this.syncMutex = true;
    this.currentTransactionId = `sync-${Date.now()}-${++this.transactionCounter}`;
    this.quarantinedPaths.clear();
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

      if (!forceFull && this.syncState.driveChangeToken) {
        await this.processChanges(localInventory, result);
        const freshLocalInventory = await this.buildLocalInventory();
        await this.processLocalDirty(freshLocalInventory, result);
      } else {
        await this.fullInventory(localInventory, result);
        const startToken = await this.driveAdapter.getStartPageToken();
        this.syncState.driveChangeToken = startToken;
      }

      if (result.errors.length === 0) {
        this.syncState.lastSyncTime = Date.now();
        this.lastError = null;
      } else {
        this.lastError = result.errors[result.errors.length - 1] ?? null;
      }
      await this.saveSyncState();
      this.backoffMs = 1000;
    } catch (error) {
      const message = `Sync failed: ${error}`;
      result.errors.push(message);
      this.lastError = message;
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    } finally {
      this.syncMutex = false;
      this.currentTransactionId = null;
      if (this.syncRerunRequested) {
        this.syncRerunRequested = false;
        const rerunForceFull = this.syncRerunForceFull;
        this.syncRerunForceFull = false;
        void this.reconcile(rerunForceFull);
      }
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
    const candidatesByPath = new Map<string, DriveFileMetadata[]>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath || !VaultSyncFilePolicy.shouldSyncRemoteFile(remotePath, file.mimeType)) continue;
      const normalizedRemote = normalizeVaultPath(remotePath);
      const candidates = candidatesByPath.get(normalizedRemote) || [];
      candidates.push(file);
      candidatesByPath.set(normalizedRemote, candidates);
    }

    for (const [remotePath, candidates] of candidatesByPath) {
      const uniqueIds = new Set(candidates.map(candidate => candidate.id));
      if (uniqueIds.size > 1) {
        this.quarantinedPaths.add(remotePath);
        result.errors.push(`Ambiguous remote identity for ${remotePath}: ${[...uniqueIds].join(', ')}`);
        result.conflicts++;
        continue;
      }
      remoteFileMap.set(remotePath, candidates[0]);
    }

    if (this.quarantinedPaths.size > 0) {
      throw new Error(`Ambiguous remote path identity detected for: ${[...this.quarantinedPaths].join(', ')}`);
    }

    for (const [localPath, localFile] of localInventory) {
      const normalizedLocal = normalizeVaultPath(localPath);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedLocal)) continue;
      if (this.quarantinedPaths.has(normalizedLocal)) continue;

      const remoteFile = remoteFileMap.get(normalizedLocal);
      const syncFile = this.syncState.files.get(normalizedLocal) || this.createSyncFile(normalizedLocal, localFile);

      let remoteHash = remoteFile ? await this.driveAdapter.resolveRemoteHash(remoteFile) : null;
      if (remoteFile) remoteFile.quartzoHash = remoteHash;
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

    const allKnown = new Set([...localInventory.keys(), ...remoteFileMap.keys(), ...this.quarantinedPaths]);
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
        // Drive Changes may report a trashed resource as an ordinary file
        // change (removed=false). Trashed resources are remote absence, never
        // live path candidates, otherwise a recently cleaned duplicate can
        // falsely collide with the retained canonical remote ID.
        if (change.removed || change.file?.trashed === true) {
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
        if (!remotePath) continue;
        const normalizedRemote = normalizeVaultPath(remotePath);
        if (!VaultSyncFilePolicy.shouldSyncRemoteFile(normalizedRemote, change.file.mimeType)) {
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

        const pathOwner = this.syncState.files.get(normalizedRemote);
        if (pathOwner?.remoteFileId && pathOwner.remoteFileId !== change.file.id) {
          const trackedRemoteId = pathOwner.remoteFileId;
          const trackedOwnerStillLive = await this.isTrackedRemoteIdentityLiveAtPath(
            trackedRemoteId,
            normalizedRemote,
            driveFolderId
          );
          if (trackedOwnerStillLive) {
            throw new Error(
              `Ambiguous incremental remote identity for ${normalizedRemote}: ${trackedRemoteId} vs ${change.file.id}`
            );
          }

          // The persisted owner can legitimately become stale after safe duplicate
          // cleanup or another remote delete/move. Preserve the previous baseline
          // hashes, but stop treating that stale file ID as a live path owner so
          // the incoming live candidate can be reconciled through the normal
          // three-way matrix.
          pathOwner.remoteFileId = null;
          pathOwner.remoteExists = false;
          pathOwner.remoteModifiedAt = null;
          this.syncState.files.set(normalizedRemote, pathOwner);
        }

        let localFile = localInventory.get(normalizedRemote);
        let syncFile = pathOwner;

        if (!syncFile) {
          const existingSyncFile = this.findSyncFileByRemoteId(change.file.id);
          if (existingSyncFile && existingSyncFile.path !== normalizedRemote) {
            const oldKey = existingSyncFile.path;
            const oldLocal = localInventory.get(oldKey);
            const destinationLocal = localInventory.get(normalizedRemote);

            this.syncState.files.delete(oldKey);
            existingSyncFile.path = normalizedRemote;
            this.syncState.files.set(normalizedRemote, existingSyncFile);
            syncFile = existingSyncFile;

            if (destinationLocal) {
              // Destination collision: keep the tracked remote identity at the
              // new path, but quarantine BOTH independent local candidates.
              result.conflicts++;
              await this.handleConflict(normalizedRemote, destinationLocal, change.file, syncFile);
              if (oldLocal) {
                const oldShadow = this.createSyncFile(oldKey, oldLocal);
                oldShadow.baseHash = null;
                oldShadow.remoteFileId = null;
                this.syncState.files.set(oldKey, oldShadow);
                result.conflicts++;
                await this.handleConflict(oldKey, oldLocal, undefined, oldShadow);
              }
              continue;
            }

            if (oldLocal) {
              const oldLocalPath = pathModule.join(this.vaultPath, oldKey);
              const newLocalPath = pathModule.join(this.vaultPath, normalizedRemote);
              const bytes = new Uint8Array(fs.readFileSync(oldLocalPath));
              this.registerExpectedWatcherWrite(oldKey, null);
              this.registerExpectedWatcherWrite(normalizedRemote, bytes);
              const newDir = pathModule.dirname(newLocalPath);
              if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
              fs.renameSync(oldLocalPath, newLocalPath);
              localInventory.delete(oldKey);
              localInventory.set(normalizedRemote, oldLocal);
              localFile = oldLocal;
            } else {
              await this.pullFile(normalizedRemote, change.file, syncFile);
              result.synced++;
              continue;
            }
          } else {
            syncFile = this.createSyncFile(normalizedRemote, localFile || { hash: '', exists: false });
          }
        }

        const remoteHash = await this.driveAdapter.resolveRemoteHash(change.file);
        change.file.quartzoHash = remoteHash;
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
    let renameRemoteInventory: DriveFileMetadata[] | null = null;
    for (const rename of this.pendingRenames) {
      const oldSyncFile = this.syncState.files.get(rename.oldPath);
      if (!oldSyncFile || !oldSyncFile.remoteFileId) {
        continue; // Discard invalid intents
      }

      const newLocalFile = localInventory.get(rename.newPath);
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

  private isDriveNotFoundError(error: unknown): boolean {
    const typed = error as {
      code?: number;
      status?: number;
      response?: { status?: number };
    };
    return typed.code === 404 || typed.status === 404 || typed.response?.status === 404;
  }

  private async isTrackedRemoteIdentityLiveAtPath(
    remoteFileId: string,
    expectedPath: string,
    rootFolderId: string
  ): Promise<boolean> {
    let metadata: DriveFileMetadata;
    try {
      metadata = await this.driveAdapter.getFileMetadata(remoteFileId);
    } catch (error) {
      if (this.isDriveNotFoundError(error)) return false;
      throw error;
    }

    if (metadata.trashed === true) return false;
    if (!await this.proveAncestryToRoot(metadata, rootFolderId)) return false;

    const actualPath = await this.resolveRemotePath(metadata, rootFolderId);
    if (!actualPath) return false;
    const normalizedActual = normalizeVaultPath(actualPath);
    if (normalizedActual !== expectedPath) return false;
    return VaultSyncFilePolicy.shouldSyncRemoteFile(normalizedActual, metadata.mimeType);
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
    if (file.relativePath) return normalizeVaultPath(file.relativePath);
    if (file.name && file.name.includes('/')) return normalizeVaultPath(file.name);

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
    syncFile.localModifiedAt = fs.statSync(localFilePath).mtime.toISOString();
    syncFile.remoteModifiedAt = metadata.modifiedTime || null;

    this.syncState.files.set(filePath, syncFile);
  }

  private async pullFile(filePath: string, remoteFile: DriveFileMetadata, syncFile: SyncFile): Promise<void> {
    const content = await this.driveAdapter.downloadFile(remoteFile.id);
    const localFilePath = pathModule.join(this.vaultPath, filePath);

    const localDir = pathModule.dirname(localFilePath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    this.registerExpectedWatcherWrite(filePath, content);
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
    syncFile.localModifiedAt = fs.statSync(localFilePath).mtime.toISOString();
    syncFile.remoteModifiedAt = remoteFile.modifiedTime || null;

    this.syncState.files.set(filePath, syncFile);
  }

  private async deleteLocalFile(filePath: string): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    if (fs.existsSync(localFilePath)) {
      this.registerExpectedWatcherWrite(filePath, null);
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

    let localContent = new Uint8Array();
    let remoteContent = new Uint8Array();

    if (fs.existsSync(localFilePath)) {
      localContent = new Uint8Array(fs.readFileSync(localFilePath));
    }

    if (remoteFile) {
      remoteContent = await this.driveAdapter.downloadFile(remoteFile.id);
    }

    const isBinary = !isKnownTextFile(filePath) && (
      (localContent.length > 0 && isBinaryByContent(localContent)) ||
      (remoteContent.length > 0 && isBinaryByContent(remoteContent))
    );
    const localModifiedAt = localFile.exists && fs.existsSync(localFilePath)
      ? fs.statSync(localFilePath).mtime.toISOString()
      : null;
    const remoteModifiedAt = remoteFile?.modifiedTime || null;

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
        local: { sha256: localSha256, size: localContent.length, exists: localFile.exists, modifiedAt: localModifiedAt },
        remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || syncFile.remoteFileId || null, exists: remoteFile != null, modifiedAt: remoteModifiedAt },
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
        local: { sha256: localSha256, size: localContent.length, exists: localFile.exists, modifiedAt: localModifiedAt },
        remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || syncFile.remoteFileId || null, exists: remoteFile != null, modifiedAt: remoteModifiedAt },
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
      remoteExists: remoteFile != null,
      localModifiedAt,
      remoteModifiedAt
    });
  }

  private calculateHash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  getSyncState(): SyncState {
    return { ...this.syncState, files: new Map(this.syncState.files) };
  }

  async getSyncStatusSnapshot(): Promise<SyncStatusSnapshot> {
    const pendingLocalChanges = await this.countPendingLocalChanges();
    const conflictCount = this.conflicts.size;
    const status: SyncCenterStatus = this.syncMutex || this.pairingApplyInProgress
      ? 'syncing'
      : conflictCount > 0
        ? 'conflict'
        : this.lastError
          ? 'error'
          : pendingLocalChanges > 0
            ? 'local_changes'
            : 'synced';
    return {
      status,
      lastSuccessfulSyncAt: this.syncState.lastSyncTime > 0 ? new Date(this.syncState.lastSyncTime).toISOString() : null,
      pendingLocalChanges,
      conflictCount,
      lastError: this.lastError,
    };
  }

  private async countPendingLocalChanges(): Promise<number> {
    const changed = new Set<string>();
    for (const rename of this.pendingRenames) {
      changed.add(rename.oldPath);
      changed.add(rename.newPath);
    }
    for (const deleted of this.pendingDeletes) changed.add(deleted);

    const localInventory = await this.buildLocalInventory();
    for (const [filePath, localFile] of localInventory) {
      const syncFile = this.syncState.files.get(filePath);
      if (!syncFile || !syncFile.remoteFileId || syncFile.localHash !== localFile.hash) changed.add(filePath);
    }
    for (const [filePath, syncFile] of this.syncState.files) {
      if (syncFile.localExists && !localInventory.has(filePath)) changed.add(filePath);
    }
    return changed.size;
  }

  async setDriveFolderId(folderId: string): Promise<void> {
    if (this.syncState.driveFolderId && this.syncState.driveFolderId !== folderId) {
      this.pairingRemoteHashCache.clear();
    }
    await this.driveAdapter.setFolderId(folderId);
    this.syncState.driveFolderId = folderId;
  }

  private async resolvePairingRemoteHash(metadata: DriveFileMetadata): Promise<string> {
    if (metadata.quartzoHash) return metadata.quartzoHash;

    const modifiedTime = metadata.modifiedTime || null;
    const cached = this.pairingRemoteHashCache.get(metadata.id);
    if (cached && cached.modifiedTime === modifiedTime) {
      return cached.hash;
    }

    const hash = await this.driveAdapter.resolveRemoteHash(metadata);
    this.pairingRemoteHashCache.set(metadata.id, { modifiedTime, hash });
    return hash;
  }

  private async buildRemoteCandidates(driveFolderId: string): Promise<Map<string, DriveFileMetadata[]>> {
    const remoteCandidates = new Map<string, DriveFileMetadata[]>();
    const remoteFiles = await this.driveAdapter.listAllFiles(driveFolderId);
    for (const file of remoteFiles) {
      if (file.trashed === true) continue;
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath) continue;
      const normalizedRemote = normalizeVaultPath(remotePath);
      if (!VaultSyncFilePolicy.shouldSyncRemoteFile(normalizedRemote, file.mimeType)) continue;
      const candidates = remoteCandidates.get(normalizedRemote) || [];
      candidates.push(file);
      remoteCandidates.set(normalizedRemote, candidates);
    }
    return remoteCandidates;
  }

  async generatePairingSummary(onProgress?: (progress: PairingScanProgress) => void): Promise<PairingSummary> {
    const summary: PairingSummary = { identical: [], remoteOnly: [], localOnly: [], divergent: [], ambiguous: [] };
    const driveFolderId = this.syncState.driveFolderId || '';
    if (!driveFolderId) return summary;

    onProgress?.({ phase: 'local_inventory', completed: 0, total: 0 });
    const localInventory = await this.buildLocalInventory();

    onProgress?.({ phase: 'remote_inventory', completed: 0, total: 0 });
    const remoteCandidates = await this.buildRemoteCandidates(driveFolderId);
    const remoteMap = new Map<string, DriveFileMetadata>();
    const ambiguousGroups: Array<{
      path: string;
      localHash: string | null;
      candidates: DriveFileMetadata[];
    }> = [];

    for (const [remotePath, candidates] of remoteCandidates) {
      const candidatesById = new Map<string, DriveFileMetadata>();
      for (const candidate of candidates) {
        if (!candidatesById.has(candidate.id)) candidatesById.set(candidate.id, candidate);
      }
      const uniqueCandidates = Array.from(candidatesById.values());
      if (uniqueCandidates.length > 1) {
        ambiguousGroups.push({
          path: remotePath,
          localHash: localInventory.get(remotePath)?.hash || null,
          candidates: uniqueCandidates,
        });
        continue;
      }
      if (uniqueCandidates.length === 1) remoteMap.set(remotePath, uniqueCandidates[0]);
    }

    const ambiguousJobs = ambiguousGroups.flatMap(group =>
      group.candidates.map(candidate => ({ group, candidate }))
    );
    const resolvedAmbiguousHashes = new Map<string, string>();
    let ambiguityCompleted = 0;
    onProgress?.({
      phase: 'resolving_ambiguities',
      completed: ambiguityCompleted,
      total: ambiguousJobs.length,
    });

    let ambiguityIndex = 0;
    const ambiguityWorkerCount = Math.min(PAIRING_HASH_CONCURRENCY, ambiguousJobs.length);
    const ambiguityWorkers = Array.from({ length: ambiguityWorkerCount }, async () => {
      while (true) {
        const index = ambiguityIndex++;
        if (index >= ambiguousJobs.length) return;
        const { group, candidate } = ambiguousJobs[index];
        const resolvedSha256 = await this.resolvePairingRemoteHash(candidate);
        resolvedAmbiguousHashes.set(`${group.path}\0${candidate.id}`, resolvedSha256);
        ambiguityCompleted++;
        onProgress?.({
          phase: 'resolving_ambiguities',
          completed: ambiguityCompleted,
          total: ambiguousJobs.length,
        });
      }
    });
    await Promise.all(ambiguityWorkers);

    for (const group of ambiguousGroups) {
      summary.ambiguous.push({
        path: group.path,
        status: 'ambiguous',
        localHash: group.localHash,
        remoteHash: null,
        remoteCandidates: group.candidates
          .map(candidate => {
            const resolvedSha256 = resolvedAmbiguousHashes.get(`${group.path}\0${candidate.id}`);
            if (!resolvedSha256) {
              throw new Error(`Missing resolved SHA-256 for ambiguous candidate ${candidate.id} at ${group.path}`);
            }
            return {
              id: candidate.id,
              modifiedTime: candidate.modifiedTime || null,
              quartzoHash: candidate.quartzoHash || null,
              canTrash: candidate.canTrash ?? null,
              resolvedSha256,
              matchesLocal: group.localHash == null ? null : resolvedSha256 === group.localHash,
            };
          })
          .sort((a, b) => a.id.localeCompare(b.id)),
      });
    }

    const ambiguousPaths = new Set(summary.ambiguous.map(item => item.path));
    const allPaths = new Set([...localInventory.keys(), ...remoteMap.keys()]);
    const sharedPaths: string[] = [];

    for (const filePath of allPaths) {
      if (ambiguousPaths.has(filePath)) continue;
      const localEntry = localInventory.get(filePath);
      const remoteEntry = remoteMap.get(filePath);
      const localHash = localEntry?.hash || null;
      const localExists = localEntry?.exists ?? false;
      const remoteExists = remoteEntry != null;

      if (localExists && remoteExists) {
        sharedPaths.push(filePath);
      } else if (localExists && !remoteExists) {
        summary.localOnly.push({ path: filePath, status: 'local_only', localHash, remoteHash: null });
      } else if (!localExists && remoteExists) {
        summary.remoteOnly.push({
          path: filePath,
          status: 'remote_only',
          localHash: null,
          remoteHash: remoteEntry.quartzoHash || null,
          remoteFileId: remoteEntry.id,
          remoteModifiedAt: remoteEntry.modifiedTime || null,
        });
      }
    }

    let completed = 0;
    onProgress?.({ phase: 'comparing', completed, total: sharedPaths.length });
    let nextIndex = 0;
    const workerCount = Math.min(PAIRING_HASH_CONCURRENCY, sharedPaths.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= sharedPaths.length) return;
        const filePath = sharedPaths[index];
        const localEntry = localInventory.get(filePath);
        const remoteEntry = remoteMap.get(filePath);
        if (!localEntry || !remoteEntry) continue;

        const remoteHash = await this.resolvePairingRemoteHash(remoteEntry);
        const item: PairingItem = {
          path: filePath,
          status: localEntry.hash === remoteHash ? 'identical' : 'divergent',
          localHash: localEntry.hash,
          remoteHash,
          remoteFileId: remoteEntry.id,
          remoteModifiedAt: remoteEntry.modifiedTime || null,
        };
        if (item.status === 'identical') summary.identical.push(item);
        else summary.divergent.push(item);

        completed++;
        onProgress?.({ phase: 'comparing', completed, total: sharedPaths.length });
      }
    });
    await Promise.all(workers);

    const byPath = (a: PairingItem, b: PairingItem) => a.path.localeCompare(b.path);
    summary.identical.sort(byPath);
    summary.remoteOnly.sort(byPath);
    summary.localOnly.sort(byPath);
    summary.divergent.sort(byPath);
    summary.ambiguous.sort(byPath);
    return summary;
  }

  buildSafeDuplicateTrashPlan(summary: PairingSummary): SafeDuplicateTrashPlan {
    const resolutions: SafeDuplicateResolution[] = [];
    const unresolvedPaths: string[] = [];

    for (const item of summary.ambiguous) {
      const byId = new Map((item.remoteCandidates ?? []).map(candidate => [candidate.id, candidate]));
      const candidates = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
      if (!item.localHash || candidates.length < 2) {
        unresolvedPaths.push(item.path);
        continue;
      }

      const distinctHashes = new Set(candidates.map(candidate => candidate.resolvedSha256));
      const matchingLocal = candidates.filter(candidate => candidate.matchesLocal === true);

      if (distinctHashes.size === 1 && matchingLocal.length === candidates.length) {
        const cannotTrash = candidates.filter(candidate => candidate.canTrash !== true);
        if (cannotTrash.length > 1) {
          unresolvedPaths.push(item.path);
          continue;
        }
        // When every candidate is byte-identical, preserve the one Drive says we
        // cannot trash and remove only candidates the current account may trash.
        // This avoids choosing an arbitrary file ID that later fails with 403.
        const keep = cannotTrash[0] ?? candidates[0];
        const trashCandidates = candidates.filter(candidate => candidate.id !== keep.id);
        if (trashCandidates.some(candidate => candidate.canTrash !== true)) {
          unresolvedPaths.push(item.path);
          continue;
        }
        resolutions.push({
          path: item.path,
          keepFileId: keep.id,
          trashFileIds: trashCandidates.map(candidate => candidate.id),
          reason: 'byte_identical',
        });
        continue;
      }

      if (matchingLocal.length === 1) {
        const keep = matchingLocal[0];
        const trashCandidates = candidates.filter(candidate => candidate.id !== keep.id);
        if (trashCandidates.some(candidate => candidate.canTrash !== true)) {
          unresolvedPaths.push(item.path);
          continue;
        }
        resolutions.push({
          path: item.path,
          keepFileId: keep.id,
          trashFileIds: trashCandidates.map(candidate => candidate.id),
          reason: 'single_local_match',
        });
        continue;
      }

      unresolvedPaths.push(item.path);
    }

    return {
      resolutions,
      unresolvedPaths,
      totalTrashFiles: resolutions.reduce((total, resolution) => total + resolution.trashFileIds.length, 0),
    };
  }

  async trashSafePairingDuplicates(summary: PairingSummary): Promise<SafeDuplicateTrashResult> {
    const plan = this.buildSafeDuplicateTrashPlan(summary);
    const result: SafeDuplicateTrashResult = {
      trashed: 0,
      resolvedPaths: 0,
      skippedPaths: [],
      errors: [],
    };
    const driveFolderId = this.syncState.driveFolderId || '';
    if (!driveFolderId) {
      result.errors.push('No selected Drive vault.');
      return result;
    }

    const localInventory = await this.buildLocalInventory();
    const freshRemoteCandidates = await this.buildRemoteCandidates(driveFolderId);
    const summaryByPath = new Map(summary.ambiguous.map(item => [item.path, item]));

    for (const resolution of plan.resolutions) {
      const summaryItem = summaryByPath.get(resolution.path);
      if (!summaryItem) {
        result.skippedPaths.push(resolution.path);
        continue;
      }

      const currentLocalHash = localInventory.get(resolution.path)?.hash || null;
      if (currentLocalHash !== summaryItem.localHash) {
        result.skippedPaths.push(resolution.path);
        result.errors.push(`Local file changed since scan: ${resolution.path}. Rescan before cleanup.`);
        continue;
      }

      const freshById = new Map<string, DriveFileMetadata>();
      for (const candidate of freshRemoteCandidates.get(resolution.path) ?? []) {
        if (!freshById.has(candidate.id)) freshById.set(candidate.id, candidate);
      }
      const scannedCandidates = summaryItem.remoteCandidates ?? [];
      if (
        freshById.size !== scannedCandidates.length ||
        scannedCandidates.some(candidate => !freshById.has(candidate.id))
      ) {
        result.skippedPaths.push(resolution.path);
        result.errors.push(`Drive candidates changed since scan: ${resolution.path}. Rescan before cleanup.`);
        continue;
      }

      const snapshotChanged = scannedCandidates.some(candidate => {
        const fresh = freshById.get(candidate.id);
        if (!fresh) return true;
        return (fresh.modifiedTime || null) !== candidate.modifiedTime ||
          (fresh.quartzoHash || null) !== candidate.quartzoHash ||
          (fresh.canTrash ?? null) !== candidate.canTrash;
      });
      if (snapshotChanged) {
        result.skippedPaths.push(resolution.path);
        result.errors.push(`Drive content changed since scan: ${resolution.path}. Rescan before cleanup.`);
        continue;
      }

      const currentPlan = this.buildSafeDuplicateTrashPlan({
        identical: [],
        remoteOnly: [],
        localOnly: [],
        divergent: [],
        ambiguous: [summaryItem],
      });
      const currentResolution = currentPlan.resolutions[0];
      if (
        !currentResolution ||
        currentResolution.keepFileId !== resolution.keepFileId ||
        currentResolution.trashFileIds.join('\0') !== resolution.trashFileIds.join('\0')
      ) {
        result.skippedPaths.push(resolution.path);
        result.errors.push(`Safe duplicate plan changed: ${resolution.path}. Rescan before cleanup.`);
        continue;
      }

      let pathComplete = true;
      for (const fileId of resolution.trashFileIds) {
        try {
          await this.driveAdapter.trashFile(fileId);
          result.trashed++;
        } catch (error) {
          pathComplete = false;
          result.errors.push(`Failed to move duplicate ${fileId} for ${resolution.path} to Drive trash: ${error}`);
        }
      }
      if (pathComplete) result.resolvedPaths++;
    }

    return result;
  }

  private establishPairingBaseline(
    filePath: string,
    localHash: string,
    remoteHash: string,
    remoteEntry: DriveFileMetadata
  ): void {
    const syncFile = this.createSyncFile(filePath, { hash: localHash, exists: true });
    syncFile.baseHash = localHash;
    syncFile.localHash = localHash;
    syncFile.remoteHash = remoteHash;
    syncFile.remoteFileId = remoteEntry.id;
    syncFile.localExists = true;
    syncFile.remoteExists = true;
    syncFile.remoteModifiedAt = remoteEntry.modifiedTime || null;
    this.syncState.files.set(filePath, syncFile);
  }

  async applyPairingDecisions(
    summary: PairingSummary,
    decisions: { autoAdopt: boolean; autoPull: boolean },
    onProgress?: (progress: PairingApplyProgress) => void
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };
    if (this.pairingApplyInProgress) {
      result.errors.push('Pairing already in progress. Wait for the current pairing operation to finish.');
      return result;
    }

    this.pairingApplyInProgress = true;
    this.pairingApplyProgress = null;
    this.pairingLastError = null;
    try {
      const driveFolderId = this.syncState.driveFolderId || '';

      if (summary.ambiguous.length > 0 || summary.divergent.length > 0) {
        result.errors.push('Pairing decisions blocked: unresolved divergent or ambiguous identities remain.');
        this.pairingLastError = result.errors.join('; ');
        return result;
      }

      this.reportPairingApplyProgress({ phase: 'revalidating_remote', completed: 0, total: 0 }, onProgress);
    const remoteCandidates = await this.buildRemoteCandidates(driveFolderId);
    const remoteMap = new Map<string, DriveFileMetadata>();
    for (const [remotePath, candidates] of remoteCandidates) {
      const uniqueIds = new Set(candidates.map(candidate => candidate.id));
      if (uniqueIds.size > 1) {
        result.errors.push(`Pairing changed: ambiguous remote identity for ${remotePath}. Rescan before pairing.`);
        continue;
      }
      remoteMap.set(remotePath, candidates[0]);
    }
    if (result.errors.length > 0) {
      this.pairingLastError = result.errors.join('; ');
      return result;
    }

    let baselineCompleted = 0;
      this.reportPairingApplyProgress(
        { phase: 'baselining', completed: baselineCompleted, total: summary.identical.length },
        onProgress
      );
    for (const item of summary.identical) {
        this.reportPairingApplyProgress({
          phase: 'baselining',
          completed: baselineCompleted,
          total: summary.identical.length,
          currentPath: item.path,
        }, onProgress);
      const remoteEntry = remoteMap.get(item.path);
      const localFilePath = pathModule.join(this.vaultPath, item.path);
      if (!remoteEntry) {
        result.errors.push(`Pairing changed for ${item.path}: remote file no longer exists. Rescan before pairing.`);
        continue;
      }
      if (!fs.existsSync(localFilePath)) {
        result.errors.push(`Pairing changed for ${item.path}: local file no longer exists. Rescan before pairing.`);
        continue;
      }
      const localContent = new Uint8Array(fs.readFileSync(localFilePath));
      const localHash = this.calculateHash(localContent);
      const sameRemoteSnapshot =
        remoteEntry.id === item.remoteFileId &&
        (remoteEntry.modifiedTime || null) === (item.remoteModifiedAt || null);
      const remoteHash = sameRemoteSnapshot && item.remoteHash
        ? item.remoteHash
        : await this.resolvePairingRemoteHash(remoteEntry);
      if (localHash !== remoteHash) {
        const drift: string[] = [];
        if (localHash !== item.localHash) drift.push('local content changed since scan');
        if (remoteEntry.id !== item.remoteFileId || remoteHash !== item.remoteHash) {
          drift.push('Drive content or identity changed since scan');
        }
        const detail = drift.length > 0 ? drift.join('; ') : 'fresh local and Drive hashes differ';
        result.errors.push(
          `Pairing changed for ${item.path}: local and Drive content now differ (${detail}). Rescan to review the divergence.`
        );
        continue;
      }
      // Revalidation is about the current safe state, not strict snapshot equality.
      // If both sides independently changed after the summary but converge to the
      // same raw-byte SHA-256 now, establishing the current baseline is safe.
      this.establishPairingBaseline(item.path, localHash, remoteHash, remoteEntry);
      baselineCompleted++;
        this.reportPairingApplyProgress({
          phase: 'baselining',
          completed: baselineCompleted,
          total: summary.identical.length,
          currentPath: item.path,
        }, onProgress);
    }
    if (result.errors.length > 0) {
      this.pairingLastError = result.errors.join('; ');
      return result;
    }

    if (decisions.autoAdopt) {
      let adoptCompleted = 0;
        this.reportPairingApplyProgress(
          { phase: 'adopting_local', completed: adoptCompleted, total: summary.localOnly.length },
          onProgress
        );
      for (const item of summary.localOnly) {
          this.reportPairingApplyProgress({
            phase: 'adopting_local',
            completed: adoptCompleted,
            total: summary.localOnly.length,
            currentPath: item.path,
          }, onProgress);
        const normalized = normalizeVaultPath(item.path);
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        if (!fs.existsSync(localFilePath)) {
          result.errors.push(`Failed to adopt ${item.path}: local file no longer exists.`);
          continue;
        }
        const content = new Uint8Array(fs.readFileSync(localFilePath));
        const quartzoHash = this.calculateHash(content);
        const appearedRemote = remoteMap.get(item.path);
        if (appearedRemote) {
          const remoteHash = await this.resolvePairingRemoteHash(appearedRemote);
          if (remoteHash === quartzoHash) {
            this.establishPairingBaseline(normalized, quartzoHash, remoteHash, appearedRemote);
            adoptCompleted++;
            this.reportPairingApplyProgress({
              phase: 'adopting_local',
              completed: adoptCompleted,
              total: summary.localOnly.length,
              currentPath: item.path,
            }, onProgress);
            continue;
          }
          result.errors.push(
            `Pairing changed for ${item.path}: a remote file appeared with different content. Rescan to review the divergence.`
          );
          continue;
        }
        if (item.localHash && item.localHash !== quartzoHash) {
          result.errors.push(`Pairing changed for ${item.path}: local content changed. Rescan before pairing.`);
          continue;
        }
        try {
          const metadata = await this.driveAdapter.uploadFile({
            folderId: driveFolderId,
            name: normalized,
            content,
            quartzoHash,
          });
          const syncFile = this.createSyncFile(normalized, { hash: quartzoHash, exists: true });
          syncFile.baseHash = quartzoHash;
          syncFile.localHash = quartzoHash;
          syncFile.remoteHash = quartzoHash;
          syncFile.remoteFileId = metadata.id;
          syncFile.remoteExists = true;
          syncFile.remoteModifiedAt = metadata.modifiedTime || null;
          this.syncState.files.set(normalized, syncFile);
          result.synced++;
        } catch (error) {
          if (error instanceof TemporaryDriveQuotaError) throw error;
          result.errors.push(`Failed to adopt ${item.path}: ${error}`);
        }
        adoptCompleted++;
          this.reportPairingApplyProgress({
            phase: 'adopting_local',
            completed: adoptCompleted,
            total: summary.localOnly.length,
            currentPath: item.path,
          }, onProgress);
      }
    }

    if (decisions.autoPull) {
      let pullCompleted = 0;
        this.reportPairingApplyProgress(
          { phase: 'pulling_remote', completed: pullCompleted, total: summary.remoteOnly.length },
          onProgress
        );
      for (const item of summary.remoteOnly) {
          this.reportPairingApplyProgress({
            phase: 'pulling_remote',
            completed: pullCompleted,
            total: summary.remoteOnly.length,
            currentPath: item.path,
          }, onProgress);
        const remoteEntry = remoteMap.get(item.path);
        if (!remoteEntry) {
          result.errors.push(`Pairing changed for ${item.path}: remote file no longer exists. Rescan before pairing.`);
          continue;
        }
        const normalized = normalizeVaultPath(item.path);
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        if (fs.existsSync(localFilePath)) {
          const localContent = new Uint8Array(fs.readFileSync(localFilePath));
          const localHash = this.calculateHash(localContent);
          const sameRemoteSnapshot =
            remoteEntry.id === item.remoteFileId &&
            (remoteEntry.modifiedTime || null) === (item.remoteModifiedAt || null);
          const remoteHash = sameRemoteSnapshot && item.remoteHash
            ? item.remoteHash
            : await this.resolvePairingRemoteHash(remoteEntry);
          if (localHash === remoteHash) {
            this.establishPairingBaseline(normalized, localHash, remoteHash, remoteEntry);
            pullCompleted++;
            this.reportPairingApplyProgress({
              phase: 'pulling_remote',
              completed: pullCompleted,
              total: summary.remoteOnly.length,
              currentPath: item.path,
            }, onProgress);
            continue;
          }
          result.errors.push(
            `Pairing changed for ${item.path}: a local file appeared with different content. Rescan to review the divergence.`
          );
          continue;
        }
        const syncFile = this.createSyncFile(normalized, { hash: '', exists: false });
        syncFile.remoteFileId = remoteEntry.id;
        try {
          await this.pullFile(normalized, remoteEntry, syncFile);
          result.synced++;
        } catch (error) {
          if (error instanceof TemporaryDriveQuotaError) throw error;
          result.errors.push(`Failed to pull ${item.path}: ${error}`);
        }
        pullCompleted++;
          this.reportPairingApplyProgress({
            phase: 'pulling_remote',
            completed: pullCompleted,
            total: summary.remoteOnly.length,
            currentPath: item.path,
          }, onProgress);
      }
    }

      this.reportPairingApplyProgress({ phase: 'finalizing', completed: 0, total: 1 }, onProgress);
    if (result.errors.length === 0) {
      this.syncState.driveChangeToken = await this.driveAdapter.getStartPageToken();
    }
    await this.saveSyncState();
      this.reportPairingApplyProgress({ phase: 'finalizing', completed: 1, total: 1 }, onProgress);
      this.pairingLastError = result.errors.length > 0 ? result.errors.join('; ') : null;
      return result;
    } catch (error) {
      this.pairingLastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.pairingApplyInProgress = false;
      this.pairingApplyProgress = null;
    }
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
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const localModifiedAt = localFile.exists && fs.existsSync(localFilePath)
      ? fs.statSync(localFilePath).mtime.toISOString()
      : null;
    return {
      path: filePath,
      localHash: localFile.hash,
      remoteHash: null,
      baseHash: null,
      remoteFileId: null,
      localExists: localFile.exists,
      remoteExists: false,
      isBinary: !isKnownTextFile(filePath),
      localModifiedAt,
      remoteModifiedAt: null
    };
  }

  private async loadSyncState(): Promise<void> {
    if (!this.stateStorePath) {
      return;
    }

    try {
      const tempPath = `${this.stateStorePath}.tmp`;
      if (!fs.existsSync(this.stateStorePath) && fs.existsSync(tempPath)) {
        JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
        fs.renameSync(tempPath, this.stateStorePath);
      }
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
      const tempPath = `${this.stateStorePath}.tmp`;
      const dir = pathModule.dirname(this.stateStorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fd = fs.openSync(tempPath, 'w');
      try {
        fs.writeFileSync(fd, content, 'utf-8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempPath, this.stateStorePath);
    } catch (error) {
      throw new Error(`Failed to save sync state: ${error}. Sync aborted to prevent data loss.`);
    }
  }


  private registerExpectedWatcherWrite(filePath: string, content: Uint8Array | null): void {
    const normalized = normalizeVaultPath(filePath);
    const transactionId = this.currentTransactionId || `write-${Date.now()}-${++this.transactionCounter}`;
    this.expectedWatcherWrites.set(normalized, {
      transactionId,
      hash: content === null ? null : this.calculateHash(content)
    });
  }

  consumeExpectedWatcherEvent(filePath: string, content: Uint8Array | null): boolean {
    const normalized = normalizeVaultPath(filePath);
    const expected = this.expectedWatcherWrites.get(normalized);
    if (!expected || !expected.transactionId) return false;
    const actualHash = content === null ? null : this.calculateHash(content);
    if (actualHash !== expected.hash) return false;
    this.expectedWatcherWrites.delete(normalized);
    return true;
  }

  async triggerManualSync(): Promise<SyncResult> {
    return this.reconcile();
  }

  async triggerFullReconciliation(): Promise<SyncResult> {
    return this.reconcile(true);
  }

  async triggerStartupSync(): Promise<SyncResult> {
    await new Promise(resolve => setTimeout(resolve, this.backoffMs));
    return this.reconcile();
  }

  async triggerFocusSync(): Promise<SyncResult> {
    return this.reconcile();
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
