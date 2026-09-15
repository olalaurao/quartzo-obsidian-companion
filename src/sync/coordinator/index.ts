import { SyncEngine } from '../../core/sync';
import { DriveAdapter, SyncFile, SyncState, SyncResult, DriveFileMetadata, CURRENT_STATE_VERSION } from './types';
import { VaultSyncFilePolicy } from './file-policy';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as pathModule from 'path';

export class DriveSyncCoordinator {
  private syncState: SyncState;
  private driveAdapter: DriveAdapter;
  private vaultPath: string;
  private stateStorePath: string;
  private syncMutex: boolean = false;
  private syncQueue: Array<() => Promise<void>> = [];
  private backoffMs: number = 1000;
  private maxBackoffMs: number = 30000;
  private remoteSha256Cache: Map<string, string> = new Map(); // fileId -> SHA-256

  constructor(driveAdapter: DriveAdapter, vaultPath: string, stateStorePath?: string) {
    this.driveAdapter = driveAdapter;
    this.vaultPath = vaultPath;
    this.stateStorePath = stateStorePath || pathModule.join(vaultPath, '.quartzo-sync-state.json');
    this.syncState = {
      files: new Map(),
      lastSyncTime: 0,
      pageToken: null,
      driveFolderId: null,
      version: CURRENT_STATE_VERSION
    };
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
      const { files: remoteFiles, nextPageToken } = await this.driveAdapter.listFiles(driveFolderId, this.syncState.pageToken || undefined);
      this.syncState.pageToken = nextPageToken;

      const remoteFileMap = new Map<string, DriveFileMetadata>();
      const remoteIdMap = new Map<string, DriveFileMetadata>();

      for (const file of remoteFiles) {
        remoteFileMap.set(file.name, file);
        if (file.id) {
          remoteIdMap.set(file.id, file);
        }
      }

      // Pre-compute SHA-256 for all remote files
      await this.precomputeRemoteSha256(remoteFiles);

      for (const [localPath, localFile] of localInventory.entries()) {
        if (!VaultSyncFilePolicy.shouldSyncFile(localPath)) {
          continue;
        }

        const remoteFile = remoteFileMap.get(localPath);
        const syncFile = this.syncState.files.get(localPath) || this.createSyncFile(localPath, localFile);

        const localHash = localFile.hash;
        const remoteHash = remoteFile && remoteFile.id ? this.remoteSha256Cache.get(remoteFile.id) || null : null;
        const baseHash = syncFile.baseHash;

        const vector = {
          id: localPath,
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
            await this.pushFile(localPath, localFile, syncFile);
            result.synced++;
            break;
          case 'pull':
            if (remoteFile) {
              await this.pullFile(localPath, remoteFile, syncFile);
              result.synced++;
            }
            break;
          case 'delete_local':
            await this.deleteLocalFile(localPath);
            result.synced++;
            break;
          case 'conflict':
            result.conflicts++;
            await this.handleConflict(localPath, localFile, remoteFile, syncFile);
            break;
          case 'advance_baseline':
            syncFile.baseHash = localHash;
            if (remoteFile && remoteFile.id) {
              syncFile.remoteHash = this.remoteSha256Cache.get(remoteFile.id) || null;
              syncFile.remoteFileId = remoteFile.id;
            }
            this.syncState.files.set(localPath, syncFile);
            break;
          case 'adoption_required':
            await this.handleAdoption(localPath, localFile, syncFile);
            result.synced++;
            break;
        }
      }

      for (const [remotePath, remoteFile] of remoteFileMap.entries()) {
        if (!VaultSyncFilePolicy.shouldSyncFile(remotePath)) {
          continue;
        }

        if (!localInventory.has(remotePath)) {
          const vector = {
            id: remotePath,
            baseHash: null,
            localHash: null,
            remoteHash: remoteFile.id ? this.remoteSha256Cache.get(remoteFile.id) || null : null,
            localExists: false,
            remoteExists: true,
            expected: 'pull'
          };

          const syncDecision = SyncEngine.reconcile(vector);
          if (syncDecision.action === 'pull') {
            const syncFile = this.createSyncFile(remotePath, { hash: '', exists: false });
            await this.pullFile(remotePath, remoteFile, syncFile);
            result.synced++;
          }
        }
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

  private async pushFile(filePath: string, localFile: { hash: string; exists: boolean }, syncFile: SyncFile): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const content = fs.readFileSync(localFilePath);
    const folderId = this.syncState.driveFolderId || '';

    const metadata = await this.driveAdapter.uploadFile(folderId, filePath, content);

    // Calculate SHA-256 of uploaded content for canonical hash
    const uploadedSha256 = this.calculateHash(content);
    if (metadata.id) {
      this.remoteSha256Cache.set(metadata.id, uploadedSha256);
    }
    syncFile.remoteHash = uploadedSha256;
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

    fs.writeFileSync(localFilePath, content);

    const localHash = this.calculateHash(content);
    const remoteSha256 = this.remoteSha256Cache.get(remoteFile.id) || this.calculateHash(content);

    syncFile.localHash = localHash;
    syncFile.remoteHash = remoteSha256;
    syncFile.baseHash = remoteSha256;
    syncFile.remoteFileId = remoteFile.id;
    syncFile.localExists = true;
    syncFile.remoteExists = true;
    syncFile.isBinary = this.isBinaryFile(filePath);

    this.syncState.files.set(filePath, syncFile);
  }

  private async deleteLocalFile(filePath: string): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);

    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    this.syncState.files.delete(filePath);
  }

  private async handleConflict(filePath: string, localFile: { hash: string; exists: boolean }, remoteFile: DriveFileMetadata | undefined, syncFile: SyncFile): Promise<void> {
    const localFilePath = pathModule.join(this.vaultPath, filePath);
    const isBinary = this.isBinaryFile(filePath);

    if (fs.existsSync(localFilePath) && remoteFile) {
      const localContent = fs.readFileSync(localFilePath);
      const remoteContent = await this.driveAdapter.downloadFile(remoteFile.id);
      const remoteSha256 = this.remoteSha256Cache.get(remoteFile.id) || this.calculateHash(remoteContent);

      const conflictDir = pathModule.dirname(pathModule.join(this.vaultPath, filePath));
      if (!fs.existsSync(conflictDir)) {
        fs.mkdirSync(conflictDir, { recursive: true });
      }

      if (isBinary) {
        // Binary conflict: preserve bytes in separate files with metadata sidecar
        const localConflictPath = `${filePath}.local`;
        const remoteConflictPath = `${filePath}.remote`;
        const metadataPath = `${filePath}.conflict.json`;

        fs.writeFileSync(pathModule.join(this.vaultPath, localConflictPath), localContent);
        fs.writeFileSync(pathModule.join(this.vaultPath, remoteConflictPath), remoteContent);

        const metadata = {
          originalPath: filePath,
          conflictType: 'binary',
          local: {
            path: localConflictPath,
            sha256: localFile.hash,
            size: localContent.length
          },
          remote: {
            path: remoteConflictPath,
            sha256: remoteSha256,
            size: remoteContent.length,
            fileId: remoteFile.id
          },
          timestamp: new Date().toISOString()
        };

        fs.writeFileSync(pathModule.join(this.vaultPath, metadataPath), JSON.stringify(metadata, null, 2));
      } else {
        // Text conflict: use Markdown format
        const conflictPath = `${filePath}.conflict`;
        const conflictContent = Buffer.concat([
          Buffer.from(`# Conflict: ${filePath}\n\n`),
          Buffer.from(`## Local Version (SHA-256: ${localFile.hash})\n\n`),
          localContent,
          Buffer.from('\n\n---\n\n'),
          Buffer.from(`## Remote Version (SHA-256: ${remoteSha256})\n\n`),
          remoteContent
        ]);

        fs.writeFileSync(pathModule.join(this.vaultPath, conflictPath), conflictContent);
      }
    }

    console.warn(`Conflict detected for ${filePath}, created conflict artifact`);
  }

  private calculateHash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async precomputeRemoteSha256(remoteFiles: DriveFileMetadata[]): Promise<void> {
    for (const file of remoteFiles) {
      if (file.id && !this.remoteSha256Cache.has(file.id)) {
        try {
          const content = await this.driveAdapter.downloadFile(file.id);
          const sha256 = this.calculateHash(content);
          this.remoteSha256Cache.set(file.id, sha256);
        } catch (error) {
          console.error(`Failed to compute SHA-256 for remote file ${file.id}:`, error);
        }
      }
    }
  }

  private isBinaryFile(path: string): boolean {
    const binaryExtensions = ['.jpg', '.png', '.gif', '.pdf', '.zip', '.exe'];
    return binaryExtensions.some(ext => path.toLowerCase().endsWith(ext));
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
      if (!fs.existsSync(dirPath)) {
        return;
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = pathModule.join(dirPath, entry.name);
        const relativeFilePath = pathModule.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          if (VaultSyncFilePolicy.shouldSyncDirectory(relativeFilePath)) {
            scanDirectory(fullPath, relativeFilePath);
          }
        } else if (entry.isFile()) {
          if (VaultSyncFilePolicy.shouldSyncFile(relativeFilePath)) {
            try {
              const content = fs.readFileSync(fullPath);
              const hash = this.calculateHash(content);
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
      isBinary: this.isBinaryFile(filePath)
    };
  }

  private async handleAdoption(path: string, localFile: { hash: string; exists: boolean }, syncFile: SyncFile): Promise<void> {
    // First pairing: local-only file needs to be pushed to remote
    const localFilePath = pathModule.join(this.vaultPath, path);
    
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local file ${path} does not exist for adoption`);
    }

    const content = fs.readFileSync(localFilePath);
    const folderId = this.syncState.driveFolderId || '';

    // Upload to Drive to establish remote presence
    const metadata = await this.driveAdapter.uploadFile(folderId, path, content);

    // Calculate SHA-256 of uploaded content
    const uploadedSha256 = this.calculateHash(content);
    if (metadata.id) {
      this.remoteSha256Cache.set(metadata.id, uploadedSha256);
    }

    // Establish baseline with both local and remote present
    syncFile.baseHash = localFile.hash;
    syncFile.localHash = localFile.hash;
    syncFile.remoteHash = uploadedSha256;
    syncFile.remoteFileId = metadata.id;
    syncFile.localExists = true;
    syncFile.remoteExists = true;
    syncFile.isBinary = this.isBinaryFile(path);

    this.syncState.files.set(path, syncFile);
  }

  private async loadSyncState(): Promise<void> {
    try {
      if (fs.existsSync(this.stateStorePath)) {
        const content = fs.readFileSync(this.stateStorePath, 'utf-8');
        const data = JSON.parse(content);

        // Version compatibility check
        if (data.version && data.version !== CURRENT_STATE_VERSION) {
          throw new Error(`Incompatible sync state version: ${data.version}. Expected: ${CURRENT_STATE_VERSION}`);
        }

        this.syncState = {
          files: new Map(data.files || []),
          lastSyncTime: data.lastSyncTime || 0,
          pageToken: data.pageToken || null,
          driveFolderId: data.driveFolderId || null,
          version: data.version || CURRENT_STATE_VERSION
        };
      } else {
        // Initialize with current version if no state file exists
        this.syncState = {
          files: new Map(),
          lastSyncTime: 0,
          pageToken: null,
          driveFolderId: null,
          version: CURRENT_STATE_VERSION
        };
      }
    } catch (error) {
      // Fail-closed: if state cannot be loaded, throw error to prevent destructive sync
      throw new Error(`Failed to load sync state from ${this.stateStorePath}: ${error}. Sync aborted to prevent data loss.`);
    }
  }

  private async saveSyncState(): Promise<void> {
    try {
      const data = {
        files: Array.from(this.syncState.files.entries()),
        lastSyncTime: this.syncState.lastSyncTime,
        pageToken: this.syncState.pageToken,
        driveFolderId: this.syncState.driveFolderId,
        version: this.syncState.version
      };

      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.stateStorePath, content, 'utf-8');
    } catch (error) {
      // Fail-closed: if state cannot be saved, throw error to prevent sync without persistence
      throw new Error(`Failed to save sync state to ${this.stateStorePath}: ${error}. Sync aborted to prevent data loss.`);
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
