export interface SyncFile {
  path: string;
  localHash: string;
  remoteHash: string | null;
  baseHash: string | null;
  remoteFileId: string | null;
  localExists: boolean;
  remoteExists: boolean;
  isBinary: boolean;
  localModifiedAt?: string | null;
  remoteModifiedAt?: string | null;
}

export interface SyncState {
  files: Map<string, SyncFile>;
  lastSyncTime: number;
  driveChangeToken: string | null;
  driveFolderId: string | null;
  version: string;
  pendingRenames?: PendingRename[];
  pendingDeletes?: string[];
}

export const CURRENT_STATE_VERSION = '1.1.0';

export interface SyncResult {
  synced: number;
  conflicts: number;
  errors: string[];
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  md5Checksum?: string | null;
  parents?: string[] | null;
  quartzoHash?: string | null;
  trashed?: boolean | null;
  relativePath?: string | null;
}

export class TemporaryDriveQuotaError extends Error {
  constructor(message = 'Google Drive temporary quota limit remained exhausted after retries.') {
    super(message);
    this.name = 'TemporaryDriveQuotaError';
  }
}

export interface DriveAdapter {
  getFolderId(): Promise<string | null>;
  setFolderId(folderId: string): Promise<void>;
  listAllFiles(folderId: string): Promise<DriveFileMetadata[]>;
  listFiles(folderId: string, pageToken?: string): Promise<{ files: DriveFileMetadata[]; nextPageToken: string | null }>;
  listQuartzoVaultCandidates(): Promise<Array<{ id: string; name: string }>>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string; nextPageToken: string | null }>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  uploadFile(params: UploadFileParams): Promise<DriveFileMetadata>;
  updateFile(fileId: string, content: Uint8Array, quartzoHash: string): Promise<DriveFileMetadata>;
  renameFile(fileId: string, newName: string, newParentId?: string): Promise<DriveFileMetadata>;
  deleteFile(fileId: string): Promise<void>;
  trashFile(fileId: string): Promise<void>;
  getFileMetadata(fileId: string): Promise<DriveFileMetadata>;
  ensureParentFolder(rootFolderId: string, filePath: string): Promise<string>;
  assertInsideSelectedVault(remoteFileId: string): Promise<void>;
  resolveExactPath(fileId: string): Promise<string>;
  resolveRemoteHash(metadata: DriveFileMetadata): Promise<string>;
}

export interface UploadFileParams {
  folderId: string;
  name: string;
  content: Uint8Array;
  quartzoHash: string;
  parentId?: string;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFileMetadata;
}

export interface PendingRename {
  oldPath: string;
  newPath: string;
  timestamp: number;
}
