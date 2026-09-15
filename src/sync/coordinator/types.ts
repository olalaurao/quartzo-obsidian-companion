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
  version: string; // State format version for compatibility checking
}

export const CURRENT_STATE_VERSION = '1.0.0';

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
}

export interface DriveAdapter {
  getFolderId(): Promise<string | null>;
  setFolderId(folderId: string): Promise<void>;
  listFiles(folderId: string, pageToken?: string): Promise<{ files: DriveFileMetadata[]; nextPageToken: string | null }>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newPageToken: string }>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  uploadFile(folderId: string, name: string, content: Uint8Array, parentId?: string): Promise<DriveFileMetadata>;
  deleteFile(fileId: string): Promise<void>;
  getFileMetadata(fileId: string): Promise<DriveFileMetadata>;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFileMetadata;
}
