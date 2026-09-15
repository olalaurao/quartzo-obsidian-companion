import { SyncEngine } from '../../core/sync';
import { DriveAdapter, SyncFile, SyncState, SyncResult, DriveFileMetadata, CURRENT_STATE_VERSION } from './types';
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
}

export interface ConflictRegistry {
  getConflicts(): ConflictArtifact[];
  resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive'): void;
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

  resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive'): void {
    const normalized = normalizeVaultPath(originalPath);
    const artifact = this.conflicts.get(normalized);
    if (!artifact) return;

    const resolvedHash = resolution === 'keep_local' ? artifact.localSha256 : artifact.remoteSha256;
    const resolvedContent = resolution === 'keep_local' ? artifact.localContent : artifact.remoteContent;

    const localFilePath = pathModule.join(this.vaultPath, normalized);
    const dir = pathModule.dirname(localFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(localFilePath)) {
      fs.writeFileSync(localFilePath, resolvedContent);
    } else {
      fs.writeFileSync(localFilePath, resolvedContent);
    }

    const syncFile = this.syncState.files.get(normalized) || this.createSyncFile(normalized, { hash: resolvedHash, exists: true });
    syncFile.baseHash = resolvedHash;
    syncFile.localHash = resolvedHash;
    syncFile.remoteHash = resolvedHash;
    syncFile.localExists = true;
    syncFile.remoteExists = true;
    syncFile.localExists = true;

    if (resolution === 'keep_drive' && artifact.remoteFileId) {
      syncFile.remoteFileId = artifact.remoteFileId;
    }

    this.syncState.files.set(normalized, syncFile);
    this.conflicts.delete(normalized);

    this.removeConflictArtifacts(normalized);
  }

  private removeConflictArtifacts(originalPath: string): void {
    const paths = [
      pathModule.join(this.vaultPath, `${originalPath}.local`),
      pathModule.join(this.vaultPath, `${originalPath}.remote`),
      pathModule.join(this.vaultPath, `${originalPath}.conflict.json`),
      pathModule.join(this.vaultPath, `${originalPath}.conflict`),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore cleanup errors */ }
      }
    }
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

      const driveFolderId = await this.driveAdapter.getFolderId();
      if (!driveFolderId) {
        throw new Error('Drive folder not configured');
      }

      this.syncState.driveFolderId = driveFolderId;

      const localInventory = await this.buildLocalInventory();

      if (this.syncState.driveChangeToken) {
        await this.processChanges(localInventory, result);
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
            timestamp: new Date().toISOString()
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

      const localHash = localFile.hash;
      const remoteHash = remoteFile ? (remoteFile.quartzoHash || null) : null;
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

        const localFile = localInventory.get(normalizedRemote);
        const syncFile = this.syncState.files.get(normalizedRemote) || this.createSyncFile(normalizedRemote, localFile || { hash: '', exists: false });

        const remoteHash = change.file.quartzoHash || null;
        syncFile.remoteFileId = change.file.id;

        if (!localFile) {
          await this.pullFile(normalizedRemote, change.file, syncFile);
          result.synced++;
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

  private findSyncFileByRemoteId(remoteId: string): SyncFile | undefined {
    for (const syncFile of this.syncState.files.values()) {
      if (syncFile.remoteFileId === remoteId) return syncFile;
    }
    return undefined;
  }

  private async resolveRemotePath(file: DriveFileMetadata, rootFolderId: string): Promise<string | null> {
    if (file.name && file.name.includes('/')) return file.name;

    if (!file.parents || file.parents.length === 0) return file.name;

    try {
      const metadata = await this.driveAdapter.getFileMetadata(file.parents[0]);
      return metadata.name ? `${metadata.name}/${file.name}` : file.name;
    } catch {
      return file.name;
    }
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

    const conflictDir = pathModule.join(this.vaultPath, '_conflicts');
    if (!fs.existsSync(conflictDir)) {
      fs.mkdirSync(conflictDir, { recursive: true });
    }

    const conflictBase = `_conflicts/${filePath}`;

    if (isBinary) {
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.local`), Buffer.from(localContent));
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.remote`), Buffer.from(remoteContent));

      const metadata = {
        originalPath: filePath,
        conflictType: 'binary',
        local: { sha256: localSha256, size: localContent.length },
        remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || null },
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.conflict.json`), JSON.stringify(metadata, null, 2));
    } else {
      const conflictContent = Buffer.concat([
        Buffer.from(`# Conflict: ${filePath}\n\n`),
        Buffer.from(`## Local Version (SHA-256: ${localSha256})\n\n`),
        Buffer.from(localContent),
        Buffer.from('\n\n---\n\n'),
        Buffer.from(`## Remote Version (SHA-256: ${remoteSha256})\n\n`),
        Buffer.from(remoteContent)
      ]);
      fs.writeFileSync(pathModule.join(this.vaultPath, `${conflictBase}.conflict`), conflictContent);
    }

    this.conflicts.set(filePath, {
      originalPath: filePath,
      localContent,
      remoteContent,
      localSha256,
      remoteSha256,
      remoteFileId: remoteFile?.id || syncFile.remoteFileId || null,
      isBinary,
      timestamp: new Date().toISOString()
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
      } else {
        this.syncState = {
          files: new Map(),
          lastSyncTime: 0,
          driveChangeToken: null,
          driveFolderId: null,
          version: CURRENT_STATE_VERSION
        };
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
        version: this.syncState.version
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
}
