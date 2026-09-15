import { DriveAdapter, DriveFileMetadata } from '../../../sync/coordinator/types';
import { drive_v3, google } from 'googleapis';

export class GoogleDriveAdapter implements DriveAdapter {
  private accessToken: string | null = null;
  private folderId: string | null = null;
  private drive: drive_v3.Drive | null = null;

  constructor(accessToken?: string) {
    this.accessToken = accessToken || null;
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

  async getFolderId(): Promise<string | null> {
    return this.folderId;
  }

  async setFolderId(folderId: string): Promise<void> {
    this.folderId = folderId;
  }

  async listFiles(folderId: string, pageToken?: string): Promise<{ files: DriveFileMetadata[]; nextPageToken: string | null }> {
    const drive = this.getDriveClient();

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents)',
      pageSize: 100,
      pageToken: pageToken
    });

    const files: DriveFileMetadata[] = (response.data.files || []).map(file => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      md5Checksum: file.md5Checksum || undefined,
      parents: file.parents || undefined
    }));

    return {
      files,
      nextPageToken: response.data.nextPageToken || null
    };
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    const drive = this.getDriveClient();

    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media'
    }, { responseType: 'stream' });

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = response.data as { on: (event: string, handler: (chunk: Buffer) => void) => void };
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async uploadFile(folderId: string, name: string, content: Uint8Array, parentId?: string): Promise<DriveFileMetadata> {
    const drive = this.getDriveClient();

    const media = {
      mimeType: 'application/octet-stream',
      body: Buffer.from(content)
    };

    const response = await drive.files.create({
      requestBody: {
        name: name,
        parents: [parentId || folderId]
      },
      media: media,
      fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents'
    });

    const data = await response;
    return {
      id: data.data.id || '',
      name: data.data.name || '',
      mimeType: data.data.mimeType || '',
      modifiedTime: data.data.modifiedTime || new Date().toISOString(),
      md5Checksum: data.data.md5Checksum || undefined,
      parents: data.data.parents || undefined
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const drive = this.getDriveClient();
    await drive.files.delete({ fileId: fileId });
  }

  async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    const drive = this.getDriveClient();

    const response = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents'
    });

    const data = await response;
    return {
      id: data.data.id || '',
      name: data.data.name || '',
      mimeType: data.data.mimeType || '',
      modifiedTime: data.data.modifiedTime || new Date().toISOString(),
      md5Checksum: data.data.md5Checksum || undefined,
      parents: data.data.parents || undefined
    };
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
    this.drive = null;
  }
}
