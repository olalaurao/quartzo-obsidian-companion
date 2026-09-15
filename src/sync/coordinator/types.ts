export interface SyncFile {
  path: string;
  localHash: string;
  remoteHash: string | null;
  baseHash: string | null;
  remoteFileId: string | null;
  localExists: boolean;
  remoteExists: boolean;
  isBinary: boolean;
}

export interface SyncState {
  files: Map<string, SyncFile>;
  lastSyncTime: number;
  pageToken: string | null;
  driveFolderId: string | null;
}

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
  md5Checksum?: string;
  parents?: string[];
}

export interface DriveAdapter {
  getFolderId(): Promise<string | null>;
  setFolderId(folderId: string): Promise<void>;
  listFiles(folderId: string, pageToken?: string): Promise<{ files: DriveFileMetadata[]; nextPageToken: string | null }>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  uploadFile(folderId: string, name: string, content: Uint8Array, parentId?: string): Promise<DriveFileMetadata>;
  deleteFile(fileId: string): Promise<void>;
  getFileMetadata(fileId: string): Promise<DriveFileMetadata>;
}
