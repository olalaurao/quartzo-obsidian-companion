import { DriveAdapter, DriveFileMetadata, DriveChange, UploadFileParams } from '../../../sync/coordinator/types';
import { drive_v3, google } from 'googleapis';
import { normalizeVaultPath } from '../../../sync/coordinator/path-utils';
import * as crypto from 'crypto';

export class GoogleDriveAdapter implements DriveAdapter {
  private accessToken: string | null = null;
  private folderId: string | null = null;
  private drive: drive_v3.Drive | null = null;
  private tokenRefreshCallback: (() => Promise<string | null>) | null = null;

  constructor(accessToken?: string) {
    this.accessToken = accessToken || null;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
    this.drive = null;
  }

  setTokenRefreshCallback(callback: () => Promise<string | null>): void {
    this.tokenRefreshCallback = callback;
  }

  private getDriveClient(): drive_v3.Drive {
    if (!this.accessToken) {
      throw new Error('No access token available');
    }
    if (!this.drive) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: this.accessToken });
      this.drive = google.drive({ version: 'v3', auth });
    }
    return this.drive;
  }

  private async withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const err = error as { code?: number; status?: number; response?: { status?: number } };
        const statusCode = err.code || err.status || err.response?.status;

        if (statusCode === 401 || (statusCode === 403 && this.isCredentialError(err))) {
          if (this.tokenRefreshCallback) {
            const newToken = await this.tokenRefreshCallback();
            if (newToken) {
              this.setAccessToken(newToken);
              continue;
            }
          }
          throw error;
        }

        if (statusCode === 429 || (statusCode && statusCode >= 500) || !statusCode) {
          if (attempt < maxRetries) {
            const baseMs = statusCode === 429 ? 2000 : 1000;
            const delay = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }

        throw error;
      }
    }
    throw lastError;
  }

  private isCredentialError(err: { code?: number; status?: number; response?: { status?: number } }): boolean {
    const statusCode = err.code || err.status || err.response?.status;
    if (statusCode !== 403) return false;
    return true;
  }

  private calculateQuartzoHash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async getFolderId(): Promise<string | null> {
    return this.folderId;
  }

  async setFolderId(folderId: string): Promise<void> {
    this.folderId = folderId;
  }

  async listFiles(folderId: string, pageToken?: string): Promise<{ files: DriveFileMetadata[]; nextPageToken: string | null }> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties)',
        pageSize: 100,
        pageToken: pageToken
      });

      const files: DriveFileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        modifiedTime: file.modifiedTime || new Date().toISOString(),
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        quartzoHash: (file as Record<string, unknown>).appProperties &&
          typeof (file as Record<string, unknown>).appProperties === 'object'
          ? ((file as Record<string, unknown>).appProperties as Record<string, string>).Quartzo_hash || null
          : null
      }));

      return {
        files,
        nextPageToken: response.data.nextPageToken || null
      };
    });
  }

  async listAllFiles(folderId: string): Promise<DriveFileMetadata[]> {
    return this.withRetry(async () => {
      const allFiles: DriveFileMetadata[] = [];
      const drive = this.getDriveClient();
      await this.listAllFilesRecursive(drive, folderId, allFiles);
      return allFiles;
    });
  }

  private async listAllFilesRecursive(drive: drive_v3.Drive, folderId: string, allFiles: DriveFileMetadata[]): Promise<void> {
    let pageToken: string | undefined;
    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties)',
        pageSize: 1000,
        pageToken
      });

      const files: DriveFileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        modifiedTime: file.modifiedTime || new Date().toISOString(),
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        quartzoHash: (file as Record<string, unknown>).appProperties &&
          typeof (file as Record<string, unknown>).appProperties === 'object'
          ? ((file as Record<string, unknown>).appProperties as Record<string, string>).Quartzo_hash || null
          : null
      }));

      for (const file of files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          await this.listAllFilesRecursive(drive, file.id, allFiles);
        } else {
          allFiles.push(file);
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  }

  async listRootFolders(): Promise<Array<{ id: string; name: string }>> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: 'files(id, name)',
        pageSize: 100
      });
      return (response.data.files || []).map(f => ({ id: f.id || '', name: f.name || '' }));
    });
  }

  async getStartPageToken(): Promise<string> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.changes.getStartPageToken();
      return response.data.startPageToken || '';
    });
  }

  async listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string; nextPageToken: string | null }> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.changes.list({
        pageToken,
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties))',
        pageSize: 1000
      });

      const changes: DriveChange[] = (response.data.changes || []).map(change => ({
        fileId: change.fileId || '',
        removed: change.removed || false,
        file: change.file ? {
          id: change.file.id || '',
          name: change.file.name || '',
          mimeType: change.file.mimeType || '',
          modifiedTime: change.file.modifiedTime || new Date().toISOString(),
          md5Checksum: change.file.md5Checksum || undefined,
          parents: change.file.parents || undefined,
          quartzoHash: (change.file as Record<string, unknown>).appProperties &&
            typeof (change.file as Record<string, unknown>).appProperties === 'object'
            ? ((change.file as Record<string, unknown>).appProperties as Record<string, string>).Quartzo_hash || null
            : null
        } : undefined
      }));

      return {
        changes,
        newStartPageToken: response.data.newStartPageToken || pageToken,
        nextPageToken: response.data.nextPageToken || null
      };
    });
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.files.get({
        fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      return new Uint8Array(response.data as ArrayBuffer);
    });
  }

  async uploadFile(params: UploadFileParams): Promise<DriveFileMetadata> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const pathParts = params.name.split('/');
      const fileName = pathParts.pop() || params.name;
      let currentParentId = params.parentId || params.folderId;

      for (const folderName of pathParts) {
        if (!folderName) continue;
        const existingFolder = await this.findFolderByName(currentParentId, folderName);
        if (existingFolder) {
          currentParentId = existingFolder;
        } else {
          const folderMetadata = await drive.files.create({
            requestBody: {
              name: folderName,
              parents: [currentParentId],
              mimeType: 'application/vnd.google-apps.folder'
            },
            fields: 'id'
          });
          currentParentId = folderMetadata.data.id || currentParentId;
        }
      }

      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [currentParentId],
          appProperties: {
            Quartzo_hash: params.quartzoHash
          }
        },
        media: {
          mimeType: 'application/octet-stream',
          body: Buffer.from(params.content)
        },
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties'
      });

      const data = response.data;
      return {
        id: data.id || '',
        name: params.name,
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash: params.quartzoHash
      };
    });
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string): Promise<DriveFileMetadata> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.files.update({
        fileId,
        requestBody: {
          appProperties: {
            Quartzo_hash: quartzoHash
          }
        },
        media: {
          mimeType: 'application/octet-stream',
          body: Buffer.from(content)
        },
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties'
      });

      const data = response.data;
      return {
        id: data.id || '',
        name: data.name || '',
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash
      };
    });
  }

  private async findFolderByName(parentId: string, folderName: string): Promise<string | null> {
    const drive = this.getDriveClient();
    try {
      const response = await drive.files.list({
        q: `'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)',
        pageSize: 1
      });
      const files = response.data.files || [];
      return files.length > 0 ? (files[0].id || null) : null;
    } catch {
      return null;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      await drive.files.delete({ fileId });
    });
  }

  async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties'
      });

      const data = response.data;
      return {
        id: data.id || '',
        name: data.name || '',
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash: (data as Record<string, unknown>).appProperties &&
          typeof (data as Record<string, unknown>).appProperties === 'object'
          ? ((data as Record<string, unknown>).appProperties as Record<string, string>).Quartzo_hash || null
          : null
      };
    });
  }
}
