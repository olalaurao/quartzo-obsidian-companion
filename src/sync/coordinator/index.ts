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

const REMOTE_HASH_CONCURRENCY = 8;

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
  pendingDiagnostics: SyncPendingDiagnostic[];
  conflictCount: number;
  lastError: string | null;
}

export type SyncPendingDiagnosticReason =
  | 'local_create'
  | 'local_modify'
  | 'pending_delete'
  | 'pending_rename'
  | 'adoption_required'
  | 'conflict'
  | 'quarantined_duplicate_identity';

export interface SyncPendingDiagnostic {
  path: string;
  reason: SyncPendingDiagnosticReason;
  relatedPath?: string;
}

export type CanonicalRetirePreflightBlockerReason =
  | 'sync_not_ready'
  | 'conflict'
  | 'missing_baseline'
  | 'remote_changed'
  | 'remote_moved'
  | 'untracked_remote'
  | 'ambiguous_remote'
  | 'remote_unavailable';

export interface CanonicalRetirePreflightBlocker {
  path: string;
  reason: CanonicalRetirePreflightBlockerReason;
  message: string;
}

export interface CanonicalRetirePreflight {
  safePaths: string[];
  blockers: CanonicalRetirePreflightBlocker[];
}

export type SyncProgressPhase =
  | 'local_inventory'
  | 'remote_inventory'
  | 'resolving_paths'
  | 'hashing_remote'
  | 'processing_changes'
  | 'processing_local_changes'
  | 'reconciling'
  | 'finalizing';

export interface SyncProgress {
  operation: 'incremental' | 'full';
  phase: SyncProgressPhase;
  completed: number;
  total: number;
  currentPath?: string;
  startedAt: number;
  lastActivityAt: number;
  paused: boolean;
  pauseRequested?: boolean;
  cancelRequested?: boolean;
}

class SyncOperationCancelledError extends Error {
  constructor() {
    super('Sync cancelled at a safe checkpoint.');
    this.name = 'SyncOperationCancelledError';
  }
}

interface SyncOperationControl {
  paused: boolean;
  cancelRequested: boolean;
  resumeWaiters: Array<() => void>;
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
  startedAt?: number;
  lastActivityAt?: number;
  paused?: boolean;
  pauseRequested?: boolean;
  cancelRequested?: boolean;
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
  private readonly originalStateStorePath: string;
  private storageAccountId = '';
  private targetScope = '';
  private triggersSuspended = false;

  async suspendAndWait(): Promise<void> {
    this.triggersSuspended = true;
    while (this.syncMutex || this.pairingApplyInProgress) await new Promise(resolve => setTimeout(resolve, 50));
  }
  resumeTriggers(): void { this.triggersSuspended = false; }

  async setAccountIdentity(accountId: string): Promise<void> {
    if (accountId === this.storageAccountId) return;
    this.storageAccountId = accountId;
    this.ancestryCache.clear(); this.parentNameCache.clear(); this.remoteHashCache.clear();
    this.expectedWatcherWrites.clear(); this.localHashCache.clear();
  }

  private conflictRoot(): string { return this.targetScope ? `_conflicts/${this.targetScope}` : '_conflicts'; }

  private syncMutex: boolean = false;
  private syncRerunRequested = false;
  private syncRerunForceFull = false;
  private quarantinedPaths = new Set<string>();
  private expectedWatcherWrites = new Map<string, { transactionId: string; hash: string | null }>();
  // Reconstructible evidence only; never a replacement for the persisted baseline.
  // ctime/identity detect atomic replacements and edits that restore the old mtime.
  private localHashCache = new Map<string, { signature: string; hash: string }>();
  private transactionCounter = 0;
  private currentTransactionId: string | null = null;
  private backoffMs: number = 1000;
  private maxBackoffMs: number = 30000;
  private conflicts: Map<string, ConflictArtifact> = new Map();
  private pendingRenames: PendingRename[] = [];
  private pendingDeletes: Set<string> = new Set();
  // Identity of in-flight watcher intents only; the existing persisted Set
  // remains authoritative across restart. Never retire a newer same-path event.
  private readonly pendingDeleteTickets = new Map<string, object>();
  private pendingCreates: Set<string> = new Set();
  private lastError: string | null = null;
  private remoteHashCache = new Map<string, { modifiedTime: string | null; hash: string; md5Checksum?: string | null }>();
  private syncProgress: SyncProgress | null = null;
  private pairingApplyInProgress = false;
  private pairingApplyProgress: PairingApplyProgress | null = null;
  private pairingLastError: string | null = null;
  private operationControl: SyncOperationControl | null = null;

  constructor(driveAdapter: DriveAdapter, vaultPath: string, stateStorePath?: string) {
    this.driveAdapter = driveAdapter;
    this.vaultPath = vaultPath;
    this.stateStorePath = stateStorePath || '';
    this.originalStateStorePath = this.stateStorePath;
    this.syncState = {
      files: new Map(),
      lastSyncTime: 0,
      driveChangeToken: null,
      driveFolderId: null,
      version: CURRENT_STATE_VERSION
    };
  }

  getConflicts(): ConflictArtifact[] {
    return Array.from(this.conflicts.values(), artifact => SyncEngine.immutableReadingHash(artifact.originalPath)
      ? { ...artifact, localContent: new Uint8Array(artifact.localContent), remoteContent: new Uint8Array(artifact.remoteContent) }
      : artifact);
  }

