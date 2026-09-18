import { DriveAdapter, DriveFileMetadata, DriveChange, UploadFileParams } from '../../../sync/coordinator/types';
import { drive_v3, drive } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';
import { normalizeVaultPath } from '../../../sync/coordinator/path-utils';
import * as crypto from 'crypto';

function driveErrorText(error: unknown): string {
  const err = error as {
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    response?: {
      data?: unknown;
    };
  };
  const parts: string[] = [];
  if (err.message) parts.push(err.message);
  for (const item of err.errors ?? []) {
    if (item.reason) parts.push(item.reason);
    if (item.message) parts.push(item.message);
  }
  if (err.response?.data != null) {
    if (typeof err.response.data === 'string') {
      parts.push(err.response.data);
    } else {
      try {
        parts.push(JSON.stringify(err.response.data));
      } catch {
        parts.push(String(err.response.data));
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

export class GoogleDriveAdapter implements DriveAdapter {
  private accessToken: string | null = null;
  private folderId: string | null = null;
  private drive: drive_v3.Drive | null = null;
  private tokenRefreshCallback: (() => Promise<string | null>) | null = null;
  private rateLimitUntil = 0;

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
      const authClient = new OAuth2Client();
      authClient.setCredentials({ access_token: this.accessToken });
      this.drive = drive({ version: 'v3', auth: authClient });
    }
    return this.drive;
  }

  public async withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    let authRefreshAttempted = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.waitForRateLimitCooldown();
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const err = error as { code?: number; status?: number; response?: { status?: number } };
        const statusCode = err.code || err.status || err.response?.status;

        if ((statusCode === 401 || (statusCode === 403 && this.isCredentialError(error))) && !authRefreshAttempted) {
          authRefreshAttempted = true;
          if (this.tokenRefreshCallback) {
            const newToken = await this.tokenRefreshCallback();
            if (newToken) {
              this.setAccessToken(newToken);
              continue;
            }
          }
          throw error;
        }

        const rateLimited = this.isRateLimitError(error);
        if (rateLimited) {
          maxRetries = Math.max(maxRetries, 5);
        }

        if (rateLimited || statusCode === 429 || (statusCode && statusCode >= 500) || !statusCode) {
          if (attempt < maxRetries) {
            const baseMs = rateLimited || statusCode === 429 ? 2000 : 1000;
            const exponentialMs = Math.min(30000, baseMs * Math.pow(2, attempt));
            const retryAfterMs = this.retryAfterMs(error);
            const delay = Math.max(retryAfterMs, exponentialMs + Math.random() * baseMs);
            if (rateLimited || statusCode === 429) {
              this.rateLimitUntil = Math.max(this.rateLimitUntil, Date.now() + delay);
              await this.waitForRateLimitCooldown();
            } else {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            continue;
          }
        }

        throw error;
      }
    }
    throw lastError;
  }

  private isRateLimitError(error: unknown): boolean {
    const err = error as { code?: number; status?: number; response?: { status?: number } };
    const statusCode = err.code || err.status || err.response?.status;
    if (statusCode === 429) return true;
    if (statusCode !== 403) return false;

    const text = driveErrorText(error).replace(/[_\s-]+/g, '');
    if (text.includes('dailylimitexceeded')) return false;
    return text.includes('userratelimitexceeded') ||
      text.includes('ratelimitexceeded') ||
      text.includes('sharingratelimitexceeded') ||
      (text.includes('quotaexceeded') && (
        text.includes('perminute') ||
        text.includes('unitsperminute') ||
        text.includes('querycost')
      ));
  }

  private retryAfterMs(error: unknown): number {
    const err = error as {
      response?: {
        headers?: Record<string, string | number | string[] | undefined>;
      };
    };
    const raw = err.response?.headers?.['retry-after'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value == null) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    if (typeof value === 'string') {
      const at = Date.parse(value);
      if (Number.isFinite(at)) return Math.max(0, at - Date.now());
    }
    return 0;
  }

  private async waitForRateLimitCooldown(): Promise<void> {
    const remaining = this.rateLimitUntil - Date.now();
    if (remaining <= 0) return;
    await new Promise(resolve => setTimeout(resolve, remaining + Math.random() * 250));
  }

  private isCredentialError(err: unknown): boolean {
    const typed = err as { code?: number; status?: number; response?: { status?: number } };
    const statusCode = typed.code || typed.status || typed.response?.status;
    if (statusCode !== 403) return false;
    const combined = driveErrorText(err).replace(/[_\s]+/g, '');
    if (combined.includes('accessnotconfigur') || combined.includes('apisdisabled') ||
        combined.includes('quotaexceeded') || combined.includes('ratelimitexceeded') ||
        combined.includes('sharingratelimitexceeded') || combined.includes('cannotdownloadfile') ||
        combined.includes('permission') || combined.includes('denied') ||
        combined.includes('insufficientpermission') || combined.includes('forbidden')) {
      return false;
    }
    if (combined.includes('tokenexpired') || combined.includes('invalidgrant') ||
        combined.includes('unauthorized') || combined.includes('credential') ||
        combined.includes('logintrequired')) {
      return true;
    }
    return false;
  }

  private escapeQueryParam(param: string): string {
    return param.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  
  private extractQuartzoHash(file: Record<string, unknown> | drive_v3.Schema$File): string | null {
    if ((file as Record<string, unknown>).properties && ((file as Record<string, unknown>).properties as Record<string, string>).Quartzo_hash) {
      return ((file as Record<string, unknown>).properties as Record<string, string>).Quartzo_hash;
    }
    if ((file as Record<string, unknown>).appProperties && ((file as Record<string, unknown>).appProperties as Record<string, string>).Quartzo_hash) {
      return ((file as Record<string, unknown>).appProperties as Record<string, string>).Quartzo_hash;
    }
    return null;
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
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties)',
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
        quartzoHash: this.extractQuartzoHash(file)
      }));

      return {
        files,
        nextPageToken: response.data.nextPageToken || null
      };
    });
  }

  async listAllFiles(folderId: string): Promise<DriveFileMetadata[]> {
    const allFiles: DriveFileMetadata[] = [];
    await this.listAllFilesRecursive(folderId, allFiles, '');
    return allFiles;
  }

  private async listAllFilesRecursive(
    folderId: string,
    allFiles: DriveFileMetadata[],
    relativePrefix: string
  ): Promise<void> {
    let pageToken: string | undefined;
    do {
      const response = await this.withRetry(() => this.getDriveClient().files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties)',
        pageSize: 1000,
        pageToken
      }));

      const files: DriveFileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        modifiedTime: file.modifiedTime || new Date().toISOString(),
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        quartzoHash: this.extractQuartzoHash(file)
      }));

      for (const file of files) {
        const relativePath = normalizeVaultPath(
          relativePrefix ? `${relativePrefix}/${file.name}` : file.name
        );
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          await this.listAllFilesRecursive(file.id, allFiles, relativePath);
        } else {
          allFiles.push({ ...file, relativePath });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  }

  async listQuartzoVaultCandidates(): Promise<Array<{ id: string; name: string }>> {
    let folders: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined = undefined;
    const drive = this.getDriveClient();
    do {
      const response = await this.withRetry(() => drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false and properties has { key='Quartzo_vault' and value='true' }",
        fields: 'nextPageToken, files(id, name)',
        pageSize: 100,
        pageToken
      }));
      for (const f of (response.data.files || [])) {
        if (f.id && f.name) folders.push({ id: f.id, name: f.name });
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    return folders;
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
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties))',
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
          quartzoHash: this.extractQuartzoHash(change.file)
        } : undefined
      }));

      return {
        changes,
        newStartPageToken: response.data.newStartPageToken || pageToken,
        nextPageToken: response.data.nextPageToken || null
      };
    });
  }

    async resolveRemoteHash(metadata: DriveFileMetadata): Promise<string> {
    if (metadata.quartzoHash) return metadata.quartzoHash;
    const bytes = await this.downloadFile(metadata.id);
    return this.calculateQuartzoHash(bytes);
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

  async assertInsideSelectedVault(remoteFileId: string): Promise<void> {
    if (!this.folderId) throw new Error('No vault folderId set');
    let currentId = remoteFileId;
    const drive = this.getDriveClient();
    const checked = new Set<string>();
    while (currentId) {
      if (currentId === this.folderId) return;
      if (checked.has(currentId)) throw new Error('Cyclic structure detected');
      checked.add(currentId);
      const res = await this.withRetry(() => drive.files.get({ fileId: currentId, fields: 'parents' }));
      const parents = res.data.parents;
      if (!parents || parents.length === 0) {
        throw new Error(`Boundary guard failed: file ${remoteFileId} is not inside selected vault ${this.folderId}`);
      }
      currentId = parents[0];
    }
  }

  private errorStatus(error: unknown): number | undefined {
    const err = error as { code?: number; status?: number; response?: { status?: number } };
    return err.code || err.status || err.response?.status;
  }

  private isTransientCreateError(error: unknown): boolean {
    const status = this.errorStatus(error);
    return !status || status === 429 || status >= 500;
  }

  private async createBackoff(attempt: number): Promise<void> {
    const base = 250 * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, base + Math.random() * 250));
  }

  private async listNamedChildren(parentId: string, childName: string, foldersOnly: boolean): Promise<DriveFileMetadata[]> {
    const driveClient = this.getDriveClient();
    const results: DriveFileMetadata[] = [];
    let pageToken: string | undefined;
    const parent = this.escapeQueryParam(parentId);
    const name = this.escapeQueryParam(childName);
    const mimeClause = foldersOnly
      ? "mimeType = 'application/vnd.google-apps.folder'"
      : "mimeType != 'application/vnd.google-apps.folder'";
    do {
      const response = await this.withRetry(() => driveClient.files.list({
        q: `'${parent}' in parents and name = '${name}' and ${mimeClause} and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties)',
        pageSize: 100,
        pageToken
      }));
      for (const file of response.data.files || []) {
        results.push({
          id: file.id || '',
          name: file.name || '',
          mimeType: file.mimeType || '',
          modifiedTime: file.modifiedTime || new Date().toISOString(),
          md5Checksum: file.md5Checksum || undefined,
          parents: file.parents || undefined,
          quartzoHash: this.extractQuartzoHash(file)
        });
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    return results;
  }

  private async findFolderByName(parentId: string, folderName: string): Promise<string | null> {
    const files = await this.listNamedChildren(parentId, folderName, true);
    if (files.length > 1) {
      throw new Error(`Ambiguous Drive folder identity for ${folderName} under ${parentId}`);
    }
    return files.length === 1 ? files[0].id : null;
  }

  private async createFolderIdempotent(parentId: string, folderName: string): Promise<string> {
    const existing = await this.findFolderByName(parentId, folderName);
    if (existing) return existing;
    const driveClient = this.getDriveClient();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await driveClient.files.create({
          requestBody: {
            name: folderName,
            parents: [parentId],
            mimeType: 'application/vnd.google-apps.folder'
          },
          fields: 'id'
        });
        if (!created.data.id) throw new Error(`Drive create folder returned no ID for ${folderName}`);
        return created.data.id;
      } catch (error) {
        const after = await this.findFolderByName(parentId, folderName);
        if (after) return after;
        if (!this.isTransientCreateError(error) || attempt === 2) throw error;
        await this.createBackoff(attempt);
      }
    }
    throw new Error(`Unable to create folder ${folderName}`);
  }

  async ensureParentFolder(rootFolderId: string, filePath: string): Promise<string> {
    let currentParentId = rootFolderId;
    const pathParts = normalizeVaultPath(filePath).split('/');
    pathParts.pop();
    for (const folderName of pathParts) {
      if (!folderName) continue;
      currentParentId = await this.createFolderIdempotent(currentParentId, folderName);
    }
    return currentParentId;
  }

  private async createFileIdempotent(parentId: string, fileName: string, fullPath: string, content: Uint8Array, quartzoHash: string): Promise<DriveFileMetadata> {
    const findExpected = async (): Promise<DriveFileMetadata | null> => {
      const candidates = await this.listNamedChildren(parentId, fileName, false);
      if (candidates.length > 1) throw new Error(`Ambiguous remote identity for ${fullPath}`);
      if (candidates.length === 0) return null;
      const candidate = candidates[0];
      const actualHash = await this.resolveRemoteHash(candidate);
      if (actualHash !== quartzoHash) {
        throw new Error(`Remote path ${fullPath} already exists with divergent content`);
      }
      candidate.quartzoHash = actualHash;
      return candidate;
    };

    const preexisting = await findExpected();
    if (preexisting) return preexisting;

    const driveClient = this.getDriveClient();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await driveClient.files.create({
          requestBody: {
            name: fileName,
            parents: [parentId],
            properties: { Quartzo_hash: quartzoHash }
          },
          media: {
            mimeType: 'application/octet-stream',
            body: Buffer.from(content)
          },
          fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
        });
        const data = response.data;
        return {
          id: data.id || '',
          name: fullPath,
          mimeType: data.mimeType || '',
          modifiedTime: data.modifiedTime || new Date().toISOString(),
          md5Checksum: data.md5Checksum || undefined,
          parents: data.parents || undefined,
          quartzoHash
        };
      } catch (error) {
        const after = await findExpected();
        if (after) return after;
        if (!this.isTransientCreateError(error) || attempt === 2) throw error;
        await this.createBackoff(attempt);
      }
    }
    throw new Error(`Unable to create ${fullPath}`);
  }

  async uploadFile(params: UploadFileParams): Promise<DriveFileMetadata> {
    const normalized = normalizeVaultPath(params.name);
    const pathParts = normalized.split('/');
    const fileName = pathParts.pop() || normalized;
    const parentId = await this.ensureParentFolder(params.parentId || params.folderId, normalized);
    return this.createFileIdempotent(parentId, fileName, normalized, params.content, params.quartzoHash);
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string): Promise<DriveFileMetadata> {
    await this.assertInsideSelectedVault(fileId);
    return this.withRetry(async () => {
      const driveClient = this.getDriveClient();
      const response = await driveClient.files.update({
        fileId,
        requestBody: { properties: { Quartzo_hash: quartzoHash } },
        media: { mimeType: 'application/octet-stream', body: Buffer.from(content) },
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      });
      const data = response.data;
      return {
        id: data.id || fileId,
        name: data.name || '',
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash
      };
    });
  }

  async trashFile(fileId: string): Promise<void> {
    try {
      await this.assertInsideSelectedVault(fileId);
    } catch (error) {
      if (this.errorStatus(error) === 404) return;
      throw error;
    }

    try {
      await this.withRetry(async () => {
        const driveClient = this.getDriveClient();
        await driveClient.files.update({
          fileId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
      });
    } catch (error) {
      if (this.errorStatus(error) === 404) return;
      throw error;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.assertInsideSelectedVault(fileId);
    } catch (error) {
      if (this.errorStatus(error) === 404) return; // retry after a committed delete
      throw error;
    }
    try {
      await this.withRetry(async () => {
        const driveClient = this.getDriveClient();
        await driveClient.files.delete({ fileId });
      });
    } catch (error) {
      if (this.errorStatus(error) === 404) return;
      throw error;
    }
  }

  async renameFile(fileId: string, newName: string, newParentId?: string): Promise<DriveFileMetadata> {
    await this.assertInsideSelectedVault(fileId);
    if (newParentId) await this.assertInsideSelectedVault(newParentId);

    return this.withRetry(async () => {
      const driveClient = this.getDriveClient();
      const currentResponse = await driveClient.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      });
      const current = currentResponse.data;
      const currentParents = current.parents || [];

      if (newParentId) {
        const parent = this.escapeQueryParam(newParentId);
        const name = this.escapeQueryParam(newName);
        let pageToken: string | undefined;
        const collisions: string[] = [];
        do {
          const response = await driveClient.files.list({
            q: `'${parent}' in parents and name = '${name}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id)',
            pageSize: 100,
            pageToken
          });
          for (const candidate of response.data.files || []) {
            if (candidate.id && candidate.id !== fileId) collisions.push(candidate.id);
          }
          pageToken = response.data.nextPageToken || undefined;
        } while (pageToken);
        if (collisions.length > 0) {
          throw new Error(`Ambiguous remote rename target: ${newName} already exists under ${newParentId}`);
        }
      }

      const alreadyAtTarget = current.name === newName &&
        (!newParentId || currentParents.includes(newParentId));
      if (alreadyAtTarget) {
        return {
          id: current.id || fileId,
          name: current.name || newName,
          mimeType: current.mimeType || '',
          modifiedTime: current.modifiedTime || new Date().toISOString(),
          md5Checksum: current.md5Checksum || undefined,
          parents: current.parents || undefined,
          quartzoHash: this.extractQuartzoHash(current)
        };
      }

      const movingParent = !!newParentId && !currentParents.includes(newParentId);
      const response = await driveClient.files.update({
        fileId,
        requestBody: { name: newName },
        addParents: movingParent ? newParentId : undefined,
        removeParents: movingParent && currentParents.length > 0 ? currentParents.join(',') : undefined,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      });
      const data = response.data;
      return {
        id: data.id || fileId,
        name: data.name || newName,
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash: this.extractQuartzoHash(data)
      };
    });
  }

  async resolveExactPath(fileId: string): Promise<string> {
    if (!this.folderId) throw new Error('No vault folderId set');
    let currentId = fileId;
    const drive = this.getDriveClient();
    const parts: string[] = [];
    const checked = new Set<string>();
    while (currentId && currentId !== this.folderId) {
      if (checked.has(currentId)) throw new Error('Cyclic structure detected in path resolution');
      checked.add(currentId);
      const res = await this.withRetry(() => drive.files.get({ fileId: currentId, fields: 'name, parents' }));
      parts.unshift(res.data.name || '');
      const parents = res.data.parents;
      if (!parents || parents.length === 0) {
        throw new Error(`Boundary guard failed: file escapes vault`);
      }
      currentId = parents[0];
    }
    return parts.join('/');
  }

  async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      });

      const data = response.data;
      return {
        id: data.id || '',
        name: data.name || '',
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash: this.extractQuartzoHash(data)
      };
    });
  }
}
