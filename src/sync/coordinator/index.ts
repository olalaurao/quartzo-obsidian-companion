import { SyncEngine } from '../../core/sync';
import { DriveAdapter, SyncFile, SyncState, SyncResult, DriveFileMetadata } from './types';
import * as crypto from 'crypto';

export class DriveSyncCoordinator {
  private syncState: SyncState;
  private driveAdapter: DriveAdapter;
  private vaultPath: string;

  constructor(driveAdapter: DriveAdapter, vaultPath: string) {
    this.driveAdapter = driveAdapter;
    this.vaultPath = vaultPath;
    this.syncState = {
      files: new Map(),
      lastSyncTime: 0,
      pageToken: null,
      driveFolderId: null
    };
  }

  async reconcile(): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };

    try {
      // Get or create Drive folder
      let driveFolderId = await this.driveAdapter.getFolderId();
      if (!driveFolderId) {
        throw new Error('Drive folder not configured');
      }

      // List remote files
      const { files: remoteFiles, nextPageToken } = await this.driveAdapter.listFiles(driveFolderId, this.syncState.pageToken || undefined);
      this.syncState.pageToken = nextPageToken;
      this.syncState.driveFolderId = driveFolderId;

      // Build remote file map
      const remoteFileMap = new Map<string, DriveFileMetadata>();
      for (const file of remoteFiles) {
        remoteFileMap.set(file.name, file);
      }

      // Process each local file
      // In production, this would scan the vault directory
      // For now, we process the sync state files
      for (const [path, syncFile] of this.syncState.files.entries()) {
        try {
          const remoteFile = remoteFileMap.get(path);
          const remoteHash = remoteFile ? remoteFile.md5Checksum || '' : null;
          
          const vector = {
            id: path,
            baseHash: syncFile.baseHash,
            localHash: syncFile.localHash,
            remoteHash: remoteHash,
            localExists: syncFile.localExists,
            remoteExists: remoteFile !== undefined,
            expected: ''
          };

          const syncDecision = SyncEngine.reconcile(vector);

          switch (syncDecision.action) {
            case 'push':
              await this.pushFile(path, syncFile);
              result.synced++;
              break;
            case 'pull':
              if (remoteFile) {
                await this.pullFile(path, remoteFile);
                result.synced++;
              }
              break;
            case 'delete_local':
              await this.deleteLocalFile(path);
              result.synced++;
              break;
            case 'conflict':
              result.conflicts++;
              await this.handleConflict(path, syncFile, remoteFile);
              break;
            case 'advance_baseline':
              syncFile.baseHash = syncFile.localHash;
              if (remoteFile) {
                syncFile.remoteHash = remoteFile.md5Checksum || '';
                syncFile.remoteFileId = remoteFile.id;
              }
              break;
          }
        } catch (error) {
          result.errors.push(`${path}: ${error}`);
        }
      }

      // Handle remote-only files
      for (const [path, remoteFile] of remoteFileMap.entries()) {
        if (!this.syncState.files.has(path)) {
          const vector = {
            id: path,
            baseHash: null,
            localHash: null,
            remoteHash: remoteFile.md5Checksum || '',
            localExists: false,
            remoteExists: true,
            expected: 'pull'
          };

          const syncDecision = SyncEngine.reconcile(vector);
          if (syncDecision.action === 'pull') {
            await this.pullFile(path, remoteFile);
            result.synced++;
          }
        }
      }

      this.syncState.lastSyncTime = Date.now();
    } catch (error) {
      result.errors.push(`Sync failed: ${error}`);
    }

    return result;
  }

  private async pushFile(path: string, syncFile: SyncFile): Promise<void> {
    // In production, read local file content
    const content = new Uint8Array(); // Placeholder
    const folderId = this.syncState.driveFolderId || '';
    
    const metadata = await this.driveAdapter.uploadFile(folderId, path, content);
    
    syncFile.remoteHash = metadata.md5Checksum || '';
    syncFile.remoteFileId = metadata.id;
    syncFile.baseHash = syncFile.localHash;
  }

  private async pullFile(path: string, remoteFile: DriveFileMetadata): Promise<void> {
    const content = await this.driveAdapter.downloadFile(remoteFile.id);
    
    // In production, write content to local file
    // For now, update sync state
    const localHash = this.calculateHash(content);
    
    const syncFile: SyncFile = {
      path,
      localHash,
      remoteHash: remoteFile.md5Checksum || '',
      baseHash: remoteFile.md5Checksum || '',
      remoteFileId: remoteFile.id,
      localExists: true,
      remoteExists: true,
      isBinary: this.isBinaryFile(path)
    };
    
    this.syncState.files.set(path, syncFile);
  }

  private async deleteLocalFile(path: string): Promise<void> {
    // In production, delete local file
    this.syncState.files.delete(path);
  }

  private async handleConflict(path: string, syncFile: SyncFile, remoteFile: DriveFileMetadata | undefined): Promise<void> {
    // Create conflict artifact
    const conflictPath = `${path}.conflict`;
    // In production, would create conflict file with both versions
    console.warn(`Conflict detected for ${path}`);
  }

  private calculateHash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
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
}