  async hydratePersistedState(): Promise<void> {
    try {
      await this.loadSyncState();
      this.rehydrateConflicts();
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      throw error;
    }
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

  getSyncProgress(): SyncProgress | null {
    return this.syncProgress ? { ...this.syncProgress } : null;
  }

  pauseSync(): void {
    if (!this.operationControl || this.operationControl.cancelRequested) return;
    this.operationControl.paused = true;
    if (this.syncProgress) this.syncProgress = { ...this.syncProgress, pauseRequested: true };
    if (this.pairingApplyProgress) this.pairingApplyProgress = { ...this.pairingApplyProgress, pauseRequested: true };
  }

  resumeSync(): void {
    const control = this.operationControl;
    if (!control) return;
    control.paused = false;
    if (this.syncProgress) this.syncProgress = { ...this.syncProgress, paused: false, pauseRequested: false, lastActivityAt: Date.now() };
    if (this.pairingApplyProgress) this.pairingApplyProgress = { ...this.pairingApplyProgress, paused: false, pauseRequested: false, lastActivityAt: Date.now() };
    for (const resolve of control.resumeWaiters.splice(0)) resolve();
  }

  cancelSync(): void {
    const control = this.operationControl;
    if (!control) return;
    control.cancelRequested = true;
    control.paused = false;
    if (this.syncProgress) this.syncProgress = { ...this.syncProgress, paused: false, pauseRequested: false, cancelRequested: true };
    if (this.pairingApplyProgress) this.pairingApplyProgress = { ...this.pairingApplyProgress, paused: false, pauseRequested: false, cancelRequested: true };
    for (const resolve of control.resumeWaiters.splice(0)) resolve();
  }

  private async checkpointSync(): Promise<void> {
    const control = this.operationControl;
    if (!control) return;
    if (control.cancelRequested) throw new SyncOperationCancelledError();
    if (!control.paused) return;

    if (this.syncProgress) this.syncProgress = { ...this.syncProgress, paused: true, pauseRequested: false };
    if (this.pairingApplyProgress) this.pairingApplyProgress = { ...this.pairingApplyProgress, paused: true, pauseRequested: false };
    await this.saveSyncState();
    await new Promise<void>(resolve => control.resumeWaiters.push(resolve));
    if (control.cancelRequested) throw new SyncOperationCancelledError();
    if (this.syncProgress) this.syncProgress = { ...this.syncProgress, paused: false, pauseRequested: false, lastActivityAt: Date.now() };
    if (this.pairingApplyProgress) this.pairingApplyProgress = { ...this.pairingApplyProgress, paused: false, pauseRequested: false, lastActivityAt: Date.now() };
  }

  /**
   * Proves that a local canonical retirement can be started without allowing a
   * stale Drive copy to resurrect the source path. This is a preflight only;
   * processLocalDirty revalidates the tracked remote again immediately before
   * applying the queued rename so races remain fail-closed.
   */
  async preflightCanonicalRetire(filePaths: readonly string[]): Promise<CanonicalRetirePreflight> {
    const paths = Array.from(new Set(filePaths.map(normalizeVaultPath))).sort((a, b) => a.localeCompare(b));
    const safePaths: string[] = [];
    const blockers: CanonicalRetirePreflightBlocker[] = [];
    const driveFolderId = this.syncState.driveFolderId || '';

    if (!driveFolderId) {
      return {
        safePaths,
        blockers: paths.map(path => ({
          path,
          reason: 'sync_not_ready' as const,
          message: 'Drive sync has no paired vault identity. Reopen Sync Center before deleting.',
        })),
      };
    }

    let remoteInventory: DriveFileMetadata[] | null = null;

    for (const filePath of paths) {
      if (this.conflicts.has(filePath)) {
        blockers.push({
          path: filePath,
          reason: 'conflict',
          message: 'This path already has an unresolved sync conflict.',
        });
        continue;
      }

      const syncFile = this.syncState.files.get(filePath);
      if (syncFile?.remoteFileId) {
        if (syncFile.baseHash === null) {
          blockers.push({
            path: filePath,
            reason: 'missing_baseline',
            message: 'The tracked remote has no safe three-way baseline yet. Run Sync now first.',
          });
          continue;
        }

        try {
          const metadata = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId);
          const remotePath = await this.resolveRemotePath(metadata, driveFolderId);
          const belongsToVault = await this.proveAncestryToRoot(metadata, driveFolderId);
          if (!belongsToVault || !remotePath || normalizeVaultPath(remotePath) !== filePath) {
            blockers.push({
              path: filePath,
              reason: 'remote_moved',
              message: 'The tracked Drive file is no longer at the expected path. Run Sync now before deleting.',
            });
            continue;
          }

          const remoteHash = await this.driveAdapter.resolveRemoteHash(metadata);
          if (remoteHash !== syncFile.baseHash) {
            blockers.push({
              path: filePath,
              reason: 'remote_changed',
              message: 'Drive changed since the shared baseline. Sync and resolve the concurrent edit before deleting.',
            });
            continue;
          }

          safePaths.push(filePath);
          continue;
        } catch (error) {
          blockers.push({
            path: filePath,
            reason: 'remote_unavailable',
            message: `Could not revalidate the tracked Drive file: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
      }

      try {
        if (!remoteInventory) remoteInventory = await this.driveAdapter.listAllFiles(driveFolderId);
        const candidates: DriveFileMetadata[] = [];
        for (const candidate of remoteInventory) {
          if (!VaultSyncFilePolicy.shouldSyncRemoteFile(candidate.relativePath || candidate.name || '', candidate.mimeType)) continue;
          const candidatePath = await this.resolveRemotePath(candidate, driveFolderId);
          if (!candidatePath || normalizeVaultPath(candidatePath) !== filePath) continue;
          if (!await this.proveAncestryToRoot(candidate, driveFolderId)) continue;
          candidates.push(candidate);
        }

        if (candidates.length === 0) {
          safePaths.push(filePath);
        } else if (candidates.length === 1) {
          blockers.push({
            path: filePath,
            reason: 'untracked_remote',
            message: 'A Drive file exists at this path but is not safely baselined to this local file. Run Sync now first.',
          });
        } else {
          blockers.push({
            path: filePath,
            reason: 'ambiguous_remote',
            message: `Multiple live Drive candidates exist at this path (${candidates.map(candidate => candidate.id).join(', ')}). Resolve remote identity first.`,
          });
        }
      } catch (error) {
        blockers.push({
          path: filePath,
          reason: 'remote_unavailable',
          message: `Could not prove that Drive has no stale copy: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return { safePaths, blockers };
  }

  private beginSyncProgress(
    operation: 'incremental' | 'full',
    onProgress?: (progress: SyncProgress) => void
  ): void {
    const now = Date.now();
    this.syncProgress = {
      operation,
      phase: 'local_inventory',
      completed: 0,
      total: 0,
      startedAt: now,
      lastActivityAt: now,
      paused: false,
    };
    onProgress?.({ ...this.syncProgress });
  }

  private reportSyncProgress(
    progress: Pick<SyncProgress, 'phase' | 'completed' | 'total'> & { currentPath?: string },
    onProgress?: (progress: SyncProgress) => void
  ): void {
    const now = Date.now();
    const current = this.syncProgress;
    const next: SyncProgress = {
      operation: current?.operation ?? 'incremental',
      phase: progress.phase,
      completed: progress.completed,
      total: progress.total,
      startedAt: current?.startedAt ?? now,
      lastActivityAt: now,
      paused: current?.paused ?? false,
      pauseRequested: current?.pauseRequested ?? false,
      cancelRequested: current?.cancelRequested ?? false,
      ...(progress.currentPath ? { currentPath: progress.currentPath } : {}),
    };
    this.syncProgress = next;
    onProgress?.({ ...next });
  }

  private reportPairingApplyProgress(
    progress: Omit<PairingApplyProgress, 'startedAt' | 'lastActivityAt' | 'paused'>,
    onProgress?: (progress: PairingApplyProgress) => void
  ): void {
    const now = Date.now();
    const next: PairingApplyProgress = {
      ...progress,
      startedAt: this.pairingApplyProgress?.startedAt ?? now,
      lastActivityAt: now,
      paused: this.operationControl?.paused ?? false,
      pauseRequested: this.pairingApplyProgress?.pauseRequested ?? false,
      cancelRequested: this.operationControl?.cancelRequested ?? false,
    };
    this.pairingApplyProgress = next;
    onProgress?.({ ...next });
  }

  async resolveConflict(originalPath: string, resolution: ConflictResolution): Promise<void> {
    if (this.triggersSuspended || this.syncMutex || this.pairingApplyInProgress) throw new Error('Wait for active sync before resolving a conflict');
    this.syncMutex = true;
    try { await this.driveAdapter.verifyConditionalMutationSupport?.(); await this.resolveConflictOwned(originalPath, resolution); }
    finally {
      this.syncMutex = false;
      if (this.syncRerunRequested) { this.syncRerunRequested = false; const full = this.syncRerunForceFull; this.syncRerunForceFull = false; void this.reconcile(full); }
    }
  }

  private async resolveConflictOwned(originalPath: string, resolution: ConflictResolution): Promise<void> {
    const normalized = normalizeVaultPath(originalPath);
    const storedArtifact = this.conflicts.get(normalized);
    if (!storedArtifact) return;
    const artifact = { ...storedArtifact,
      localContent: new Uint8Array(storedArtifact.localContent),
      remoteContent: new Uint8Array(storedArtifact.remoteContent) };
    const immutableHash = SyncEngine.immutableReadingHash(normalized);
    const checkLocal = this.captureReadingLocalPath(normalized);
    const reviewedDelete = this.pendingDeletes.has(normalized);
    const deleteTicket = this.pendingDeleteTickets.get(normalized);
    const reviewedRenames = new Set(this.pendingRenames.filter(rename =>
      rename.oldPath === normalized || rename.newPath === normalized));
    if (immutableHash) {
      const selected = resolution === 'keep_local' ? artifact.localContent : artifact.remoteContent;
      const selectedExists = resolution === 'keep_local' ? artifact.localExists : artifact.remoteExists;
      if (resolution === 'keep_newest' || !selectedExists || this.calculateHash(selected) !== immutableHash) {
        throw new Error('Immutable reading history permits only explicit repair with the original filename bytes.');
      }
    }

    const effectiveResolution = resolution === 'keep_newest'
      ? chooseNewestConflictResolution(artifact)
      : resolution;
    if (!effectiveResolution) {
      throw new Error('Keep newest is unavailable because the conflict does not have two distinct, trustworthy modification times. Choose Keep local or Keep Drive explicitly.');
    }

    const effectiveRemoteFileId = artifact.remoteFileId || this.syncState.files.get(normalized)?.remoteFileId || null;
    const localPath = pathModule.join(this.vaultPath, normalized);
    const currentLocalHash = fs.existsSync(localPath) ? this.calculateHash(fs.readFileSync(localPath)) : null;
    if (currentLocalHash !== (artifact.localExists ? artifact.localSha256 : null)) throw new Error('Local conflict changed; rescan before resolving');
    if (effectiveRemoteFileId && artifact.remoteExists) {
      if (immutableHash) {
        const metadata = await this.driveAdapter.getFileMetadata(effectiveRemoteFileId);
        if (metadata.trashed || await this.resolveRemotePath(metadata, this.syncState.driveFolderId || '') !== normalized) {
          throw new Error('Immutable remote identity changed; rescan before repair');
        }
      }
      const remoteBytes = await this.driveAdapter.downloadFile(effectiveRemoteFileId, immutableHash ? normalized : undefined);
      if (this.calculateHash(remoteBytes) !== artifact.remoteSha256) throw new Error('Remote conflict changed; rescan before resolving');
    }


    checkLocal();
    if (immutableHash && (this.conflicts.get(normalized) !== storedArtifact ||
        (fs.existsSync(localPath) ? this.calculateHash(fs.readFileSync(localPath)) : null) !== currentLocalHash)) {
      throw new Error('Immutable conflict changed; rescan before repair');
    }

    if (effectiveResolution === 'keep_local') {
      if (!artifact.localExists) {
        // Local delete wins — upload tombstone then trash (reversible) the original remote.
        if (effectiveRemoteFileId) {
          const deletedPath = `_deleted/${normalized}`;
          const folderId = this.syncState.driveFolderId || '';
          await this.driveAdapter.uploadFile({ 
            folderId, 
            name: deletedPath, 
            content: artifact.remoteContent, 
            quartzoHash: artifact.remoteSha256 
          });
          // Use trashFile (reversible) instead of deleteFile per safe-cleanup contract.
          await this.driveAdapter.trashFile(effectiveRemoteFileId);
        }
        this.syncState.files.delete(normalized);
      } else {
        // Local edit wins
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        const dir = pathModule.dirname(localFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.registerExpectedWatcherWrite(normalized, artifact.localContent);
        if (!immutableHash || currentLocalHash !== immutableHash) {
          fs.writeFileSync(localFilePath, Buffer.from(artifact.localContent), {
            flag: immutableHash && currentLocalHash === null ? 'wx' : 'w',
          });
        }
        checkLocal();
        if (immutableHash && this.calculateHash(fs.readFileSync(localFilePath)) !== immutableHash) {
          throw new Error('Reading repair readback changed');
        }

        let newRemoteId = effectiveRemoteFileId;
        let resolvedRemoteModifiedAt: string | null = artifact.remoteModifiedAt;
        if (effectiveRemoteFileId && artifact.remoteExists) {
          let meta: DriveFileMetadata;
          if (immutableHash) {
            if (!this.driveAdapter.repairReadingFile) throw new Error('This adapter cannot repair Reading history safely');
            meta = await this.driveAdapter.repairReadingFile({fileId: effectiveRemoteFileId,
              relativePath: normalized, expectedRemoteHash: artifact.remoteSha256, content: artifact.localContent});
          } else {
            meta = await this.driveAdapter.updateFile(effectiveRemoteFileId, artifact.localContent, artifact.localSha256);
          }
          checkLocal();
          resolvedRemoteModifiedAt = meta.modifiedTime || resolvedRemoteModifiedAt;
        } else {
          const driveFolderId = this.syncState.driveFolderId || '';
          const meta = await this.driveAdapter.uploadFile({ folderId: driveFolderId, name: normalized, content: artifact.localContent, quartzoHash: artifact.localSha256 });
          checkLocal();
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
        if (!immutableHash || currentLocalHash !== immutableHash) {
          fs.writeFileSync(localFilePath, Buffer.from(artifact.remoteContent), {
            flag: immutableHash && currentLocalHash === null ? 'wx' : 'w',
          });
        }
        checkLocal();
        if (immutableHash && this.calculateHash(fs.readFileSync(localFilePath)) !== immutableHash) {
          throw new Error('Reading repair readback changed');
        }

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

    checkLocal();
    if (immutableHash) {
      if (reviewedDelete && this.pendingDeleteTickets.get(normalized) === deleteTicket) {
        this.pendingDeletes.delete(normalized);
        this.pendingDeleteTickets.delete(normalized);
      }
      this.pendingRenames = this.pendingRenames.filter(rename => !reviewedRenames.has(rename));
    }
    await this.saveSyncState();
    checkLocal();
    this.conflicts.delete(normalized);
    this.removeConflictArtifacts(normalized);
  }

  private removeConflictArtifacts(originalPath: string): void {
    const paths = [
      pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.local`),
      pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.remote`),
      pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.conflict.json`),
      pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.conflict`),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  private async clearConvergedConflict(filePath: string): Promise<void> {
    if (!this.conflicts.has(filePath)) return;
    // Call only after equal current hashes have advanced the baseline. Commit
    // that proof before retiring the obsolete diagnostic artifacts.
    await this.saveSyncState();
    this.conflicts.delete(filePath);
    this.removeConflictArtifacts(filePath);
  }

  private rehydrateConflicts(): void {
    const conflictDir = pathModule.join(this.vaultPath, this.conflictRoot());
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
              const localPath = pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.local`);
              const remotePath = pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.remote`);
              localContent = fs.existsSync(localPath) ? new Uint8Array(fs.readFileSync(localPath)) : new Uint8Array();
              remoteContent = fs.existsSync(remotePath) ? new Uint8Array(fs.readFileSync(remotePath)) : new Uint8Array();
            } else {
              const conflictFilePath = pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.conflict`);
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
            const conflictJsonPath = pathModule.join(this.vaultPath, this.conflictRoot(), `${originalPath}.conflict.json`);
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

  async reconcile(
    forceFull = false,
    onProgress?: (progress: SyncProgress) => void
  ): Promise<SyncResult> {
    if (this.triggersSuspended) return { synced: 0, conflicts: 0, errors: ['Sync target is changing'] };
    if (this.syncMutex) {
      this.syncRerunRequested = true;
      this.syncRerunForceFull = this.syncRerunForceFull || forceFull;
      return { synced: 0, conflicts: 0, errors: ['Sync already in progress, coalesced'] };
    }

    this.syncMutex = true;
    this.operationControl = { paused: false, cancelRequested: false, resumeWaiters: [] };
    this.currentTransactionId = `sync-${Date.now()}-${++this.transactionCounter}`;
    this.quarantinedPaths.clear();
    this.beginSyncProgress(forceFull ? 'full' : 'incremental', onProgress);
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };

    try {
      await this.loadSyncState();
      this.rehydrateConflicts();
      this.ancestryCache.clear();
      this.parentNameCache.clear();
      if (forceFull) {
        this.syncState.forceFullReconciliation = true;
        await this.saveSyncState();
      }

      const driveFolderId = await this.driveAdapter.getFolderId();
      if (!driveFolderId) {
        throw new Error('Drive folder not configured');
      }

      if (this.syncState.driveFolderId && this.syncState.driveFolderId !== driveFolderId) {
        throw new Error('Selected Drive vault differs from persisted sync identity. Pair the vault explicitly.');
      }
      this.syncState.driveFolderId = driveFolderId;

      let localYieldCounter = 0;
      await this.driveAdapter.verifyConditionalMutationSupport?.();
      const localInventory = await this.buildLocalInventory(async (completed, currentPath) => {
        await this.checkpointSync();
        this.reportSyncProgress({ phase: 'local_inventory', completed, total: 0, currentPath }, onProgress);
        if (++localYieldCounter % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      });
      this.reportSyncProgress({
        phase: 'local_inventory',
        completed: localInventory.size,
        total: localInventory.size,
      }, onProgress);

      const requiresFullReconciliation = forceFull || this.syncState.forceFullReconciliation === true || !this.syncState.driveChangeToken;
      if (!requiresFullReconciliation) {
        this.reportSyncProgress({ phase: 'processing_changes', completed: 0, total: 0 }, onProgress);
        await this.processChanges(localInventory, result, onProgress);

        this.reportSyncProgress({ phase: 'processing_local_changes', completed: 0, total: 0 }, onProgress);
        const freshLocalInventory = await this.buildLocalInventory();
        this.reportSyncProgress({
          phase: 'processing_local_changes',
          completed: 0,
          total: freshLocalInventory.size,
        }, onProgress);
        await this.processLocalDirty(freshLocalInventory, result, onProgress);
        this.reportSyncProgress({
          phase: 'processing_local_changes',
          completed: freshLocalInventory.size,
          total: freshLocalInventory.size,
        }, onProgress);
      } else {
        const startToken = await this.driveAdapter.getStartPageToken();
        await this.fullInventory(localInventory, result, onProgress);
        this.syncState.driveChangeToken = startToken;
        await this.processChanges(await this.buildLocalInventory(), result, onProgress);
        this.syncState.forceFullReconciliation = false;
      }

      this.reportSyncProgress({ phase: 'finalizing', completed: 0, total: 1 }, onProgress);
      if (result.errors.length === 0) {
        this.syncState.lastSyncTime = Date.now();
        this.lastError = null;
      } else {
        this.lastError = result.errors[result.errors.length - 1] ?? null;
      }
      await this.saveSyncState();
      this.backoffMs = 1000;
      this.reportSyncProgress({ phase: 'finalizing', completed: 1, total: 1 }, onProgress);
    } catch (error) {
      if (error instanceof SyncOperationCancelledError) {
        result.cancelled = true;
        this.syncRerunRequested = false;
        this.syncRerunForceFull = false;
        try {
          await this.saveSyncState();
        } catch (saveError) {
          result.errors.push(`Sync was cancelled, but its checkpoint could not be saved: ${saveError}`);
          this.lastError = result.errors[result.errors.length - 1];
        }
      } else {
      const message = `Sync failed: ${error}`;
      result.errors.push(message);
      this.lastError = message;
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
      }
    } finally {
      this.syncMutex = false;
      this.currentTransactionId = null;
      this.syncProgress = null;
      this.operationControl = null;
      if (this.syncRerunRequested) {
        this.syncRerunRequested = false;
        const rerunForceFull = this.syncRerunForceFull;
        this.syncRerunForceFull = false;
        void this.reconcile(rerunForceFull);
      }
    }

    return result;
  }

  /**
   * §14 Targeted shared settings sync.
   * Reconciles ONLY app/quartzo_shared_settings.md using the existing Drive adapter 
   * and coordinator state, without creating a second sync engine.
   */
  async syncSharedSettingsNow(): Promise<SyncResult> {
    if (this.syncMutex) {
      return { synced: 0, conflicts: 0, errors: ['Sync already in progress, skipped targeted settings sync'] };
    }

    this.syncMutex = true;
    this.operationControl = { paused: false, cancelRequested: false, resumeWaiters: [] };
    this.currentTransactionId = `sync-settings-${Date.now()}-${++this.transactionCounter}`;
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };
    const settingsPath = 'app/quartzo_shared_settings.md';
    this.beginSyncProgress('incremental');

    try {
      await this.loadSyncState();
      await this.checkpointSync();
      this.reportSyncProgress({ phase: 'local_inventory', completed: 0, total: 1, currentPath: settingsPath });
      
      const driveFolderId = await this.driveAdapter.getFolderId();
      await this.checkpointSync();
      if (!driveFolderId) {
        throw new Error('Drive folder not configured');
      }

      // 1. Build local state
      const localFilePath = pathModule.join(this.vaultPath, settingsPath);
      const localExists = fs.existsSync(localFilePath);
      let localHash: string | null = null;
      let localContent: Uint8Array | null = null;
      if (localExists) {
        localContent = new Uint8Array(await fs.promises.readFile(localFilePath));
        localHash = this.calculateHash(localContent);
      }
      this.reportSyncProgress({ phase: 'local_inventory', completed: 1, total: 1, currentPath: settingsPath });

      // 2. Discover remote state
      this.reportSyncProgress({ phase: 'remote_inventory', completed: 0, total: 0, currentPath: settingsPath });
      let syncFile = this.syncState.files.get(settingsPath);
      let remoteFile: DriveFileMetadata | undefined;
      
      if (syncFile && syncFile.remoteFileId) {
        try {
          remoteFile = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId);
          await this.checkpointSync();
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('404')) {
            remoteFile = undefined;
          } else {
            throw e;
          }
        }
      } else {
        // Fallback: lookup by path traversal using listFiles
        const parts = settingsPath.split('/');
        let currentFolderId = driveFolderId;
        let found = true;
        for (let i = 0; i < parts.length - 1 && found; i++) {
          await this.checkpointSync();
          const { files } = await this.driveAdapter.listFiles(currentFolderId);
          await this.checkpointSync();
          const folder = files.find(f => f.name === parts[i] && f.mimeType === 'application/vnd.google-apps.folder');
          if (!folder) { found = false; break; }
          currentFolderId = folder.id;
        }
        if (found) {
          await this.checkpointSync();
          const { files } = await this.driveAdapter.listFiles(currentFolderId);
          await this.checkpointSync();
          const match = files.find(f => f.name === parts[parts.length - 1]);
          if (match) remoteFile = match;
        }
      }

      if (!syncFile) {
        syncFile = this.createSyncFile(settingsPath, { hash: localHash || '', exists: localExists });
        if (remoteFile) syncFile.remoteFileId = remoteFile.id;
      }

      const remoteHash = remoteFile ? await this.resolveRemoteHashCached(remoteFile) : null;
      await this.checkpointSync();
      this.reportSyncProgress({ phase: 'processing_local_changes', completed: 0, total: 1, currentPath: settingsPath });

      // 3. Three-way reconciliation
      const vector = {
        id: settingsPath,
        baseHash: syncFile.baseHash,
        localHash,
        remoteHash,
        localExists,
        remoteExists: remoteFile !== undefined,
        expected: '' 
      };

      const syncDecision = SyncEngine.reconcile(vector);

      switch (syncDecision.action) {
        case 'push':
          await this.pushFile(settingsPath, { hash: localHash!, exists: true }, syncFile);
          result.synced++;
          break;
        case 'pull':
          if (remoteFile) {
            await this.pullFile(settingsPath, remoteFile, syncFile);
            result.synced++;
          }
          break;
        case 'delete_local':
          await this.deleteLocalFile(settingsPath);
          result.synced++;
          break;
        case 'conflict':
          result.conflicts++;
          await this.handleConflict(settingsPath, { hash: localHash!, exists: true }, remoteFile, syncFile);
          break;
        case 'advance_baseline':
          syncFile.baseHash = localHash ?? null;
          if (remoteFile?.id) {
            syncFile.remoteHash = remoteHash ?? null;
            syncFile.remoteFileId = remoteFile.id;
          }
          syncFile.localHash = localHash ?? '';
          this.syncState.files.set(settingsPath, syncFile);
          await this.clearConvergedConflict(settingsPath);
          break;
      }
      
      await this.checkpointSync();
      await this.saveSyncState();
      this.reportSyncProgress({ phase: 'finalizing', completed: 1, total: 1, currentPath: settingsPath });
    } catch (error) {
      if (error instanceof SyncOperationCancelledError) {
        result.cancelled = true;
        try {
          await this.saveSyncState();
        } catch (saveError) {
          result.errors.push(`Targeted settings sync was cancelled, but its checkpoint could not be saved: ${saveError}`);
        }
      } else {
        result.errors.push(`Targeted settings sync failed: ${error}`);
      }
    } finally {
      this.syncMutex = false;
      this.currentTransactionId = null;
      this.syncProgress = null;
      this.operationControl = null;
    }
    
    return result;
  }

  private async fullInventory(
    localInventory: Map<string, { hash: string; exists: boolean }>,
    result: SyncResult,
    onProgress?: (progress: SyncProgress) => void
  ): Promise<void> {
    const driveFolderId = this.syncState.driveFolderId || '';

    this.reportSyncProgress({ phase: 'remote_inventory', completed: 0, total: 0 }, onProgress);
    const remoteFiles = await this.driveAdapter.listAllFiles(driveFolderId, async completed => {
      await this.checkpointSync();
      this.reportSyncProgress({ phase: 'remote_inventory', completed, total: 0 }, onProgress);
      if (completed % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    });
    await this.checkpointSync();
    this.reportSyncProgress({
      phase: 'remote_inventory',
      completed: remoteFiles.length,
      total: remoteFiles.length,
    }, onProgress);

    const remoteFileMap = new Map<string, DriveFileMetadata>();
    const candidatesByPath = new Map<string, DriveFileMetadata[]>();

    let resolvedPaths = 0;
    this.reportSyncProgress({
      phase: 'resolving_paths',
      completed: resolvedPaths,
      total: remoteFiles.length,
    }, onProgress);
    for (const file of remoteFiles) {
      await this.checkpointSync();
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      resolvedPaths++;
      this.reportSyncProgress({
        phase: 'resolving_paths',
        completed: resolvedPaths,
        total: remoteFiles.length,
        currentPath: remotePath || file.relativePath || file.name,
      }, onProgress);
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

    const hashJobs = Array.from(remoteFileMap.entries())
      .filter(([remotePath]) => localInventory.has(remotePath));
    const resolvedRemoteHashes = new Map<string, string>();
    let hashCompleted = 0;
    this.reportSyncProgress({
      phase: 'hashing_remote',
      completed: hashCompleted,
      total: hashJobs.length,
    }, onProgress);

    let nextHashIndex = 0;
    const hashWorkerCount = Math.min(REMOTE_HASH_CONCURRENCY, hashJobs.length);
    const hashWorkers = Array.from({ length: hashWorkerCount }, async () => {
      while (true) {
        await this.checkpointSync();
        const index = nextHashIndex++;
        if (index >= hashJobs.length) return;
        const [remotePath, remoteFile] = hashJobs[index];
        const remoteHash = await this.resolveRemoteHashCached(remoteFile);
        remoteFile.quartzoHash = remoteHash;
        resolvedRemoteHashes.set(remotePath, remoteHash);
        hashCompleted++;
        this.reportSyncProgress({
          phase: 'hashing_remote',
          completed: hashCompleted,
          total: hashJobs.length,
          currentPath: remotePath,
        }, onProgress);
      }
    });
    await Promise.all(hashWorkers);

    const localEntries = Array.from(localInventory.entries())
      .filter(([localPath]) => VaultSyncFilePolicy.shouldSyncFile(normalizeVaultPath(localPath)));
    const remoteOnlyEntries = Array.from(remoteFileMap.entries())
      .filter(([remotePath]) => !localInventory.has(remotePath));
    const reconcileTotal = localEntries.length + remoteOnlyEntries.length;
    let reconcileCompleted = 0;
    this.reportSyncProgress({
      phase: 'reconciling',
      completed: reconcileCompleted,
      total: reconcileTotal,
    }, onProgress);

    for (const [localPath, localFile] of localEntries) {
      await this.checkpointSync();
      const normalizedLocal = normalizeVaultPath(localPath);
      if (this.quarantinedPaths.has(normalizedLocal)) continue;

      const remoteFile = remoteFileMap.get(normalizedLocal);
      const syncFile = this.syncState.files.get(normalizedLocal) || this.createSyncFile(normalizedLocal, localFile);
      const remoteHash = remoteFile ? (resolvedRemoteHashes.get(normalizedLocal) ?? null) : null;
      if (remoteFile && !remoteHash) {
        throw new Error(`Missing resolved remote SHA-256 for ${normalizedLocal}`);
      }
      const localHash = localFile.hash;
      const baseHash = syncFile.baseHash;

      if (remoteFile?.id) {
        syncFile.remoteFileId = remoteFile.id;
      }

      const vector = {
        id: normalizedLocal,
        baseHash,
        localHash,
        remoteHash,
        authorizedLocalCreation: this.pendingCreates.has(normalizedLocal),
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
          if (remoteFile?.id) {
            syncFile.remoteHash = remoteHash;
            syncFile.remoteFileId = remoteFile.id;
          }
          syncFile.localHash = localHash;
          this.syncState.files.set(normalizedLocal, syncFile);
          await this.clearConvergedConflict(normalizedLocal);
          break;
        case 'adoption_required':
          this.recordAdoptionPending(normalizedLocal, syncFile);
          break;
      }

      reconcileCompleted++;
      this.reportSyncProgress({
        phase: 'reconciling',
        completed: reconcileCompleted,
        total: reconcileTotal,
        currentPath: normalizedLocal,
      }, onProgress);
    }

    for (const [remotePath, remoteFile] of remoteOnlyEntries) {
      await this.checkpointSync();
      if (this.conflicts.has(remotePath) || this.pendingRenames.some(rename => rename.oldPath === remotePath)) continue;
      const tracked = this.syncState.files.get(remotePath);
      if (SyncEngine.immutableReadingHash(remotePath) && this.pendingDeletes.has(remotePath) && tracked) {
        result.conflicts++;
        await this.handleConflict(remotePath, { hash: '', exists: false }, remoteFile, tracked);
        continue;
      }
      if (!SyncEngine.immutableReadingHash(remotePath) && tracked?.baseHash !== null && tracked?.baseHash !== undefined && tracked.remoteFileId === remoteFile.id) {
        // Missing previously synchronized bytes are a local deletion, including
        // deletion while Obsidian was closed. A rescan must not resurrect them.
        // The deletion boundary freshly verifies remote bytes and the version
        // before preserving that same remote identity under _deleted/.
        this.pendingDeletes.add(remotePath);
        await this.saveSyncState();
        await this.deleteRemoteFile(remotePath, tracked);
        result.synced++;
        continue;
      }
      if (this.pendingDeletes.has(remotePath)) continue;
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

      reconcileCompleted++;
      this.reportSyncProgress({
        phase: 'reconciling',
        completed: reconcileCompleted,
        total: reconcileTotal,
        currentPath: remotePath,
      }, onProgress);
    }

    const allKnown = new Set([...localInventory.keys(), ...remoteFileMap.keys(), ...this.quarantinedPaths]);
    for (const key of this.syncState.files.keys()) {
      if (!allKnown.has(key)) {
        const tracked = this.syncState.files.get(key)!;
        if (SyncEngine.immutableReadingHash(key)) {
          result.conflicts++;
          await this.handleConflict(key, { hash: '', exists: false }, undefined, tracked);
          continue;
        }
        this.syncState.files.delete(key);
      }
    }
  }

  private async processChanges(
    localInventory: Map<string, { hash: string; exists: boolean }>,
    result: SyncResult,
    onProgress?: (progress: SyncProgress) => void
  ): Promise<void> {
    let pageToken = this.syncState.driveChangeToken;
    let processedChanges = 0;
    let newStartPageToken: string | null = null;
    const driveFolderId = this.syncState.driveFolderId || '';


    do {
      const response = await this.driveAdapter.listChanges(pageToken!).catch(async (error: unknown) => {
        const typed = error as { code?: number; status?: number; response?: { status?: number } };
        if (typed.code === 410 || typed.status === 410 || typed.response?.status === 410) {
          // An expired cursor cannot be retried indefinitely. Preserve the
          // checkpoint and require a complete inventory on the next attempt.
          this.syncState.forceFullReconciliation = true;
          await this.saveSyncState();
        }
        throw error;
      });
      newStartPageToken = response.newStartPageToken;

      // Build the queued-IDs set once per page so that multiple folder-change
      // entries in the same page don't each trigger an independent full scan of
      // tracked files. This reduces total API calls from
      // O(tracked_files × folder_changes_per_page) to O(tracked_files) per page.
      const pageQueuedIds = new Set(response.changes.map(c => c.fileId));

      for (const change of response.changes) {
        await this.checkpointSync();
        processedChanges++;
        this.reportSyncProgress({
          phase: 'processing_changes',
          completed: processedChanges,
          total: 0,
          currentPath: change.file?.relativePath || change.file?.name || change.fileId,
        }, onProgress);
        // Drive Changes may report a trashed resource as an ordinary file
        // change (removed=false). Trashed resources are remote absence, never
        // live path candidates, otherwise a recently cleaned duplicate can
        // falsely collide with the retained canonical remote ID.
        if (change.removed || change.file?.trashed === true) {
          const syncFile = this.findSyncFileByRemoteId(change.fileId);
          if (syncFile) {
            const localHash = localInventory.get(syncFile.path)?.hash || null;
            if (SyncEngine.immutableReadingHash(syncFile.path)) {
              result.conflicts++;
              await this.handleConflict(syncFile.path, { hash: localHash || '', exists: localHash !== null }, undefined, syncFile);
              continue;
            }
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
          // When a folder is renamed/moved, Drive does NOT emit individual change
          // entries for its children — we must re-fetch their metadata to detect
          // path changes. pageQueuedIds (built once per page above) ensures each
          // tracked child is fetched at most once across all folder changes in
          // this page, reducing O(tracked × folder_changes) → O(tracked) per page.
          for (const tracked of this.syncState.files.values()) {
            await this.checkpointSync();
            if (!tracked.remoteFileId || pageQueuedIds.has(tracked.remoteFileId)) continue;
            try {
              const metadata = await this.driveAdapter.getFileMetadata(tracked.remoteFileId);
              response.changes.push({ fileId: tracked.remoteFileId, removed: false, file: metadata });
              pageQueuedIds.add(tracked.remoteFileId);
            } catch {
              // A missing tracked child will be handled by its own removed change;
              // do not infer deletion from a metadata read failure.
            }
          }
          continue;
        }

        const hasAncestry = await this.proveAncestryToRoot(change.file, driveFolderId);
        if (!hasAncestry) {
          const trackedFile = this.findSyncFileByRemoteId(change.file.id);
          if (trackedFile) {
            if (SyncEngine.immutableReadingHash(trackedFile.path)) {
              result.conflicts++;
              const localHash = localInventory.get(trackedFile.path)?.hash || null;
              await this.handleConflict(trackedFile.path, { hash: localHash || '', exists: localHash !== null }, undefined, trackedFile);
              continue;
            }
            this.syncState.files.delete(trackedFile.path);
            const localHash = localInventory.get(trackedFile.path)?.hash || null;
            if (localHash && localHash === trackedFile.baseHash) {
              await this.deleteLocalFile(trackedFile.path, localHash);
              result.synced++;
            } else if (localHash) {
              result.conflicts++;
              trackedFile.remoteFileId = null;
              await this.handleConflict(trackedFile.path, { hash: localHash, exists: true }, undefined, trackedFile);
            }
          }
          continue;
        }

        const remotePath = await this.resolveRemotePath(change.file, driveFolderId);
        if (!remotePath) continue;
        const normalizedRemote = normalizeVaultPath(remotePath);
        let verifiedConflictHash: string | undefined;
        if (this.conflicts.has(normalizedRemote)) {
          // Replayed events for an unresolved divergence are not additional
          // conflicts. Only re-enter normal reconciliation when fresh bytes
          // prove convergence; full rescan owns refreshing divergent snapshots.
          verifiedConflictHash = await this.driveAdapter.resolveRemoteHash(change.file);
          if (localInventory.get(normalizedRemote)?.hash !== verifiedConflictHash) continue;
        }
        if (!VaultSyncFilePolicy.shouldSyncRemoteFile(normalizedRemote, change.file.mimeType)) {
          const trackedFile = this.findSyncFileByRemoteId(change.file.id);
          if (trackedFile) {
            if (SyncEngine.immutableReadingHash(trackedFile.path)) {
              result.conflicts++;
              const localHash = localInventory.get(trackedFile.path)?.hash || null;
              await this.handleConflict(trackedFile.path, { hash: localHash || '', exists: localHash !== null }, undefined, trackedFile);
              continue;
            }
            this.syncState.files.delete(trackedFile.path);
            const localHash = localInventory.get(trackedFile.path)?.hash || null;
            if (localHash && localHash === trackedFile.baseHash) {
              await this.deleteLocalFile(trackedFile.path, localHash);
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

        const pathOwner = this.syncState.files.get(normalizedRemote);
        if (pathOwner?.remoteFileId && pathOwner.remoteFileId !== change.file.id) {
          const trackedRemoteId = pathOwner.remoteFileId;
          const trackedOwnerStillLive = await this.isTrackedRemoteIdentityLiveAtPath(
            trackedRemoteId,
            normalizedRemote,
            driveFolderId
          );
          if (trackedOwnerStillLive) {
            this.quarantinedPaths.add(normalizedRemote);
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
            this.captureReadingLocalPath(oldKey)();
            this.captureReadingLocalPath(normalizedRemote)();
            if (SyncEngine.immutableReadingHash(oldKey) || SyncEngine.immutableReadingHash(normalizedRemote)) {
              result.conflicts++;
              const current = localInventory.get(oldKey);
              await this.handleConflict(oldKey, current || { hash: '', exists: false }, undefined, existingSyncFile);
              continue;
            }
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

        const remoteHash = verifiedConflictHash ?? await this.resolveRemoteHashCached(change.file);
        change.file.quartzoHash = remoteHash;
        syncFile.remoteFileId = change.file.id;

        if (!localFile) {
          const pendingRename = this.pendingRenames.find(rename => rename.oldPath === normalizedRemote);
          if (pendingRename) {
            // A local canonical retirement/rename already owns this disappearance.
            // Never pull the old remote path back. If Drive changed, surface the
            // three-way conflict and keep the rename pending for explicit review.
            if (syncFile.baseHash !== null && remoteHash === syncFile.baseHash) {
              syncFile.remoteHash = remoteHash;
              syncFile.remoteExists = true;
              syncFile.remoteModifiedAt = change.file.modifiedTime || null;
              this.syncState.files.set(normalizedRemote, syncFile);
            } else {
              result.conflicts++;
              await this.handleConflict(
                normalizedRemote,
                { hash: syncFile.localHash, exists: false },
                change.file,
                syncFile,
              );
            }
          } else if (SyncEngine.immutableReadingHash(normalizedRemote) && this.pendingDeletes.has(normalizedRemote)) {
            result.conflicts++;
            await this.handleConflict(normalizedRemote, { hash: '', exists: false }, change.file, syncFile);
          } else if (SyncEngine.immutableReadingHash(normalizedRemote)) {
            await this.pullFile(normalizedRemote, change.file, syncFile);
            result.synced++;
          } else if (this.pendingDeletes.has(normalizedRemote) || syncFile.baseHash !== null) {
            // Changes API can replay the original upload/metadata event. It is
            // not evidence of a concurrent edit: compare bytes with baseline.
            if (syncFile.baseHash !== null && remoteHash === syncFile.baseHash) {
              this.pendingDeletes.add(normalizedRemote);
              syncFile.remoteHash = remoteHash;
              syncFile.remoteExists = true;
              this.syncState.files.set(normalizedRemote, syncFile);
            } else {
              result.conflicts++;
              await this.handleConflict(normalizedRemote, { hash: syncFile.localHash, exists: false }, change.file, syncFile);
            }
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
            await this.clearConvergedConflict(normalizedRemote);
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
    result: SyncResult,
    onProgress?: (progress: SyncProgress) => void
  ): Promise<void> {
    // A local edit may itself resolve an existing divergence. There need not
    // be a new Drive change event for these now-equal bytes.
    for (const artifact of [...this.conflicts.values()]) {
      const local = localInventory.get(artifact.originalPath);
      if (!local || !artifact.remoteExists || !artifact.remoteFileId || local.hash !== artifact.remoteSha256) continue;
      const metadata = await this.driveAdapter.getFileMetadata(artifact.remoteFileId);
      if (metadata.trashed || !VaultSyncFilePolicy.shouldSyncRemoteFile(artifact.originalPath, metadata.mimeType) ||
          !await this.proveAncestryToRoot(metadata, this.syncState.driveFolderId || '') ||
          await this.resolveRemotePath(metadata, this.syncState.driveFolderId || '') !== artifact.originalPath) continue;
      const bytes = await this.driveAdapter.downloadFile(metadata.id);
      if (this.calculateHash(bytes) !== local.hash) continue;
      const absolutePath = pathModule.join(this.vaultPath, artifact.originalPath);
      if (!fs.existsSync(absolutePath) || this.calculateHash(fs.readFileSync(absolutePath)) !== local.hash) continue;
      const state = this.syncState.files.get(artifact.originalPath) || this.createSyncFile(artifact.originalPath, local);
      state.localHash = state.remoteHash = state.baseHash = local.hash;
      state.remoteFileId = metadata.id;
      state.localExists = state.remoteExists = true;
      state.localModifiedAt = fs.statSync(absolutePath).mtime.toISOString();
      state.remoteModifiedAt = metadata.modifiedTime || null;
      this.syncState.files.set(artifact.originalPath, state);
      await this.clearConvergedConflict(artifact.originalPath);
    }
    const processedPaths = new Set<string>();
    let localProgressCompleted = 0;
    // Compute a best-effort total so the UI can display real percentage progress
    // rather than an always-indeterminate spinner. We count every distinct work
    // item we will visit: pending renames, pending deletes, tracked sync files,
    // and untracked local files. Items may overlap, so this is an upper bound,
    // but it is never zero when there is actual work to do.
    const localProgressTotal =
      this.pendingRenames.length +
      this.pendingDeletes.size +
      this.syncState.files.size +
      localInventory.size;
    const reportLocalProgress = (currentPath?: string) => {
      localProgressCompleted++;
      this.reportSyncProgress({
        phase: 'processing_local_changes',
        completed: localProgressCompleted,
        total: localProgressTotal,
        ...(currentPath ? { currentPath } : {}),
      }, onProgress);
    };
    const driveFolderId = this.syncState.driveFolderId || '';

    const remainingRenames: PendingRename[] = [];
    let renameRemoteInventory: DriveFileMetadata[] | null = null;
    for (const rename of this.pendingRenames) {
      await this.checkpointSync();
      reportLocalProgress(rename.newPath);
      if (SyncEngine.immutableReadingHash(rename.oldPath) || SyncEngine.immutableReadingHash(rename.newPath)) {
        const protectedPath = SyncEngine.immutableReadingHash(rename.oldPath) ? rename.oldPath : rename.newPath;
        const local = localInventory.get(protectedPath) || {hash: '', exists: false};
        const tracked = this.syncState.files.get(protectedPath) || this.createSyncFile(protectedPath, local);
        let remote: DriveFileMetadata | undefined;
        if (tracked.remoteFileId) {
          try { remote = await this.driveAdapter.getFileMetadata(tracked.remoteFileId); }
          catch (error) { if (!this.isDriveNotFoundError(error)) throw error; }
          if (remote && (remote.trashed || await this.resolveRemotePath(remote, driveFolderId) !== protectedPath)) remote = undefined;
        }
        result.conflicts++;
        await this.handleConflict(protectedPath, local, remote, tracked);
        result.errors.push('Relocation is unavailable for immutable reading history.');
        remainingRenames.push(rename);
        processedPaths.add(rename.oldPath);
        processedPaths.add(rename.newPath);
        continue;
      }
      const oldSyncFile = this.syncState.files.get(rename.oldPath);
      if (!oldSyncFile || !oldSyncFile.remoteFileId) {
        continue; // Discard invalid intents
      }

      if (this.conflicts.has(rename.oldPath) || this.conflicts.has(rename.newPath)) {
        remainingRenames.push(rename);
        processedPaths.add(rename.oldPath);
        processedPaths.add(rename.newPath);
        continue;
      }

      const newLocalFile = localInventory.get(rename.newPath);
      if (newLocalFile) {
        try {
          const currentRemote = await this.driveAdapter.getFileMetadata(oldSyncFile.remoteFileId);
          const currentRemotePath = await this.resolveRemotePath(currentRemote, driveFolderId);
          const belongsToVault = await this.proveAncestryToRoot(currentRemote, driveFolderId);
          if (!belongsToVault || !currentRemotePath || normalizeVaultPath(currentRemotePath) !== rename.oldPath) {
            throw new Error('Tracked remote identity moved before the queued rename could be applied.');
          }
          if (oldSyncFile.baseHash === null) {
            throw new Error('Tracked remote identity has no safe three-way baseline for rename.');
          }

          const currentRemoteHash = await this.driveAdapter.resolveRemoteHash(currentRemote);
          if (currentRemoteHash !== oldSyncFile.baseHash) {
            result.conflicts++;
            await this.handleConflict(
              rename.oldPath,
              { hash: oldSyncFile.localHash, exists: false },
              currentRemote,
              oldSyncFile,
            );
            remainingRenames.push(rename);
            processedPaths.add(rename.oldPath);
            processedPaths.add(rename.newPath);
            continue;
          }
          oldSyncFile.remoteHash = currentRemoteHash;
          oldSyncFile.remoteModifiedAt = currentRemote.modifiedTime || null;

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
          this.pendingRenames = this.pendingRenames.filter(pending => pending !== rename);
          await this.saveSyncState();
          
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
      await this.checkpointSync();
      reportLocalProgress(deletedPath);
      if (this.conflicts.has(deletedPath)) {
        processedPaths.add(deletedPath);
        continue;
      }
      const syncFile = this.syncState.files.get(deletedPath);
      if (syncFile && SyncEngine.immutableReadingHash(deletedPath)) {
        let remote: DriveFileMetadata | undefined;
        if (syncFile.remoteFileId) {
          try { remote = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId); }
          catch (error) { if (!this.isDriveNotFoundError(error)) throw error; }
          if (remote?.trashed) remote = undefined;
        }
        result.conflicts++;
        await this.handleConflict(deletedPath, { hash: localInventory.get(deletedPath)?.hash || '', exists: localInventory.has(deletedPath) }, remote, syncFile);
        processedPaths.add(deletedPath);
        continue;
      }
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
    for (const deletedPath of this.pendingDeletes) {
      if (!SyncEngine.immutableReadingHash(deletedPath)) {
        this.pendingDeletes.delete(deletedPath);
        this.pendingDeleteTickets.delete(deletedPath);
      }
    }

    for (const [syncedPath, syncFile] of this.syncState.files) {
      await this.checkpointSync();
      reportLocalProgress(syncedPath);
      if (processedPaths.has(syncedPath) || this.conflicts.has(syncedPath)) {
        processedPaths.add(syncedPath);
        continue;
      }
      if (!syncFile.remoteFileId) continue;

      const localFile = localInventory.get(syncedPath);
      if (!localFile) {
        if (SyncEngine.immutableReadingHash(syncedPath)) {
          let remote: DriveFileMetadata | undefined;
          try { remote = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId); }
          catch (error) { if (!this.isDriveNotFoundError(error)) throw error; }
          if (remote && !remote.trashed && await this.resolveRemotePath(remote, driveFolderId) === syncedPath) {
            await this.pullFile(syncedPath, remote, syncFile);
            result.synced++;
          } else {
            result.conflicts++;
            await this.handleConflict(syncedPath, { hash: '', exists: false }, undefined, syncFile);
          }
          processedPaths.add(syncedPath);
          continue;
        }
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
      await this.checkpointSync();
      const normalizedLocal = normalizeVaultPath(localPath);
      reportLocalProgress(normalizedLocal);
      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedLocal)) continue;
      if (processedPaths.has(normalizedLocal) || this.conflicts.has(normalizedLocal)) {
        processedPaths.add(normalizedLocal);
        continue;
      }

      const syncFile = this.syncState.files.get(normalizedLocal);

      if (!syncFile) {
        const newSyncFile = this.createSyncFile(normalizedLocal, localFile);
        newSyncFile.localHash = localFile.hash;
        this.syncState.files.set(normalizedLocal, newSyncFile);
        if (!this.pendingCreates.has(normalizedLocal)) {
          this.recordAdoptionPending(normalizedLocal, newSyncFile);
          processedPaths.add(normalizedLocal);
          continue;
        }
        await this.pushFile(normalizedLocal, localFile, newSyncFile);
        result.synced++;
        processedPaths.add(normalizedLocal);
        continue;
      }

      if (!syncFile.remoteFileId) {
        if (this.pendingCreates.has(normalizedLocal)) {
          await this.pushFile(normalizedLocal, localFile, syncFile);
          result.synced++;
          processedPaths.add(normalizedLocal);
          continue;
        }
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
      } catch (error) {
        if (!this.isDriveNotFoundError(error)) throw error;
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
      let nextParentId = '';

      if (this.parentNameCache.has(currentParentId)) {
        parentName = this.parentNameCache.get(currentParentId);
        // Cache only stores the name; we still need parents for the next hop.
        try {
          const parentMeta = await this.driveAdapter.getFileMetadata(currentParentId);
          nextParentId = parentMeta.parents && parentMeta.parents.length > 0 ? parentMeta.parents[0] : '';
        } catch (error) {
          if (!this.isDriveNotFoundError(error)) throw error;
          return null;
        }
      } else {
        // Single getFileMetadata call per level — fetches both name and parents.
        try {
          const metadata = await this.driveAdapter.getFileMetadata(currentParentId);
          parentName = metadata.name || undefined;
          if (parentName) {
            this.parentNameCache.set(currentParentId, parentName);
          }
          nextParentId = metadata.parents && metadata.parents.length > 0 ? metadata.parents[0] : '';
        } catch (error) {
          if (!this.isDriveNotFoundError(error)) throw error;
          return null;
        }
      }

      if (!parentName) break;
      segments.unshift(parentName);
      currentParentId = nextParentId;
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

  private captureReadingLocalPath(filePath: string): () => void {
    const vault = this.vaultPath, account = this.storageAccountId, folder = this.syncState.driveFolderId;
    const canonical = fs.realpathSync(vault);
    const root = fs.statSync(vault, {bigint: true});
    const identities = new Map<string, string>();
    const check = () => {
      const currentRoot = fs.statSync(vault, {bigint: true});
      if (vault !== this.vaultPath || account !== this.storageAccountId || folder !== this.syncState.driveFolderId ||
          fs.realpathSync(vault) !== canonical || root.dev !== currentRoot.dev || root.ino !== currentRoot.ino) {
        throw new Error('Reading local target changed');
      }
      const absolute = pathModule.resolve(vault, filePath);
      const lexical = pathModule.relative(pathModule.resolve(vault), absolute);
      if (lexical === '..' || lexical.startsWith('..' + pathModule.sep) || pathModule.isAbsolute(lexical)) {
        throw new Error('Local sync path escapes the vault');
      }
      let probe = absolute;
      const suffix: string[] = [];
      for (;;) {
        try {
          const stat = fs.lstatSync(probe, {bigint: true});
          if (probe === absolute && stat.isFile() && stat.nlink.toString() !== '1') {
            throw new Error('Local sync cannot mutate a shared hard-link identity');
          }
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          suffix.unshift(pathModule.basename(probe));
          const parent = pathModule.dirname(probe);
          if (parent === probe) throw new Error('Local sync path has no existing root');
          probe = parent;
        }
      }
      const resolved = pathModule.resolve(fs.realpathSync(probe), ...suffix);
      const actual = pathModule.relative(canonical, resolved).split(pathModule.sep).join('/');
      if (actual === '..' || actual.startsWith('../') || pathModule.isAbsolute(actual)) {
        throw new Error('Local sync alias escapes the vault');
      }
      const physical = process.platform === 'win32' ? actual.toLowerCase() : actual;
      if ((SyncEngine.immutableReadingHash(physical) && actual !== filePath) ||
          (SyncEngine.immutableReadingHash(filePath) && actual !== filePath) ||
          (process.platform === 'win32' && SyncEngine.immutableReadingHash(filePath.toLowerCase()) && filePath !== filePath.toLowerCase())) {
        throw new Error('Reading local mutation through an alias is unavailable');
      }
      if (!SyncEngine.immutableReadingHash(filePath)) return;
      let current = vault;
      const parts = filePath.split('/');
      for (let index = 0; index < parts.length; index++) {
        current = pathModule.join(current, parts[index]);
        let stat: fs.BigIntStats;
        try { stat = fs.lstatSync(current, {bigint: true}); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
        if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() || stat.nlink.toString() !== '1' : !stat.isDirectory())) {
          throw new Error('Reading local path is not an independent regular subtree');
        }
        const identity = stat.dev.toString() + ':' + stat.ino.toString();
        const previous = identities.get(current);
        if (previous && previous !== identity) throw new Error('Reading local path identity changed');
        identities.set(current, identity);
      }
    };
    check();
    return check;
  }

  private async pushFile(filePath: string, localFile: { hash: string; exists: boolean }, syncFile: SyncFile): Promise<void> {
    const checkLocal = this.captureReadingLocalPath(filePath);
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const immutableHash = SyncEngine.immutableReadingHash(filePath);
    if (immutableHash && fs.statSync(localFilePath).size > SyncEngine.readingShardMaxBytes) {
      throw new Error('Reading bytes exceed the supported shard bound');
    }
    const content = new Uint8Array(fs.readFileSync(localFilePath));
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    if (immutableHash && (content.byteLength > SyncEngine.readingShardMaxBytes || immutableHash !== quartzoHash)) throw new Error('Immutable reading filename does not match bounded upload bytes');
    const folderId = this.syncState.driveFolderId || '';

    let metadata: DriveFileMetadata;

    if (syncFile.remoteFileId) {
      const remote = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId);
      checkLocal();
      const remotePath = await this.resolveRemotePath(remote, folderId);
      checkLocal();
      if (remote.trashed || remotePath !== filePath) {
        throw new Error('Remote identity changed before upload: ' + filePath);
      }
      const remoteBytes = await this.driveAdapter.downloadFile(syncFile.remoteFileId, immutableHash ? filePath : undefined);
      checkLocal();
      const remoteHash = this.calculateHash(remoteBytes);
      if (remoteHash !== quartzoHash &&
          (immutableHash !== null || syncFile.baseHash === null || remoteHash !== syncFile.baseHash)) {
        await this.handleConflict(filePath, localFile, remote, syncFile);
        throw new Error('Remote content changed before upload: ' + filePath);
      }
      metadata = remoteHash === quartzoHash
        ? remote
        : await this.driveAdapter.updateFile(syncFile.remoteFileId, content, quartzoHash);
    } else {
      metadata = await this.driveAdapter.uploadFile({ folderId, name: filePath, content, quartzoHash });
    }

    checkLocal();
    syncFile.remoteHash = quartzoHash;
    syncFile.remoteFileId = metadata.id;
    syncFile.baseHash = quartzoHash;
    syncFile.localHash = quartzoHash;
    syncFile.localExists = fs.existsSync(localFilePath);
    syncFile.remoteExists = true;
    const currentBytesMatch = syncFile.localExists && this.calculateHash(fs.readFileSync(localFilePath)) === quartzoHash;
    syncFile.localModifiedAt = currentBytesMatch ? fs.statSync(localFilePath).mtime.toISOString() : null;
    syncFile.remoteModifiedAt = metadata.modifiedTime || null;

    this.pendingCreates.delete(filePath);
    this.syncState.files.set(filePath, syncFile);
    await this.saveSyncState();
  }

  private async pullFile(filePath: string, remoteFile: DriveFileMetadata, syncFile: SyncFile): Promise<void> {
    const checkLocal = this.captureReadingLocalPath(filePath);
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const beforeHash = fs.existsSync(localFilePath)
      ? this.calculateHash(fs.readFileSync(localFilePath)) : null;
    const immutableHash = SyncEngine.immutableReadingHash(filePath);
    const content = new Uint8Array(await this.driveAdapter.downloadFile(remoteFile.id, immutableHash ? filePath : undefined));
    if (immutableHash && this.calculateHash(content) !== immutableHash) {
      throw new Error('Immutable reading filename does not match downloaded bytes');
    }
    if (immutableHash && content.byteLength > SyncEngine.readingShardMaxBytes) {
      throw new Error('Reading bytes exceed the supported shard bound');
    }
    checkLocal();
    const currentHash = fs.existsSync(localFilePath)
      ? this.calculateHash(fs.readFileSync(localFilePath)) : null;
    if (currentHash !== beforeHash ||
        (beforeHash !== null && syncFile.baseHash !== null &&
         beforeHash !== syncFile.baseHash && beforeHash !== this.calculateHash(content))) {
      throw new Error('Local content changed before pull: ' + filePath);
    }

    const localDir = pathModule.dirname(localFilePath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    checkLocal();
    if (immutableHash && currentHash !== null && currentHash !== immutableHash) {
      throw new Error('Immutable reading bytes diverged before publication');
    }
    this.registerExpectedWatcherWrite(filePath, content);
    const tempPath = localFilePath + '.' + crypto.randomUUID() + '.tmp';
    let allocated = false;
    let ownedTemp: string | null = null;
    try {
      const descriptor = fs.openSync(tempPath, 'wx');
      allocated = true;
      try {
        const stat = fs.fstatSync(descriptor, {bigint: true});
        ownedTemp = stat.dev.toString() + ':' + stat.ino.toString();
        fs.writeFileSync(descriptor, Buffer.from(content));
        if (immutableHash) fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      if (immutableHash) {
        // Atomic no-replace hard-link publication; unsupported filesystems reject.
        try { fs.linkSync(tempPath, localFilePath); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' ||
              this.calculateHash(fs.readFileSync(localFilePath)) !== immutableHash) throw error;
        }
      } else fs.renameSync(tempPath, localFilePath);
    } finally {
      if (allocated) {
        let stat: fs.BigIntStats | undefined;
        try { stat = fs.lstatSync(tempPath, {bigint: true}); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (stat) {
          if (stat.isSymbolicLink() || stat.dev.toString() + ':' + stat.ino.toString() !== ownedTemp) {
            throw new Error('Sync temporary identity changed; preserve it for review');
          }
          fs.unlinkSync(tempPath);
        }
      }
    }

    checkLocal();
    if (immutableHash && this.calculateHash(fs.readFileSync(localFilePath)) !== immutableHash) {
      throw new Error('Reading publication readback changed');
    }
    const localHash = crypto.createHash('sha256').update(content).digest('hex');
    const remoteSha256 = localHash;

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
    await this.saveSyncState();
  }

  private async deleteLocalFile(filePath: string, expectedHash = this.syncState.files.get(filePath)?.baseHash): Promise<void> {
    if (SyncEngine.immutableReadingHash(filePath)) throw new Error('Deletion is unavailable for immutable reading history.');
    const checkLocal = this.captureReadingLocalPath(filePath);
    checkLocal();
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    if (fs.existsSync(localFilePath)) {
      const current = fs.readFileSync(localFilePath);
      if (!expectedHash || this.calculateHash(current) !== expectedHash) {
        throw new Error('Local content changed before deletion: ' + filePath);
      }
      this.registerExpectedWatcherWrite(filePath, null);
      fs.unlinkSync(localFilePath);
    }
    this.syncState.files.delete(filePath);
    await this.saveSyncState();
  }

  private async deleteRemoteFile(filePath: string, syncFile: SyncFile): Promise<void> {
    if (SyncEngine.immutableReadingHash(filePath)) throw new Error('Deletion is unavailable for immutable reading history.');
    if (syncFile.remoteFileId) {
      const deletedPath = `_deleted/${filePath}`;
      const content = await this.driveAdapter.downloadFile(syncFile.remoteFileId);
      const folderId = this.syncState.driveFolderId || '';
      const remote = await this.driveAdapter.getFileMetadata(syncFile.remoteFileId);
      const remotePath = await this.resolveRemotePath(remote, folderId);
      if (remote.trashed || (remotePath !== filePath && remotePath !== deletedPath)) {
        throw new Error('Remote identity changed before deletion: ' + filePath);
      }
      if (!syncFile.baseHash || this.calculateHash(content) !== syncFile.baseHash) {
        await this.handleConflict(filePath, { hash: '', exists: false }, remote, syncFile);
        throw new Error('Remote content changed before deletion: ' + filePath);
      }
      if (fs.existsSync(pathModule.join(this.vaultPath, filePath))) {
        throw new Error('Local file reappeared before deletion: ' + filePath);
      }
      if (remotePath !== deletedPath) {
        const parent = await this.driveAdapter.ensureParentFolder(folderId, deletedPath);
        await this.driveAdapter.renameFile(syncFile.remoteFileId, deletedPath.split('/').pop()!, parent);
      }
    }
    this.syncState.files.delete(filePath);
    this.pendingDeletes.delete(filePath);
    await this.saveSyncState();
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
      remoteContent = await this.driveAdapter.downloadFile(remoteFile.id, SyncEngine.immutableReadingHash(filePath) ? filePath : undefined);
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
    const remoteSha256 = crypto.createHash('sha256').update(remoteContent).digest('hex');
    const previous = this.conflicts.get(filePath);
    if (previous?.localSha256 === localSha256 && previous.remoteSha256 === remoteSha256 &&
        previous.localExists === localFile.exists && previous.remoteExists === (remoteFile != null) &&
        previous.remoteFileId === (remoteFile?.id || syncFile.remoteFileId || null)) {
      return; // The same unresolved versions do not constitute a new conflict.
    }

    const conflictBase = `${this.conflictRoot()}/${filePath}`;

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

  getRemoteIdentityAmbiguityPaths(): string[] {
    return [...this.quarantinedPaths].sort((a, b) => a.localeCompare(b));
  }

  async getSyncStatusSnapshot(): Promise<SyncStatusSnapshot> {
    const pendingDiagnostics = await this.buildPendingDiagnostics();
    const conflictCount = this.conflicts.size;
    const status: SyncCenterStatus = this.syncMutex || this.pairingApplyInProgress
      ? 'syncing'
      : conflictCount > 0
        ? 'conflict'
        : this.lastError
          ? 'error'
          : pendingDiagnostics.length > 0
            ? 'local_changes'
            : 'synced';
    return {
      status,
      lastSuccessfulSyncAt: this.syncState.lastSyncTime > 0 ? new Date(this.syncState.lastSyncTime).toISOString() : null,
      pendingLocalChanges: pendingDiagnostics.length,
      pendingDiagnostics,
      conflictCount,
      lastError: this.lastError,
    };
  }

  private async buildPendingDiagnostics(): Promise<SyncPendingDiagnostic[]> {
    const diagnostics = new Map<string, SyncPendingDiagnostic>();
    const queuedIntentPaths = new Set<string>();
    const addDiagnostic = (diagnostic: SyncPendingDiagnostic) => {
      const normalized = normalizeVaultPath(diagnostic.path);
      const relatedPath = diagnostic.relatedPath ? normalizeVaultPath(diagnostic.relatedPath) : undefined;
      const key = `${diagnostic.reason}\0${normalized}\0${relatedPath ?? ''}`;
      diagnostics.set(key, {
        path: normalized,
        reason: diagnostic.reason,
        ...(relatedPath ? { relatedPath } : {}),
      });
    };

    for (const rename of this.pendingRenames) {
      queuedIntentPaths.add(normalizeVaultPath(rename.oldPath));
      queuedIntentPaths.add(normalizeVaultPath(rename.newPath));
      addDiagnostic({ path: rename.oldPath, reason: 'pending_rename', relatedPath: rename.newPath });
      addDiagnostic({ path: rename.newPath, reason: 'pending_rename', relatedPath: rename.oldPath });
    }
    for (const deleted of this.pendingDeletes) {
      queuedIntentPaths.add(normalizeVaultPath(deleted));
      addDiagnostic({ path: deleted, reason: 'pending_delete' });
    }
    for (const conflict of this.conflicts.values()) {
      addDiagnostic({ path: conflict.originalPath, reason: 'conflict' });
    }
    for (const quarantinedPath of this.quarantinedPaths) {
      addDiagnostic({ path: quarantinedPath, reason: 'quarantined_duplicate_identity' });
    }

    const localInventory = await this.buildLocalInventory();
    for (const [filePath, localFile] of localInventory) {
      const normalizedLocal = normalizeVaultPath(filePath);
      if (queuedIntentPaths.has(normalizedLocal)) continue;
      const syncFile = this.syncState.files.get(filePath);
      if (!syncFile) {
        addDiagnostic({ path: filePath, reason: 'local_create' });
      } else if (!syncFile.remoteFileId) {
        addDiagnostic({ path: filePath, reason: 'adoption_required' });
      } else if (syncFile.localHash !== localFile.hash) {
        addDiagnostic({ path: filePath, reason: 'local_modify' });
      }
    }
    for (const [filePath, syncFile] of this.syncState.files) {
      const normalizedSyncPath = normalizeVaultPath(filePath);
      if (queuedIntentPaths.has(normalizedSyncPath)) continue;
      if (syncFile.localExists && !localInventory.has(filePath)) {
        addDiagnostic({ path: filePath, reason: 'pending_delete' });
      }
    }
    return Array.from(diagnostics.values())
      .sort((a, b) => a.path === b.path
        ? a.reason.localeCompare(b.reason)
        : a.path.localeCompare(b.path));
  }

  async setDriveFolderId(folderId: string): Promise<void> {
    if (this.syncMutex || this.pairingApplyInProgress) throw new Error('Wait for active sync before changing the vault');
    const scope = this.storageAccountId
      ? crypto.createHash('sha256').update(JSON.stringify([this.storageAccountId, folderId, pathModule.resolve(this.vaultPath)])).digest('hex') : '';
    if (scope !== this.targetScope || this.syncState.driveFolderId !== folderId) {
      this.remoteHashCache.clear(); this.ancestryCache.clear(); this.parentNameCache.clear();
      this.expectedWatcherWrites.clear(); this.localHashCache.clear();
      this.targetScope = scope;
      this.stateStorePath = scope && this.originalStateStorePath ? `${this.originalStateStorePath}.${scope}.json` : this.originalStateStorePath;
      // Claim legacy state once, only when it names this exact remote folder.
      if (scope && this.originalStateStorePath && !fs.existsSync(this.stateStorePath) && fs.existsSync(this.originalStateStorePath)) {
        const bindingPath = `${this.originalStateStorePath}.target-binding`;
        const legacy = JSON.parse(fs.readFileSync(this.originalStateStorePath, 'utf-8'));
        const binding = fs.existsSync(bindingPath) ? fs.readFileSync(bindingPath, 'utf-8') : null;
        if (legacy.driveFolderId === folderId && (!binding || binding === scope)) {
          fs.writeFileSync(bindingPath, scope);
          fs.copyFileSync(this.originalStateStorePath, this.stateStorePath);
          const oldConflicts = pathModule.join(this.vaultPath, '_conflicts');
          const newConflicts = pathModule.join(this.vaultPath, this.conflictRoot());
          if (fs.existsSync(oldConflicts) && !fs.existsSync(newConflicts)) {
            fs.mkdirSync(newConflicts, { recursive: true });
            for (const entry of fs.readdirSync(oldConflicts, { withFileTypes: true })) {
              if (/^[a-f0-9]{64}$/.test(entry.name)) continue;
              fs.cpSync(pathModule.join(oldConflicts, entry.name), pathModule.join(newConflicts, entry.name), { recursive: true });
            }
          }
        }
      }
      await this.loadSyncState();
      if (this.syncState.driveFolderId && this.syncState.driveFolderId !== folderId) {
        this.syncState.files.clear(); this.pendingCreates.clear(); this.pendingDeletes.clear(); this.pendingRenames = [];
        this.syncState.driveChangeToken = null; this.syncState.lastSyncTime = 0;
      }
      this.conflicts.clear();
      this.rehydrateConflicts();
    }
    await this.driveAdapter.setFolderId(folderId);
    this.syncState.driveFolderId = folderId;
    await this.saveSyncState();
  }

  private async resolveRemoteHashCached(metadata: DriveFileMetadata): Promise<string> {
    const modifiedTime = metadata.modifiedTime || null;
    const cached = this.remoteHashCache.get(metadata.id);
    if (cached && (metadata.md5Checksum ? cached.md5Checksum === metadata.md5Checksum :
      modifiedTime !== null && cached.modifiedTime === modifiedTime &&
      (!metadata.quartzoHash || metadata.quartzoHash === cached.hash))) {
      return cached.hash;
    }

    const hash = await this.driveAdapter.resolveRemoteHash(metadata);
    this.remoteHashCache.set(metadata.id, { modifiedTime, hash, md5Checksum: metadata.md5Checksum || null });
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
    const ambiguityWorkerCount = Math.min(REMOTE_HASH_CONCURRENCY, ambiguousJobs.length);
    const ambiguityWorkers = Array.from({ length: ambiguityWorkerCount }, async () => {
      while (true) {
        const index = ambiguityIndex++;
        if (index >= ambiguousJobs.length) return;
        const { group, candidate } = ambiguousJobs[index];
        const resolvedSha256 = await this.resolveRemoteHashCached(candidate);
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
    const workerCount = Math.min(REMOTE_HASH_CONCURRENCY, sharedPaths.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= sharedPaths.length) return;
        const filePath = sharedPaths[index];
        const localEntry = localInventory.get(filePath);
        const remoteEntry = remoteMap.get(filePath);
        if (!localEntry || !remoteEntry) continue;

        const remoteHash = await this.resolveRemoteHashCached(remoteEntry);
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
    decisions: {
      autoAdopt: boolean;
      autoPull: boolean;
      /** Per-path resolution for divergent files. 'keep_local' uploads the local file to Drive;
       *  'keep_drive' downloads the Drive file and replaces the local copy. */
      divergentResolutions?: Map<string, 'keep_local' | 'keep_drive'>;
    },
    onProgress?: (progress: PairingApplyProgress) => void
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };
    if (this.pairingApplyInProgress) {
      result.errors.push('Pairing already in progress. Wait for the current pairing operation to finish.');
      return result;
    }

    this.pairingApplyInProgress = true;
    this.operationControl = { paused: false, cancelRequested: false, resumeWaiters: [] };
    this.pairingApplyProgress = null;
    this.pairingLastError = null;
    try {
      await this.driveAdapter.verifyConditionalMutationSupport?.();
      const driveFolderId = this.syncState.driveFolderId || '';

      const unresolvedDivergent = summary.divergent.filter(
        item => !(decisions.divergentResolutions?.has(item.path))
      );
      if (summary.ambiguous.length > 0 || unresolvedDivergent.length > 0) {
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
        await this.checkpointSync();
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
        : await this.resolveRemoteHashCached(remoteEntry);
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
    // --- Divergent resolutions ---
    // Process explicitly-resolved divergent files before the adopt/pull passes so
    // that the chosen version becomes the baseline for subsequent incremental syncs.
    if (decisions.divergentResolutions && decisions.divergentResolutions.size > 0) {
      let divergentCompleted = 0;
      this.reportPairingApplyProgress(
        { phase: 'adopting_local', completed: 0, total: decisions.divergentResolutions.size },
        onProgress
      );
      for (const item of summary.divergent) {
        await this.checkpointSync();
        const resolution = decisions.divergentResolutions.get(item.path);
        if (!resolution) continue;
        const normalized = normalizeVaultPath(item.path);
        const localFilePath = pathModule.join(this.vaultPath, normalized);
        const remoteEntry = remoteMap.get(normalized) ?? remoteMap.get(item.path);
        this.reportPairingApplyProgress({
          phase: resolution === 'keep_local' ? 'adopting_local' : 'pulling_remote',
          completed: divergentCompleted,
          total: decisions.divergentResolutions.size,
          currentPath: item.path,
        }, onProgress);
        try {
          if (resolution === 'keep_local') {
            if (!fs.existsSync(localFilePath)) {
              result.errors.push(`Cannot keep local for ${item.path}: local file missing.`);
              continue;
            }
            const content = new Uint8Array(fs.readFileSync(localFilePath));
            const quartzoHash = this.calculateHash(content);
            if (remoteEntry) {
              // Overwrite the existing Drive file with local content.
              const updatedMeta = await this.driveAdapter.updateFile(remoteEntry.id, content, quartzoHash);
              const syncFile = this.createSyncFile(normalized, { hash: quartzoHash, exists: true });
              syncFile.baseHash = quartzoHash;
              syncFile.localHash = quartzoHash;
              syncFile.remoteHash = quartzoHash;
              syncFile.remoteFileId = updatedMeta.id;
              syncFile.remoteExists = true;
              syncFile.remoteModifiedAt = updatedMeta.modifiedTime || null;
              this.syncState.files.set(normalized, syncFile);
            } else {
              const metadata = await this.driveAdapter.uploadFile({ folderId: driveFolderId, name: normalized, content, quartzoHash });
              const syncFile = this.createSyncFile(normalized, { hash: quartzoHash, exists: true });
              syncFile.baseHash = quartzoHash;
              syncFile.localHash = quartzoHash;
              syncFile.remoteHash = quartzoHash;
              syncFile.remoteFileId = metadata.id;
              syncFile.remoteExists = true;
              syncFile.remoteModifiedAt = metadata.modifiedTime || null;
              this.syncState.files.set(normalized, syncFile);
            }
            result.synced++;
          } else {
            // keep_drive: download Drive content and replace local file.
            if (!remoteEntry) {
              result.errors.push(`Cannot keep Drive for ${item.path}: remote file no longer found.`);
              continue;
            }
            const syncFile = this.createSyncFile(normalized, { hash: '', exists: fs.existsSync(localFilePath) });
            syncFile.remoteFileId = remoteEntry.id;
            await this.pullFile(normalized, remoteEntry, syncFile);
            result.synced++;
          }
        } catch (error) {
          if (error instanceof TemporaryDriveQuotaError) throw error;
          result.errors.push(`Failed to resolve divergent ${item.path} (${resolution}): ${error}`);
        }
        divergentCompleted++;
      }
      if (result.errors.length > 0) {
        this.pairingLastError = result.errors.join('; ');
        return result;
      }
    }

    if (decisions.autoAdopt) {
      let adoptCompleted = 0;
        this.reportPairingApplyProgress(
          { phase: 'adopting_local', completed: adoptCompleted, total: summary.localOnly.length },
          onProgress
        );
      for (const item of summary.localOnly) {
        await this.checkpointSync();
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
          const remoteHash = await this.resolveRemoteHashCached(appearedRemote);
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
        await this.checkpointSync();
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
            : await this.resolveRemoteHashCached(remoteEntry);
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
      if (error instanceof SyncOperationCancelledError) {
        result.cancelled = true;
        try {
          await this.saveSyncState();
        } catch (saveError) {
          result.errors.push(`Pairing was cancelled, but its checkpoint could not be saved: ${saveError}`);
        }
        this.pairingLastError = result.errors.length > 0 ? result.errors.join('; ') : 'Pairing cancelled safely. Completed work was checkpointed.';
      } else {
        this.pairingLastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
      return result;
    } finally {
      this.pairingApplyInProgress = false;
      this.pairingApplyProgress = null;
      this.operationControl = null;
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

  private async buildLocalInventory(
    onProgress?: (completed: number, currentPath: string) => void | Promise<void>
  ): Promise<Map<string, { hash: string; exists: boolean }>> {
    const inventory = new Map<string, { hash: string; exists: boolean }>();
    let completed = 0;
    const signatureOf = (stat: fs.BigIntStats): string =>
      [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':');

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      if (!fs.existsSync(dirPath)) throw new Error('Local inventory directory is unavailable: ' + relativePath);

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = pathModule.join(dirPath, entry.name);
        if (this.originalStateStorePath && (fullPath === this.originalStateStorePath || fullPath.startsWith(this.originalStateStorePath + '.'))) continue;
        const relativeFilePath = relativePath
          ? normalizeVaultPath(`${relativePath}/${entry.name}`)
          : normalizeVaultPath(entry.name);

        if (entry.isDirectory()) {
          if (VaultSyncFilePolicy.shouldSyncDirectory(relativeFilePath)) {
            await scanDirectory(fullPath, relativeFilePath);
          }
        } else if (entry.isFile()) {
          if (VaultSyncFilePolicy.shouldSyncFile(relativeFilePath)) {
            let scanned = false;
            try {
              const before = fs.statSync(fullPath, { bigint: true });
              if (SyncEngine.immutableReadingHash(relativeFilePath) && Number(before.size) > SyncEngine.readingShardMaxBytes) {
                throw new Error('Reading bytes exceed the supported shard bound');
              }
              const signature = signatureOf(before);
              const cached = this.localHashCache.get(relativeFilePath);
              let hash: string;
              if (cached?.signature === signature) {
                hash = cached.hash;
              } else {
                const content = await fs.promises.readFile(fullPath);
                if (SyncEngine.immutableReadingHash(relativeFilePath) && content.byteLength > SyncEngine.readingShardMaxBytes) {
                  throw new Error('Reading bytes exceed the supported shard bound');
                }
                if (signatureOf(fs.statSync(fullPath, { bigint: true })) !== signature) {
                  throw new Error('Local file changed during inventory: ' + relativeFilePath);
                }
                hash = this.calculateHash(new Uint8Array(content));
                this.localHashCache.set(relativeFilePath, { signature, hash });
              }
              const expectedWrite = this.expectedWatcherWrites.get(relativeFilePath);
              if (expectedWrite && expectedWrite.hash !== hash) {
                this.expectedWatcherWrites.delete(relativeFilePath);
              }
              inventory.set(relativeFilePath, { hash, exists: true });
              completed++;
              scanned = true;
            } catch (error) {
              this.localHashCache.delete(relativeFilePath);
              // An incomplete inventory is not evidence of deletion. Stop before
              // reconciliation can retire a remote or acknowledge a missing file.
              throw new Error(`Failed to read file ${relativeFilePath}: ${error}`);
            }
            if (scanned) {
              await onProgress?.(completed, relativeFilePath);
              if (completed % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        }
      }
    };

    await scanDirectory(this.vaultPath);
    for (const key of this.localHashCache.keys()) {
      if (!inventory.has(key)) this.localHashCache.delete(key);
    }
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
        // Validate the temp file is parseable before promoting it; if it throws,
        // the outer catch will surface the error without corrupting state.
        const tempContent = fs.readFileSync(tempPath, 'utf-8');
        JSON.parse(tempContent); // throws on corrupt JSON — do not rename in that case
        fs.renameSync(tempPath, this.stateStorePath);
      }
      if (fs.existsSync(this.stateStorePath)) {
        const content = fs.readFileSync(this.stateStorePath, 'utf-8');
        const data = JSON.parse(content);
        if (data.targetScope && data.targetScope !== this.targetScope) throw new Error('Sync state belongs to another account or vault');

        if (data.version && data.version !== CURRENT_STATE_VERSION) {
          throw new Error(`Incompatible sync state version: ${data.version}. Expected: ${CURRENT_STATE_VERSION}`);
        }

        this.syncState = {
          files: new Map(data.files || []),
          lastSyncTime: data.lastSyncTime || 0,
          driveChangeToken: data.driveChangeToken || null,
          driveFolderId: data.driveFolderId || null,
          forceFullReconciliation: data.forceFullReconciliation === true,
          version: data.version || CURRENT_STATE_VERSION
        };
        this.remoteHashCache = new Map(data.remoteHashCache || []);
        this.pendingRenames = data.pendingRenames || [];
        this.pendingDeletes = new Set(data.pendingDeletes || []);
        this.pendingCreates = new Set(data.pendingCreates || []);
      } else {
        this.syncState = {
          files: new Map(),
          lastSyncTime: 0,
          driveChangeToken: null,
          driveFolderId: null,
          forceFullReconciliation: false,
          version: CURRENT_STATE_VERSION
        };
        this.pendingRenames = [];
        this.pendingDeletes = new Set();
        this.pendingCreates = new Set();
      }
    } catch (error) {
      throw new Error(`Failed to load sync state: ${error}. Sync aborted to prevent data loss.`);
    }
  }

  private async saveSyncState(): Promise<void> {
    if (!this.stateStorePath) return;

    try {
      const data = {
        targetScope: this.targetScope,
        files: Array.from(this.syncState.files.entries()),
        lastSyncTime: this.syncState.lastSyncTime,
        driveChangeToken: this.syncState.driveChangeToken,
        driveFolderId: this.syncState.driveFolderId,
        forceFullReconciliation: this.syncState.forceFullReconciliation === true,
        version: this.syncState.version,
        remoteHashCache: Array.from(this.remoteHashCache.entries()),
        pendingRenames: this.pendingRenames,
        pendingDeletes: Array.from(this.pendingDeletes),
        pendingCreates: Array.from(this.pendingCreates),
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
    if (actualHash !== expected.hash) {
      this.expectedWatcherWrites.delete(normalized);
      return false;
    }
    // Filesystem providers may emit several events for the same atomic write.
    // Keep the proof until different bytes arrive, rather than suppressing only
    // the first event and scheduling another sync for the remaining echoes.
    return true;
  }

  async triggerManualSync(onProgress?: (progress: SyncProgress) => void): Promise<SyncResult> {
    return this.reconcile(false, onProgress);
  }

  async triggerFullReconciliation(onProgress?: (progress: SyncProgress) => void): Promise<SyncResult> {
    return this.reconcile(true, onProgress);
  }

  async triggerStartupSync(): Promise<SyncResult> {
    await new Promise(resolve => setTimeout(resolve, this.backoffMs));
    return this.reconcile();
  }

  async triggerFocusSync(): Promise<SyncResult> {
    return this.reconcile();
  }

  async queueCreate(filePath: string): Promise<void> {
    const normalized = normalizeVaultPath(filePath);
    if (!this.syncState.driveFolderId || !this.syncState.lastSyncTime ||
        this.syncState.files.has(normalized) || !VaultSyncFilePolicy.shouldSyncFile(normalized)) return;
    this.pendingCreates.add(normalized);
    await this.saveSyncState();
  }

  queueRename(oldPath: string, newPath: string): void {
    this.pendingRenames.push({ oldPath: normalizeVaultPath(oldPath), newPath: normalizeVaultPath(newPath), timestamp: Date.now() });
    this.saveSyncState().catch(e => console.error("Failed to save pending rename", e));
  }

  queueDelete(filePath: string): void {
    const normalized = normalizeVaultPath(filePath);
    this.pendingDeleteTickets.set(normalized, {});
    this.pendingDeletes.add(normalized);
    this.saveSyncState().catch(e => console.error("Failed to save pending delete", e));
  }
}
