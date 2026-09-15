import { DriveAdapter, DriveFileMetadata, DriveChange } from '../../../sync/coordinator/types';
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

    // Build full paths from hierarchy
    const filesWithPaths = await this.buildFilePaths(files, folderId);

    return {
      files: filesWithPaths,
      nextPageToken: response.data.nextPageToken || null
    };
  }

  private async buildFilePaths(files: DriveFileMetadata[], rootFolderId: string): Promise<DriveFileMetadata[]> {
    const drive = this.getDriveClient();
    const pathCache = new Map<string, string>(); // fileId -> path
    
    // Set root folder path
    pathCache.set(rootFolderId, '');

    const getPath = async (fileId: string, parents: string[] | undefined): Promise<string> => {
      if (pathCache.has(fileId)) {
        return pathCache.get(fileId)!;
      }

      if (!parents || parents.length === 0) {
        return '';
      }

      const parentId = parents[0];
      const parentPath = await getPath(parentId, undefined);
      
      // Get parent name
      try {
        const parent = await drive.files.get({
          fileId: parentId,
          fields: 'name'
        });
        const parentName = parent.data.name || '';
        const fullPath = parentPath ? `${parentPath}/${parentName}` : parentName;
        pathCache.set(fileId, fullPath);
        return fullPath;
      } catch (error) {
        console.error(`Failed to get path for file ${fileId}:`, error);
        return '';
      }
    };

    const result: DriveFileMetadata[] = [];
    for (const file of files) {
      const parentPath = file.parents && file.parents.length > 0 
        ? await getPath(file.parents[0], file.parents.slice(1)) 
        : '';
      const fullPath = parentPath ? `${parentPath}/${file.name}` : file.name;
      result.push({
        ...file,
        name: fullPath // Use full path as the logical name
      });
    }

    return result;
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

    // Parse the path to get filename and parent folder structure
    const pathParts = name.split('/');
    const fileName = pathParts.pop() || name;
    let currentParentId = parentId || folderId;

    // Create nested folder structure if needed
    for (const folderName of pathParts) {
      if (!folderName) continue;
      
      // Check if folder exists
      const existingFolder = await this.findFolderByName(currentParentId, folderName);
      if (existingFolder) {
        currentParentId = existingFolder;
      } else {
        // Create new folder
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

    const media = {
      mimeType: 'application/octet-stream',
      body: Buffer.from(content)
    };

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [currentParentId]
      },
      media: media,
      fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents'
    });

    const data = await response;
    return {
      id: data.data.id || '',
      name: name, // Return the full logical path
      mimeType: data.data.mimeType || '',
      modifiedTime: data.data.modifiedTime || new Date().toISOString(),
      md5Checksum: data.data.md5Checksum || undefined,
      parents: data.data.parents || undefined
    };
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
    } catch (error) {
      console.error(`Failed to find folder ${folderName}:`, error);
      return null;
    }
  }

  async getStartPageToken(): Promise<string> {
    const drive = this.getDriveClient();
    
    try {
      const response = await drive.changes.getStartPageToken();
      return response.data.startPageToken || '';
    } catch (error) {
      console.error('Failed to get start page token:', error);
      throw new Error('Failed to get start page token from Drive API');
    }
  }

  async listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newPageToken: string }> {
    const drive = this.getDriveClient();
    
    try {
      const response = await drive.changes.list({
        pageToken: pageToken,
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, md5Checksum, parents))',
        pageSize: 100
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
          parents: change.file.parents || undefined
        } : undefined
      }));

      const newPageToken = response.data.newStartPageToken || response.data.nextPageToken || pageToken;

      return { changes, newPageToken };
    } catch (error) {
      console.error('Failed to list changes:', error);
      throw new Error('Failed to list changes from Drive API');
    }
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
