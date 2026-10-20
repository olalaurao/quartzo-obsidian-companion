import { SyncEngine } from '../../../core/sync';
import {
  DriveAdapter,
  DriveFileMetadata,
  DriveChange,
  UploadFileParams,
  ReadingFileRepairRequest,
  TemporaryDriveQuotaError,
  DriveRequestTimeoutError,
} from '../../../sync/coordinator/types';
import { drive_v3, drive_v2, drive } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';
import { normalizeVaultPath } from '../../../sync/coordinator/path-utils';
import { VaultSyncFilePolicy } from '../../../sync/coordinator/file-policy';
import * as crypto from 'crypto';

const DRIVE_REQUEST_TIMEOUT_MS = 60_000;
const DRIVE_MEDIA_REQUEST_TIMEOUT_MS = 120_000;

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
  private conditionalMutationVerified = false;
  private readonly verifiedVersions = new Map<string, drive_v2.Schema$File>();
  private captureMutationTarget(): () => void {
    this.getDriveClient();
    const token = this.accessToken, root = this.folderId, client = this.drive;
    return () => {
      if (token !== this.accessToken || root !== this.folderId || client !== this.drive) {
        throw new Error('Drive target changed during immutable identity verification');
      }
    };
  }

  private async readingIdentity(fileId: string, version: drive_v2.Schema$File, check: () => void): Promise<string | null> {
    check();
    if (version.id !== fileId || !version.etag || !version.title || version.labels?.trashed) {
      throw new Error('Remote mutation identity is unavailable');
    }
    if (version.mimeType === 'application/vnd.google-apps.folder') {
      throw new Error('Generic folder mutation is unavailable');
    }
    if (!/^[a-f0-9]{64}\.jsonl$/.test(version.title)) return null;
    if (!this.folderId) throw new Error('Select a vault before verifying reading identity');
    const root = this.folderId, client = this.getDriveClient();
    const segments = [version.title], seen = new Set([fileId]);
    let parents = version.parents?.map(parent => parent.id);
    for (let depth = 0; depth < 6; depth++) {
      check();
      if (!parents || parents.length !== 1 || !parents[0]) throw new Error('Remote reading ancestry is unavailable');
      const parent = parents[0];
      if (parent === root) break;
      if (seen.has(parent)) throw new Error('Remote reading ancestry is cyclic');
      seen.add(parent);
      const response = await this.withRetry(() => client.files.get({fileId: parent, supportsAllDrives: true,
        fields: 'id,name,mimeType,parents,trashed'}, {timeout: DRIVE_REQUEST_TIMEOUT_MS}));
      check();
      const folder = response.data;
      if (folder.id !== parent || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed ||
          !folder.name || folder.name.length > 256 || folder.name.includes('/') || folder.name.includes('\\')) {
        throw new Error('Remote reading ancestry is unavailable');
      }
      segments.unshift(folder.name);
      parents = folder.parents || undefined;
    }
    check();
    const actual = segments.join('/');
    if (SyncEngine.immutableReadingHash(actual) === null) return null;
    if (!parents || parents.length !== 1 || parents[0] !== root) throw new Error('Remote reading identity is outside the selected vault');
    return actual;
  }

  private async requireMutableIdentity(fileId: string, version: drive_v2.Schema$File, check: () => void): Promise<void> {
    if (await this.readingIdentity(fileId, version, check)) {
      throw new Error('Generic remote mutation is unavailable for immutable reading history');
    }
    check();
  }

  private getConditionalClient(): drive_v2.Drive {
    if (!this.accessToken) throw new Error('No access token available');
    const auth = new OAuth2Client(); auth.setCredentials({ access_token: this.accessToken });
    return drive({ version: 'v2', auth });
  }
  async verifyConditionalMutationSupport(): Promise<void> {
    if (this.conditionalMutationVerified) return;
    if (!this.folderId) throw new Error('Select a vault before checking safe Drive writes');
    const parentId = await this.ensureParentFolder(this.folderId, '_diagnostics/preconditions/probe.bin');
    const created = await this.getDriveClient().files.create({
      requestBody: { name: `conditional-probe-${crypto.randomUUID()}.bin`, parents: [parentId] },
      media: { mimeType: 'application/octet-stream', body: Buffer.from('before') }, fields: 'id',
    }, { timeout: DRIVE_MEDIA_REQUEST_TIMEOUT_MS });
    const fileId = created.data.id;
    if (!fileId) throw new Error('Drive safe-write probe did not return an identity');
    try {
      const before = await this.readVersion(fileId);
      await this.getConditionalClient().files.update({ fileId, requestBody: { title: 'verified-precondition-probe.bin' }, fields: 'id' },
        { headers: { 'If-Match': before.etag! }, timeout: DRIVE_REQUEST_TIMEOUT_MS });
      let rejected = false;
      try {
        await this.getConditionalClient().files.update({ fileId, requestBody: { title: 'stale-precondition-must-not-write.bin' }, fields: 'id' },
          { headers: { 'If-Match': before.etag! }, timeout: DRIVE_REQUEST_TIMEOUT_MS });
      } catch (error) { if (this.errorStatus(error) !== 412) throw error; rejected = true; }
      if (!rejected) throw new Error('Drive did not reject a stale If-Match precondition. Content sync is blocked.');
      const current = await this.readVersion(fileId);
      if (current.title !== 'verified-precondition-probe.bin') throw new Error('Drive changed the probe despite the stale precondition');
      this.conditionalMutationVerified = true;
    } finally {
      const current = await this.readVersion(fileId);
      const trashed = await this.getConditionalClient().files.update({ fileId, requestBody: { labels: { trashed: true } }, fields: 'labels(trashed)' },
        { headers: { 'If-Match': current.etag! }, timeout: DRIVE_REQUEST_TIMEOUT_MS });
      if (!trashed.data.labels?.trashed) { this.conditionalMutationVerified = false; throw new Error('Drive safe-write probe cleanup was not confirmed'); }
    }
  }

  private async readVersion(fileId: string): Promise<drive_v2.Schema$File> {
    const response = await this.withRetry(() => this.getConditionalClient().files.get({ fileId, supportsAllDrives: true,
      fields: 'id,etag,title,mimeType,fileSize,modifiedDate,md5Checksum,parents,properties,labels,capabilities' }, { timeout: DRIVE_REQUEST_TIMEOUT_MS }));
    if (!response.data.etag) throw new Error('Drive did not provide a remote mutation precondition');
    return response.data;
  }
  private requiredVersion(fileId: string): drive_v2.Schema$File {
    const version = this.verifiedVersions.get(fileId);
    if (!version?.etag) throw new Error('Remote version must be verified before mutation: ' + fileId);
    this.verifiedVersions.delete(fileId);
    return version;
  }
  private mapConditionalFile(value: drive_v2.Schema$File): DriveFileMetadata {
    return { id: value.id || '', name: value.title || '', mimeType: value.mimeType || '',
      modifiedTime: value.modifiedDate || '', md5Checksum: value.md5Checksum,
      parents: (value.parents || []).map(parent => parent.id || ''),
      quartzoHash: value.properties?.find(property => property.key === 'Quartzo_hash' && property.visibility === 'PUBLIC')?.value,
      trashed: value.labels?.trashed, canTrash: value.capabilities?.canTrash };
  }


  constructor(accessToken?: string) {
    this.accessToken = accessToken || null;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
    this.drive = null;
    this.verifiedVersions.clear();
    this.conditionalMutationVerified = false;
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
        const timedOut = this.isTimeoutError(error);
        const err = error as { code?: number | string; status?: number; response?: { status?: number } };
        const statusCode = typeof err.code === 'number' ? err.code : (err.status || err.response?.status);

        if (timedOut) {
          if (attempt < Math.min(maxRetries, 1)) {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
          throw new DriveRequestTimeoutError(
            'Google Drive request timed out. The current operation was stopped instead of remaining stuck.'
          );
        }

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

        if (rateLimited || statusCode === 429) {
          throw new TemporaryDriveQuotaError(
            'Google Drive temporary per-minute quota remained exhausted after retries. Wait a minute and retry pairing; completed file operations are safe to rescan.'
          );
        }
        throw error;
      }
    }
    throw lastError;
  }

  private isTimeoutError(error: unknown): boolean {
    const err = error as { code?: number | string; message?: string };
    const code = String(err.code ?? '').toUpperCase();
    const message = (err.message ?? '').toLowerCase();
    return code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      message.includes('timed out') ||
      message.includes('timeout');
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
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties, trashed, capabilities(canTrash))',
        pageSize: 100,
        pageToken: pageToken
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });

      const files: DriveFileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        modifiedTime: file.modifiedTime || new Date().toISOString(),
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        quartzoHash: this.extractQuartzoHash(file),
        trashed: file.trashed ?? false,
        canTrash: file.capabilities?.canTrash ?? null
      }));

      return {
        files,
        nextPageToken: response.data.nextPageToken || null
      };
    });
  }

  async listAllFiles(folderId: string, onProgress?: (completed: number) => void | Promise<void>): Promise<DriveFileMetadata[]> {
    const allFiles: DriveFileMetadata[] = [];
    let visited = 0;
    const report = onProgress ? async () => {
      await onProgress(++visited);
      if (visited % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    } : undefined;
    await this.listAllFilesRecursive(folderId, allFiles, '', report);
    return allFiles;
  }

  private async listAllFilesRecursive(
    folderId: string,
    allFiles: DriveFileMetadata[],
    relativePrefix: string,
    onProgress?: (completed: number) => void | Promise<void>
  ): Promise<void> {
    let pageToken: string | undefined;
    do {
      const response = await this.withRetry(() => this.getDriveClient().files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties, trashed, capabilities(canTrash))',
        pageSize: 1000,
        pageToken
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS }));

      const files: DriveFileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        modifiedTime: file.modifiedTime || new Date().toISOString(),
        md5Checksum: file.md5Checksum || undefined,
        parents: file.parents || undefined,
        quartzoHash: this.extractQuartzoHash(file),
        trashed: file.trashed ?? false,
        canTrash: file.capabilities?.canTrash ?? null
      }));

      for (const file of files) {
        await onProgress?.(0);
        const relativePath = normalizeVaultPath(
          relativePrefix ? `${relativePrefix}/${file.name}` : file.name
        );
        if (file.trashed === true) continue;
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          if (!VaultSyncFilePolicy.shouldSyncDirectory(relativePath)) continue;
          await this.listAllFilesRecursive(file.id, allFiles, relativePath, onProgress);
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
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS }));
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
      const response = await drive.changes.getStartPageToken({}, { timeout: DRIVE_REQUEST_TIMEOUT_MS });
      return response.data.startPageToken || '';
    });
  }

  async listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string; nextPageToken: string | null }> {
    return this.withRetry(async () => {
      const drive = this.getDriveClient();
      const response = await drive.changes.list({
        pageToken,
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties, trashed, capabilities(canTrash)))',
        pageSize: 1000
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });

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
          quartzoHash: this.extractQuartzoHash(change.file),
          trashed: change.file.trashed ?? false,
          canTrash: change.file.capabilities?.canTrash ?? null
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
    const path = normalizeVaultPath(metadata.relativePath || metadata.name);
    const bytes = await this.downloadFile(metadata.id, SyncEngine.immutableReadingHash(path) ? path : undefined);
    return this.calculateQuartzoHash(bytes);
  }

  async downloadFile(fileId: string, expectedReadingPath?: string): Promise<Uint8Array> {
    const snapshot = await this.downloadSnapshot(fileId, expectedReadingPath);
    snapshot.check();
    this.verifiedVersions.set(fileId, snapshot.version);
    return snapshot.bytes;
  }

  private async downloadSnapshot(fileId: string, expectedReadingPath?: string): Promise<{
    bytes: Uint8Array; version: drive_v2.Schema$File; check: () => void;
  }> {
    const check = this.captureMutationTarget();
    if (expectedReadingPath && SyncEngine.immutableReadingHash(expectedReadingPath) === null) {
      throw new Error('Expected Reading path is not canonical');
    }
    const before = await this.readVersion(fileId); check();
    if (expectedReadingPath && await this.readingIdentity(fileId, before, check) !== expectedReadingPath) {
      throw new Error('Reading download identity changed');
    }
    const expectedSize = expectedReadingPath ? this.readingSize(before) : null;
    const bytes = await this.withRetry(async () => {
      check();
      const drive = this.getDriveClient();
      const response = await drive.files.get({
        fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer', timeout: DRIVE_MEDIA_REQUEST_TIMEOUT_MS,
        ...(expectedSize !== null ? {maxContentLength: SyncEngine.readingShardMaxBytes} : {}) });
      return new Uint8Array(response.data as ArrayBuffer);
    });
    check();
    const after = await this.readVersion(fileId); check();
    if (before.etag !== after.etag) throw new Error('Remote content changed during download: ' + fileId);
    if (expectedReadingPath && await this.readingIdentity(fileId, after, check) !== expectedReadingPath) {
      throw new Error('Reading download identity changed');
    }
    if (expectedSize !== null && (this.readingSize(after) !== expectedSize || bytes.byteLength !== expectedSize)) {
      throw new Error('Reading media length changed during download');
    }
    check();
    return { bytes, version: after, check };
  }

  private readingSize(version: drive_v2.Schema$File): number {
    const size = version.fileSize;
    if (typeof size !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(size) ||
        size.length !== size.trim().length || !Number.isSafeInteger(Number(size)) ||
        Number(size) > SyncEngine.readingShardMaxBytes) {
      throw new Error('Reading media exceeds the supported byte bound or has no verified size');
    }
    return Number(size);
  }

  private async requireUniqueReadingFile(fileId: string, version: drive_v2.Schema$File, check: () => void): Promise<void> {
    const parent = version.parents?.[0]?.id;
    if (!parent || !version.title) throw new Error('Reading repair identity is unavailable');
    const client = this.getDriveClient();
    check();
    const result = await this.withRetry(() => { check(); return client.files.list({
      q: `'${this.escapeQueryParam(parent)}' in parents and name = '${this.escapeQueryParam(version.title!)}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken,incompleteSearch,files(id)', pageSize: 2,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    }, {timeout: DRIVE_REQUEST_TIMEOUT_MS}); });
    check();
    if (result.data.nextPageToken || result.data.incompleteSearch ||
        result.data.files?.length !== 1 || result.data.files[0].id !== fileId) {
      throw new Error('Reading repair has ambiguous or incomplete remote identity');
    }
  }

  async repairReadingFile(request: ReadingFileRepairRequest): Promise<DriveFileMetadata> {
    const {fileId, relativePath, expectedRemoteHash} = request;
    const bytes = new Uint8Array(request.content);
    const originalHash = SyncEngine.immutableReadingHash(relativePath);
    if (!fileId || !originalHash || bytes.byteLength > SyncEngine.readingShardMaxBytes ||
        this.calculateQuartzoHash(bytes) !== originalHash || typeof expectedRemoteHash !== 'string' ||
        expectedRemoteHash.length !== 64 || !/^[a-f0-9]{64}$/.test(expectedRemoteHash)) {
      throw new Error('Reading repair requires original filename bytes and a reviewed remote hash');
    }
    const check = this.captureMutationTarget(), client = this.getConditionalClient();
    const current = await this.downloadSnapshot(fileId, relativePath);
    check(); current.check();
    await this.requireUniqueReadingFile(fileId, current.version, check);
    if (await this.readingIdentity(fileId, current.version, check) !== relativePath) {
      throw new Error('Reading repair identity changed before mutation');
    }
    check();
    const currentHash = this.calculateQuartzoHash(current.bytes);
    if (currentHash === originalHash) return {...this.mapConditionalFile(current.version), quartzoHash: originalHash};
    if (currentHash !== expectedRemoteHash) throw new Error('Reading repair remote bytes changed; rescan before repair');
    // This tuple came from this operation's own verified read. A concurrent
    // cache update cannot substitute another ETag into the conditional write.
    await this.withRetry(() => { check(); return client.files.update({
      fileId, supportsAllDrives: true,
      requestBody: { properties: [...(current.version.properties || []).filter(property => property.key !== 'Quartzo_hash'),
        {key: 'Quartzo_hash', value: originalHash, visibility: 'PUBLIC'}] },
      media: {mimeType: 'application/octet-stream', body: Buffer.from(bytes)}, fields: 'id',
    }, {headers: {'If-Match': current.version.etag!}, timeout: DRIVE_MEDIA_REQUEST_TIMEOUT_MS}); });
    check();
    const final = await this.downloadSnapshot(fileId, relativePath);
    check(); final.check();
    await this.requireUniqueReadingFile(fileId, final.version, check);
    if (await this.readingIdentity(fileId, final.version, check) !== relativePath || this.calculateQuartzoHash(final.bytes) !== originalHash) {
      throw new Error('Reading repair post-write verification failed; preserve conflict evidence');
    }
    check();
    return {...this.mapConditionalFile(final.version), quartzoHash: originalHash};
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
      const res = await this.withRetry(() => drive.files.get(
        { fileId: currentId, fields: 'parents' },
        { timeout: DRIVE_REQUEST_TIMEOUT_MS }
      ));
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
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties, trashed, capabilities(canTrash))',
        pageSize: 100,
        pageToken
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS }));
      for (const file of response.data.files || []) {
        results.push({
          id: file.id || '',
          name: file.name || '',
          mimeType: file.mimeType || '',
          modifiedTime: file.modifiedTime || new Date().toISOString(),
          md5Checksum: file.md5Checksum || undefined,
          parents: file.parents || undefined,
          quartzoHash: this.extractQuartzoHash(file),
          trashed: file.trashed ?? false,
        canTrash: file.capabilities?.canTrash ?? null
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

  private async createFolderIdempotent(parentId: string, folderName: string, check: () => void = () => {}): Promise<string> {
    check();
    const existing = await this.findFolderByName(parentId, folderName);
    check();
    if (existing) return existing;
    const driveClient = this.getDriveClient();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        check();
        const created = await driveClient.files.create({
          requestBody: {
            name: folderName,
            parents: [parentId],
            mimeType: 'application/vnd.google-apps.folder'
          },
          fields: 'id'
        }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });
        check();
        if (!created.data.id) throw new Error(`Drive create folder returned no ID for ${folderName}`);
        return created.data.id;
      } catch (error) {
        check();
        const after = await this.findFolderByName(parentId, folderName);
        check();
        if (after) return after;
        if (this.isTimeoutError(error)) {
          if (attempt < 1) {
            await this.createBackoff(attempt);
            continue;
          }
          throw new DriveRequestTimeoutError(
            `Google Drive folder creation timed out for ${folderName}. The operation was stopped safely.`
          );
        }
        if (!this.isTransientCreateError(error) || attempt === 2) throw error;
        await this.createBackoff(attempt);
      }
    }
    throw new Error(`Unable to create folder ${folderName}`);
  }

  async ensureParentFolder(rootFolderId: string, filePath: string, check: () => void = () => {}): Promise<string> {
    check();
    let currentParentId = rootFolderId;
    const pathParts = normalizeVaultPath(filePath).split('/');
    pathParts.pop();
    for (const folderName of pathParts) {
      if (!folderName) continue;
      currentParentId = await this.createFolderIdempotent(currentParentId, folderName, check);
      check();
    }
    return currentParentId;
  }

  private async createFileIdempotent(parentId: string, fileName: string, fullPath: string, content: Uint8Array, quartzoHash: string, check: () => void = () => {}): Promise<DriveFileMetadata> {
    check();
    const findExpected = async (): Promise<DriveFileMetadata | null> => {
      check();
      const candidates = await this.listNamedChildren(parentId, fileName, false);
      check();
      if (candidates.length > 1) throw new Error(`Ambiguous remote identity for ${fullPath}`);
      if (candidates.length === 0) return null;
      const candidate = candidates[0];
      const actualHash = await this.resolveRemoteHash({...candidate, relativePath: fullPath});
      check();
      const version = this.verifiedVersions.get(candidate.id);
      if (!version) throw new Error('Remote upload identity was not verified');
      const actual = await this.readingIdentity(candidate.id, version, check);
      if ((actual && actual !== fullPath) || (SyncEngine.immutableReadingHash(fullPath) && actual !== fullPath)) {
        throw new Error('Reading upload remote identity changed');
      }
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
        check();
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
          fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties, trashed, capabilities(canTrash)'
        }, { timeout: DRIVE_MEDIA_REQUEST_TIMEOUT_MS });
        check();
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
        check();
        const after = await findExpected();
        check();
        if (after) return after;
        if (this.isTimeoutError(error)) {
          if (attempt < 1) {
            await this.createBackoff(attempt);
            continue;
          }
          throw new DriveRequestTimeoutError(
            `Google Drive file creation timed out for ${fullPath}. The operation was stopped safely.`
          );
        }
        if (!this.isTransientCreateError(error) || attempt === 2) throw error;
        await this.createBackoff(attempt);
      }
    }
    throw new Error(`Unable to create ${fullPath}`);
  }

  async createVaultFolder(name: string): Promise<{ id: string; name: string }> {
    const response = await this.getDriveClient().files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', properties: { Quartzo_vault: 'true' } }, fields: 'id,name',
    }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });
    if (!response.data.id) throw new Error('Drive did not return a vault folder ID');
    return { id: response.data.id, name: response.data.name || name };
  }

  async uploadFile(params: UploadFileParams): Promise<DriveFileMetadata> {
    const bytes = new Uint8Array(params.content);
    const normalized = normalizeVaultPath(params.name);
    const expected = SyncEngine.immutableReadingHash(normalized);
    const actualHash = this.calculateQuartzoHash(bytes);
    if (expected && (bytes.byteLength > SyncEngine.readingShardMaxBytes || expected !== actualHash || params.quartzoHash !== actualHash || params.folderId !== this.folderId)) {
      throw new Error('Immutable reading upload requires exact filename bytes and selected vault');
    }
    const check = this.captureMutationTarget();
    const pathParts = normalized.split('/');
    const fileName = pathParts.pop() || normalized;
    const parentId = await this.ensureParentFolder(params.parentId || params.folderId, normalized, check);
    check();
    const destination = await this.readingIdentity('pending-publication', { id: 'pending-publication', etag: 'unsubmitted',
      title: fileName, mimeType: 'application/octet-stream', parents: [{id: parentId}] }, check);
    if ((expected && destination !== normalized) || (destination &&
        (destination !== normalized || SyncEngine.immutableReadingHash(destination) !== actualHash || params.quartzoHash !== actualHash))) {
      throw new Error('Reading upload destination identity changed');
    }
    return this.createFileIdempotent(parentId, fileName, normalized, bytes, params.quartzoHash, check);
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string): Promise<DriveFileMetadata> {
    const bytes = new Uint8Array(content);
    const check = this.captureMutationTarget(), client = this.getConditionalClient();
    const version = this.requiredVersion(fileId);
    await this.assertInsideSelectedVault(fileId); check();
    await this.requireMutableIdentity(fileId, version, check);
    const response = await this.withRetry(() => { check(); return client.files.update({
      fileId, supportsAllDrives: true,
      requestBody: { properties: [...(version.properties || []).filter(property => property.key !== 'Quartzo_hash'),
        { key: 'Quartzo_hash', value: quartzoHash, visibility: 'PUBLIC' }] },
      media: { mimeType: 'application/octet-stream', body: Buffer.from(bytes) },
      fields: 'id,title,mimeType,modifiedDate,md5Checksum,parents,properties,labels,capabilities',
    }, { headers: { 'If-Match': version.etag! }, timeout: DRIVE_MEDIA_REQUEST_TIMEOUT_MS }); });
    check();
    return this.mapConditionalFile(response.data);
  }

  async trashFile(fileId: string): Promise<void> {
    const check = this.captureMutationTarget(), client = this.getConditionalClient();
    const version = this.requiredVersion(fileId);
    await this.assertInsideSelectedVault(fileId); check();
    await this.requireMutableIdentity(fileId, version, check);
    const response = await this.withRetry(() => { check(); return client.files.update({
      fileId, requestBody: { labels: { trashed: true } }, supportsAllDrives: true, fields: 'id,labels(trashed)',
    }, { headers: { 'If-Match': version.etag! }, timeout: DRIVE_REQUEST_TIMEOUT_MS }); });
    check();
    if (response.data.labels?.trashed !== true) throw new Error('Drive did not confirm trashed=true');
  }

  async deleteFile(fileId: string): Promise<void> {
    const check = this.captureMutationTarget(), client = this.getConditionalClient();
    try {
      await this.assertInsideSelectedVault(fileId); check();
      const version = await this.readVersion(fileId); check();
      await this.requireMutableIdentity(fileId, version, check);
      await this.withRetry(() => { check(); return client.files.delete({ fileId, supportsAllDrives: true },
        { headers: { 'If-Match': version.etag! }, timeout: DRIVE_REQUEST_TIMEOUT_MS }); });
      check();
    } catch (error) {
      check();
      if (this.errorStatus(error) !== 404) throw error;
    }
  }

  async renameFile(fileId: string, newName: string, newParentId?: string): Promise<DriveFileMetadata> {
    if (!newName || newName.includes('/') || newName.includes('\\')) throw new Error('Rename requires a leaf name');
    const check = this.captureMutationTarget();
    const conditional = this.getConditionalClient();
    const verified = this.requiredVersion(fileId);
    await this.assertInsideSelectedVault(fileId); check();
    await this.requireMutableIdentity(fileId, verified, check);
    if (newParentId) { await this.assertInsideSelectedVault(newParentId); check(); }
    await this.requireMutableIdentity(fileId, { ...verified, title: newName,
      parents: newParentId ? [{id: newParentId}] : verified.parents }, check);
    return this.withRetry(async () => {
      check();
      const driveClient = this.getDriveClient();
      const currentResponse = await driveClient.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties'
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });
      check();
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
          }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });
          check();
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
      check();
      const response = await conditional.files.update({
        fileId, requestBody: { title: newName }, supportsAllDrives: true,
        addParents: movingParent ? newParentId : undefined,
        removeParents: movingParent && currentParents.length > 0 ? currentParents.join(',') : undefined,
        fields: 'id,title,mimeType,modifiedDate,md5Checksum,parents,properties,labels,capabilities',
      }, { headers: { 'If-Match': verified.etag! }, timeout: DRIVE_REQUEST_TIMEOUT_MS });
      check();
      return this.mapConditionalFile(response.data);

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
      const res = await this.withRetry(() => drive.files.get(
        { fileId: currentId, fields: 'name, parents' },
        { timeout: DRIVE_REQUEST_TIMEOUT_MS }
      ));
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
    const check = this.captureMutationTarget();
    const before = await this.readVersion(fileId);
    check();
    const metadata = await this.withRetry(async () => {
      check();
      const drive = this.getDriveClient();
      const response = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, parents, appProperties, properties, trashed, capabilities(canTrash)'
      }, { timeout: DRIVE_REQUEST_TIMEOUT_MS });

      const data = response.data;
      return {
        id: data.id || '',
        name: data.name || '',
        mimeType: data.mimeType || '',
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        md5Checksum: data.md5Checksum || undefined,
        parents: data.parents || undefined,
        quartzoHash: this.extractQuartzoHash(data),
        trashed: data.trashed ?? false,
        canTrash: data.capabilities?.canTrash ?? null
      };
    });
    check();
    const after = await this.readVersion(fileId); check();
    if (before.etag !== after.etag) throw new Error('Remote metadata changed during verification: ' + fileId);
    if (!this.verifiedVersions.has(fileId)) this.verifiedVersions.set(fileId, after);
    return metadata;
  }
}
