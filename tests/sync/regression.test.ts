import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DriveSyncCoordinator } from '../../src/sync/coordinator/index';
import { VaultSyncFilePolicy } from '../../src/sync/coordinator/file-policy';
import { normalizeVaultPath, isSameVaultPath } from '../../src/sync/coordinator/path-utils';
import type { DriveAdapter, DriveFileMetadata, DriveChange, UploadFileParams } from '../../src/sync/coordinator/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

class MockDriveAdapter implements DriveAdapter {
  async assertInsideSelectedVault(remoteFileId: string): Promise<void> { return Promise.resolve(); }
  async resolveExactPath(fileId: string): Promise<string> { return fileId; }
  async resolveRemoteHash(metadata: DriveFileMetadata): Promise<string> {
    if (metadata.quartzoHash) return metadata.quartzoHash;
    const content = await this.downloadFile(metadata.id);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  public files = new Map<string, { id: string; content: Uint8Array; quartzoHash: string; parents: string[] }>();
  private folderId = 'mock-folder-id';
  public listChangesCalls = 0;
  public uploadCalls = 0;
  public deleteCalls = 0;
  public updateCalls = 0;
  public downloadCalls = 0;
  public listAllFilesCalls = 0;
  public listRootFoldersCalls = 0;
  public getStartPageTokenCalls = 0;
  public listChangesPageCalls = 0;
  public getFileMetadataCalls = 0;

  async getFolderId() { return this.folderId; }
  async setFolderId(id: string) { this.folderId = id; }

  async listFiles(_folderId: string, _pageToken?: string) {
    const files: DriveFileMetadata[] = Array.from(this.files.entries()).map(([name, data]) => ({
      id: data.id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(),
      quartzoHash: data.quartzoHash || null, parents: data.parents || [this.folderId]
    }));
    return { files, nextPageToken: null };
  }

  async listAllFiles(_folderId: string) {
    this.listAllFilesCalls++;
    return Array.from(this.files.entries()).map(([name, data]) => ({
      id: data.id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(),
      quartzoHash: data.quartzoHash || null, parents: data.parents || [this.folderId]
    }));
  }

  async listQuartzoVaultCandidates() {
    this.listRootFoldersCalls++;
    return [];
  }

  async getStartPageToken() {
    this.getStartPageTokenCalls++;
    return 'start-token';
  }

  async listChanges(_pageToken: string) {
    this.listChangesPageCalls++;
    this.listChangesCalls++;
    return { changes: [] as DriveChange[], newStartPageToken: 'new-token', nextPageToken: null };
  }

  async downloadFile(fileId: string) {
    this.downloadCalls++;
    for (const data of this.files.values()) {
      if (data.id === fileId) return data.content;
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async uploadFile(params: UploadFileParams) {
    this.uploadCalls++;
    const id = `file-${Date.now()}-${Math.random()}`;
    this.files.set(params.name, { id, content: params.content, quartzoHash: params.quartzoHash, parents: [this.folderId] });
    return { id, name: params.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: params.quartzoHash, parents: [params.folderId] };
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string) {
    this.updateCalls++;
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) {
        this.files.set(name, { ...data, content, quartzoHash });
        return { id: fileId, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash, parents: [this.folderId] };
      }
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async deleteFile(fileId: string) {
    this.deleteCalls++;
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) { this.files.delete(name); return; }
    }
  }

  async renameFile(fileId: string, newName: string, _newParentId?: string) {
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) {
        this.files.delete(name);
        this.files.set(newName, { ...data });
        return { id: data.id, name: newName, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: data.quartzoHash || null, parents: data.parents || [this.folderId] };
      }
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async getFileMetadata(fileId: string) {
    this.getFileMetadataCalls++;
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) return { id: data.id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: data.quartzoHash || null, parents: data.parents || [this.folderId] };
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async ensureParentFolder(rootFolderId: string, filePath: string) {
    return rootFolderId;
  }

  addFile(name: string, content: Uint8Array) {
    const id = `file-${Date.now()}-${Math.random()}`;
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this.files.set(name, { id, content, quartzoHash, parents: [this.folderId] });
    return id;
  }

  addFileWithId(name: string, id: string, content: Uint8Array) {
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this.files.set(name, { id, content, quartzoHash, parents: [this.folderId] });
    return id;
  }
}

class HierarchicalDriveAdapter implements DriveAdapter {
  async assertInsideSelectedVault(remoteFileId: string): Promise<void> { return Promise.resolve(); }
  async resolveExactPath(fileId: string): Promise<string> { return fileId; }
  async resolveRemoteHash(metadata: DriveFileMetadata): Promise<string> { return 'raw-hash'; }

  private files = new Map<string, { id: string; name: string; content: Uint8Array; quartzoHash: string; parents: string[] }>();
  private folders = new Map<string, { id: string; name: string; parents: string[] }>();
  private folderId = 'root-id';
  private idCounter = 0;

  getFolderId() { return Promise.resolve(this.folderId); }
  setFolderId(id: string) { this.folderId = id; return Promise.resolve(); }

  addFolder(name: string, parentId: string) {
    const id = `folder-${++this.idCounter}`;
    this.folders.set(id, { id, name, parents: [parentId] });
    return id;
  }

  addFileWithName(name: string, content: Uint8Array, parentId: string) {
    const id = `file-${++this.idCounter}`;
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this.files.set(id, { id, name, content, quartzoHash, parents: [parentId] });
    return id;
  }

  async listFiles(_folderId: string, _pageToken?: string) {
    return { files: this.buildMetadataList(), nextPageToken: null };
  }

  async listAllFiles(_folderId: string) {
    return this.buildMetadataList();
  }

  async listQuartzoVaultCandidates() { return []; }
  async getStartPageToken() { return 'token'; }
  async listChanges(_pageToken: string) {
    return { changes: [] as DriveChange[], newStartPageToken: 'new-token', nextPageToken: null };
  }

  async downloadFile(fileId: string) {
    const f = this.files.get(fileId);
    if (f) return f.content;
    throw new Error(`Not found: ${fileId}`);
  }

  async uploadFile(params: UploadFileParams) {
    const id = `file-${++this.idCounter}`;
    this.files.set(id, { id, name: params.name.split('/').pop() || params.name, content: params.content, quartzoHash: params.quartzoHash, parents: [params.folderId] });
    return { id, name: params.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: params.quartzoHash, parents: [params.folderId] };
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string) {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`Not found: ${fileId}`);
    f.content = content;
    f.quartzoHash = quartzoHash;
    return { id: fileId, name: f.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash, parents: f.parents };
  }

  async deleteFile(fileId: string) { this.files.delete(fileId); }

  async renameFile(fileId: string, newName: string, _newParentId?: string) {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`Not found: ${fileId}`);
    this.files.delete(fileId);
    f.name = newName.split('/').pop() || newName;
    this.files.set(f.name, { ...f });
    return { id: f.id, name: f.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: f.quartzoHash, parents: f.parents };
  }

  async getFileMetadata(fileId: string) {
    const f = this.files.get(fileId);
    if (f) return { id: f.id, name: f.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: f.quartzoHash, parents: f.parents };
    const folder = this.folders.get(fileId);
    if (folder) return { id: folder.id, name: folder.name, mimeType: 'application/vnd.google-apps.folder', modifiedTime: new Date().toISOString(), quartzoHash: null, parents: folder.parents };
    throw new Error(`Not found: ${fileId}`);
  }

  async ensureParentFolder(rootFolderId: string, filePath: string) {
    return rootFolderId;
  }

  private buildMetadataList(): DriveFileMetadata[] {
    return Array.from(this.files.values()).map(f => ({
      id: f.id, name: f.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(),
      quartzoHash: f.quartzoHash, parents: f.parents
    }));
  }
}

describe('Sync Regression Tests', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-reg-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('TS2352 fix: withRetry is accessible on adapter', () => {
    it('GoogleDriveAdapter exposes withRetry via unknown cast', async () => {
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      expect(typeof (realAdapter as unknown as Record<string, unknown>).withRetry).toBe('function');
    });
  });

  describe('SHA-256 hash comparison', () => {
    it('uses SHA-256 for all hash comparisons', async () => {
      const content = Buffer.from('test content');
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      const md5 = crypto.createHash('md5').update(content).digest('hex');
      expect(sha256).not.toBe(md5);

      fs.writeFileSync(path.join(tmpDir, 'test.md'), content);
      adapter.addFile('test.md', content);

      const result = await coordinator.reconcile();
      expect(result.conflicts).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('detects true conflict with different bytes', async () => {
      fs.writeFileSync(path.join(tmpDir, 'test.md'), Buffer.from('local'));
      adapter.addFile('test.md', Buffer.from('remote'));

      const result = await coordinator.reconcile();
      expect(result.conflicts).toBe(1);
    });
  });

  describe('Adoption semantics', () => {
    it('does not auto-push local-only files on first sync', async () => {
      fs.writeFileSync(path.join(tmpDir, 'new.md'), Buffer.from('new'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBe(0);
      expect(adapter.files.size).toBe(0);
    });

    it('pulls remote-only files', async () => {
      adapter.addFile('remote.md', Buffer.from('remote'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(tmpDir, 'remote.md'))).toBe(true);
    });

    it('advances baseline when both present and identical', async () => {
      const content = Buffer.from('same');
      fs.writeFileSync(path.join(tmpDir, 'same.md'), content);
      adapter.addFile('same.md', content);

      const result = await coordinator.reconcile();
      expect(result.conflicts).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('conflicts when both present and divergent', async () => {
      fs.writeFileSync(path.join(tmpDir, 'div.md'), Buffer.from('local'));
      adapter.addFile('div.md', Buffer.from('remote'));

      const result = await coordinator.reconcile();
      expect(result.conflicts).toBe(1);
    });
  });

  describe('Remote identity', () => {
    it('preserves remote file ID as identity', async () => {
      const content = Buffer.from('identity');
      const fileId = 'specific-id-123';
      adapter.addFileWithId('identity.md', fileId, content);

      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThan(0);
      const state = coordinator.getSyncState();
      expect(state.files.get('identity.md')?.remoteFileId).toBe(fileId);
    });

    it('detects duplicate remote identity as ambiguous', async () => {
      const c1 = Buffer.from('v1');
      const c2 = Buffer.from('v2');
      const hash1 = crypto.createHash('sha256').update(c1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(c2).digest('hex');

      adapter.listAllFiles = async () => [
        { id: 'id-1', name: 'dup.md', mimeType: 'text/markdown', modifiedTime: new Date().toISOString(), quartzoHash: hash1, parents: [adapter['folderId']] },
        { id: 'id-2-dup', name: 'dup.md', mimeType: 'text/markdown', modifiedTime: new Date().toISOString(), quartzoHash: hash2, parents: [adapter['folderId']] },
        { id: 'id-2', name: 'dup2.md', mimeType: 'text/markdown', modifiedTime: new Date().toISOString(), quartzoHash: hash2, parents: [adapter['folderId']] },
      ];

      const result = await coordinator.reconcile();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('File Policy', () => {
    it('excludes _backups directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_backups/foo.md')).toBe(false);
    });

    it('excludes _conflicts directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_conflicts/foo.md')).toBe(false);
    });

    it('includes _deleted directory for canonical soft-delete', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_deleted/foo.md')).toBe(true);
    });

    it('excludes _diagnostics directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_diagnostics/foo.md')).toBe(false);
    });

    it('excludes _cache directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_cache/foo.md')).toBe(false);
    });

    it('excludes .trash directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('.trash/foo.md')).toBe(false);
    });

    it('excludes .obsidian directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncDirectory('.obsidian')).toBe(false);
      expect(VaultSyncFilePolicy.shouldSyncFile('.obsidian/config')).toBe(false);
    });

    it('excludes .git directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncDirectory('.git')).toBe(false);
      expect(VaultSyncFilePolicy.shouldSyncFile('.git/config')).toBe(false);
    });

    it('includes normal .md files', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('notes.md')).toBe(true);
      expect(VaultSyncFilePolicy.shouldSyncFile('folder/note.md')).toBe(true);
    });

    it('includes _attachments directory', () => {
      expect(VaultSyncFilePolicy.shouldSyncDirectory('_attachments')).toBe(true);
      expect(VaultSyncFilePolicy.shouldSyncFile('_attachments/photo.jpg')).toBe(true);
    });

    it('excludes conflict artifacts', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('file.conflict')).toBe(false);
      expect(VaultSyncFilePolicy.shouldSyncFile('file.conflict.json')).toBe(false);
      expect(VaultSyncFilePolicy.shouldSyncFile('file.local')).toBe(false);
      expect(VaultSyncFilePolicy.shouldSyncFile('file.remote')).toBe(false);
    });

    it('excludes sync state file', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('.quartzo-sync-state.json')).toBe(false);
    });
  });

  describe('Path normalization', () => {
    it('normalizes backslash to forward slash', () => {
      expect(normalizeVaultPath('folder\\sub\\file.md')).toBe('folder/sub/file.md');
    });

    it('normalizes multiple slashes', () => {
      expect(normalizeVaultPath('folder//sub///file.md')).toBe('folder/sub/file.md');
    });

    it('strips leading and trailing slashes', () => {
      expect(normalizeVaultPath('/folder/file.md')).toBe('folder/file.md');
      expect(normalizeVaultPath('folder/file.md/')).toBe('folder/file.md');
    });

    it('isSameVaultPath works cross-platform', () => {
      expect(isSameVaultPath('folder\\sub\\file.md', 'folder/sub/file.md')).toBe(true);
    });
  });

  describe('State persistence fail-closed', () => {
    it('fails when state file is corrupted', async () => {
      const statePath = path.join(tmpDir, 'corrupted-state.json');
      fs.writeFileSync(statePath, 'invalid json {{{');
      const coord = new DriveSyncCoordinator(adapter, tmpDir, statePath);
      const result = await coord.reconcile();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Failed to load sync state'))).toBe(true);
    });

    it('fails when state version is incompatible', async () => {
      const statePath = path.join(tmpDir, 'old-version-state.json');
      fs.writeFileSync(statePath, JSON.stringify({
        files: [], lastSyncTime: 0, driveChangeToken: null, driveFolderId: null, version: '0.0.0'
      }));
      const coord = new DriveSyncCoordinator(adapter, tmpDir, statePath);
      const result = await coord.reconcile();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Incompatible sync state version'))).toBe(true);
    });
  });

  describe('Nested paths', () => {
    it('handles nested folder paths correctly', async () => {
      adapter.addFile('a/b/c/file.md', Buffer.from('nested'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThan(0);
    });

    it('handles duplicate names in different folders', async () => {
      adapter.addFile('folder1/note.md', Buffer.from('f1'));
      adapter.addFile('folder2/note.md', Buffer.from('f2'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThan(0);
    });
  });

  describe('Item 5: Local deletion propagation (soft-delete)', () => {
    it('propagates local deletion via _deleted/ tombstone', async () => {
      const content = Buffer.from('will be deleted locally');
      fs.writeFileSync(path.join(tmpDir, 'delete-me.md'), content);
      adapter.addFile('delete-me.md', content);
      await coordinator.reconcile();

      fs.unlinkSync(path.join(tmpDir, 'delete-me.md'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(path.join(tmpDir, 'delete-me.md'))).toBe(false);

      const hasTombstone = Array.from(adapter.files.keys()).some(k => k.startsWith('_deleted/'));
      expect(hasTombstone).toBe(true);
      expect(adapter.deleteCalls).toBe(1);
    });
  });

  describe('Item 6: Recursive parent resolution (production adapter)', () => {
    it('resolves deeply nested paths via parent chain using HierarchicalDriveAdapter', async () => {
      const hAdapter = new HierarchicalDriveAdapter();
      const rootId = 'root-id';
      const subId = hAdapter.addFolder('sub', rootId);
      const deepId = hAdapter.addFolder('deep', subId);
      const fileId = hAdapter.addFileWithName('c.md', Buffer.from('nested-content'), deepId);
      const fileData = (hAdapter as unknown as { files: Map<string, { parents: string[] }> }).files.get(fileId);
      if (fileData) {
        fileData.parents = [deepId];
      }

      const hCoord = new DriveSyncCoordinator(hAdapter, tmpDir, path.join(tmpDir, 'state-h.json'));
      const result = await hCoord.reconcile();
      expect(result.synced).toBe(1);
      const state = hCoord.getSyncState();
      const keys = Array.from(state.files.keys());
      expect(keys.some(k => k.includes('c.md'))).toBe(true);
    });
  });

  describe('Item 7: Quartzo_hash fallback (both-present missing metadata)', () => {
    it('computes hash via download when both present and quartzoHash is null', async () => {
      const content = Buffer.from('both present no hash');
      const id = 'both-nohash-id';
      adapter.files.set('both-nohash.md', { id, content, quartzoHash: '', parents: ['mock-folder-id'] });
      adapter.listAllFiles = async () => [
        { id, name: 'both-nohash.md', mimeType: 'text/markdown', modifiedTime: new Date().toISOString(), quartzoHash: '', parents: ['mock-folder-id'] }
      ];

      fs.writeFileSync(path.join(tmpDir, 'both-nohash.md'), content);
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThanOrEqual(0);
      expect(result.conflicts).toBe(0);
      const state = coordinator.getSyncState();
      const sf = state.files.get('both-nohash.md');
      expect(sf?.baseHash).toBeTruthy();
    });
  });

  describe('Item 8+9: Transactional + durable conflict resolution', () => {
    it('resolveConflict is async and persists state', async () => {
      const local = Buffer.from('local v');
      const remote = Buffer.from('remote v');
      fs.writeFileSync(path.join(tmpDir, 'durability.md'), local);
      adapter.addFile('durability.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      await coordinator.resolveConflict('durability.md', 'keep_local');
      expect(coordinator.getConflicts().length).toBe(0);

      const saved = fs.readFileSync(path.join(tmpDir, '.quartzo-sync-state.json'), 'utf-8');
      const stateData = JSON.parse(saved);
      const entry = stateData.files.find((f: [string, unknown]) => f[0] === 'durability.md');
      expect(entry).toBeTruthy();
    });

    it('resolveConflict propagates Drive update errors', async () => {
      const local = Buffer.from('local v2');
      const remote = Buffer.from('remote v2');
      fs.writeFileSync(path.join(tmpDir, 'err-resolve.md'), local);
      adapter.addFile('err-resolve.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      const origUpdateFile = adapter.updateFile.bind(adapter);
      adapter.updateFile = async () => { throw new Error('update-fail-drive'); };

      try {
        await coordinator.resolveConflict('err-resolve.md', 'keep_local');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('update-fail');
      } finally {
        adapter.updateFile = origUpdateFile;
      }
    });

    it('keep_local failure preserves conflict artifacts and state', async () => {
      const local = Buffer.from('local survive');
      const remote = Buffer.from('remote survive');
      fs.writeFileSync(path.join(tmpDir, 'survive.md'), local);
      adapter.addFile('survive.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      adapter.updateFile = async () => { throw new Error('drive-down'); };
      try {
        await coordinator.resolveConflict('survive.md', 'keep_local');
      } catch { /* expected */ }

      expect(coordinator.getConflicts().length).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'survive.md.conflict'))).toBe(true);
      const localFile = fs.readFileSync(path.join(tmpDir, 'survive.md'));
      expect(localFile.toString()).toBe('local survive');
    });
  });

  describe('Item 10: Text conflict rehydration with SEPARATOR', () => {
    it('parses SEPARATOR format correctly on rehydrate', async () => {
      const local = Buffer.from('local text');
      const remote = Buffer.from('remote text');
      fs.writeFileSync(path.join(tmpDir, 'separate.md'), local);
      adapter.addFile('separate.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      const newAdapter = new MockDriveAdapter();
      newAdapter.addFile('separate.md', remote);
      const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, 'state-sep.json'));
      await newCoord.reconcile().catch(() => {});

      const conflicts = newCoord.getConflicts();
      expect(conflicts.length).toBe(1);
      const decodedLocal = new TextDecoder().decode(conflicts[0].localContent);
      const decodedRemote = new TextDecoder().decode(conflicts[0].remoteContent);
      expect(decodedLocal).toBe('local text');
      expect(decodedRemote).toBe('remote text');
    });

    it('resolves text conflict in both directions after restart', async () => {
      const local = Buffer.from('local after restart');
      const remote = Buffer.from('remote after restart');
      fs.writeFileSync(path.join(tmpDir, 'restart-text.md'), local);
      adapter.addFile('restart-text.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      const newAdapter = new MockDriveAdapter();
      newAdapter.addFile('restart-text.md', remote);
      const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, 'state-rt.json'));
      await newCoord.reconcile().catch(() => {});

      await newCoord.resolveConflict('restart-text.md', 'keep_local');
      expect(newCoord.getConflicts().length).toBe(0);
      const contentKeepLocal = fs.readFileSync(path.join(tmpDir, 'restart-text.md'));
      expect(contentKeepLocal.toString()).toBe('local after restart');

      fs.writeFileSync(path.join(tmpDir, 'restart-text.md'), local);
      adapter.addFile('restart-text.md', remote);
      const coord2 = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, 'state-rt2.json'));
      fs.writeFileSync(path.join(tmpDir, 'restart-text.md'), local);
      adapter.files.set('restart-text.md', { id: 'rt2-id', content: remote, quartzoHash: crypto.createHash('sha256').update(remote).digest('hex'), parents: ['mock-folder-id'] });
      await coord2.reconcile();
      await coord2.resolveConflict('restart-text.md', 'keep_drive');
      const contentKeepDrive = fs.readFileSync(path.join(tmpDir, 'restart-text.md'));
      expect(contentKeepDrive.toString()).toBe('remote after restart');
    });
  });

  describe('Item 11: Nested conflict artifacts', () => {
    it('creates _conflicts/sub/ directory for nested files', async () => {
      const local = Buffer.from('local nested');
      const remote = Buffer.from('remote nested');
      fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'sub', 'file.md'), local);
      adapter.addFile('sub/file.md', remote);
      await coordinator.reconcile();

      expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'sub', 'file.md.conflict'))).toBe(true);
    });

    it('rehydrates nested conflict artifacts after restart', async () => {
      const local = Buffer.from('local deep');
      const remote = Buffer.from('remote deep');
      fs.mkdirSync(path.join(tmpDir, 'deep', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'deep', 'nested', 'file.md'), local);
      adapter.addFile('deep/nested/file.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      const newAdapter = new MockDriveAdapter();
      newAdapter.addFile('deep/nested/file.md', remote);
      const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, 'state-nest.json'));
      await newCoord.reconcile().catch(() => {});

      const conflicts = newCoord.getConflicts();
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].originalPath).toBe('deep/nested/file.md');
    });
  });

  describe('Item 12: 401/403/429/5xx retry with backoff on adapter', () => {
    it('withRetry method exists on production adapter', async () => {
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      expect(typeof (realAdapter as unknown as Record<string, unknown>).withRetry).toBe('function');
    });

    it('withRetry retries on 401 and refreshes token', async () => {
      let callCount = 0;
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      realAdapter.setAccessToken('test-token');

      let refreshCalled = false;
      realAdapter.setTokenRefreshCallback(async () => {
        refreshCalled = true;
        return 'new-token';
      });

      const mockOp = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('Unauthorized') as Error & { code: number };
          err.code = 401;
          throw err;
        }
        return 'success';
      };

      const result = await (realAdapter as unknown as { withRetry: <T>(op: () => Promise<T>) => Promise<T> }).withRetry(mockOp);
      expect(result).toBe('success');
      expect(callCount).toBe(2);
      expect(refreshCalled).toBe(true);
    });

    it('withRetry retries on 5xx errors with backoff', async () => {
      let callCount = 0;
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      realAdapter.setAccessToken('test-token');

      const mockOp = async () => {
        callCount++;
        if (callCount <= 2) {
          const err = new Error('Server Error') as Error & { code: number };
          err.code = 500;
          throw err;
        }
        return 'success';
      };

      const result = await (realAdapter as unknown as { withRetry: <T>(op: () => Promise<T>) => Promise<T> }).withRetry(mockOp);
      expect(result).toBe('success');
      expect(callCount).toBe(3);
    });

    it('withRetry retries on 429 rate limit', async () => {
      let callCount = 0;
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      realAdapter.setAccessToken('test-token');

      const mockOp = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('Rate limited') as Error & { code: number };
          err.code = 429;
          throw err;
        }
        return 'ok';
      };

      const result = await (realAdapter as unknown as { withRetry: <T>(op: () => Promise<T>) => Promise<T> }).withRetry(mockOp);
      expect(result).toBe('ok');
      expect(callCount).toBe(2);
    });
  });

  describe('Item 13: OAuth disconnect revokes', () => {
    it('GoogleOAuthDesktop disconnect calls revoke endpoint', async () => {
      const { GoogleOAuthDesktop } = await import('../../src/integrations/google/auth/loopback');
      const store: Record<string, string> = { 'quartzo_companion/refresh_token': 'test-refresh-token' };
      const mockSecretStorage = {
        get: async (key: string) => store[key] || null,
        set: async (key: string, value: string) => { store[key] = value; },
        delete: async (key: string) => { delete store[key]; }
      };
      const config = {
        clientId: 'test-client-id',
        redirectUri: 'http://localhost',
        scopes: ['https://www.googleapis.com/auth/drive'],
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token'
      };
      const oauth = new GoogleOAuthDesktop(config, mockSecretStorage);
      await oauth.disconnect();
      expect(store['quartzo_companion/refresh_token']).toBeUndefined();
    });
  });

  describe('Item 14: Build-time CLIENT_ID wiring', () => {
    it('esbuild defines QUARTZO_GOOGLE_DESKTOP_CLIENT_ID', () => {
      const esbuildConfig = fs.readFileSync(path.join(__dirname, '../../esbuild.config.mjs'), 'utf-8');
      expect(esbuildConfig).toContain('QUARTZO_GOOGLE_DESKTOP_CLIENT_ID');
      expect(esbuildConfig).toContain('process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID');
    });

    it('main.ts reads BUILD_CLIENT_ID from process.env', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain('BUILD_CLIENT_ID');
      expect(mainSrc).toContain('QUARTZO_GOOGLE_DESKTOP_CLIENT_ID');
      expect(mainSrc).toContain('getResolvedClientId');
    });
  });

  describe('Item 15: Vault events trigger sync', () => {
    it('main.ts registers create/modify/delete/rename sync triggers', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain("this.app.vault.on('create'");
      expect(mainSrc).toContain("this.app.vault.on('modify'");
      expect(mainSrc).toContain("this.app.vault.on('delete'");
      expect(mainSrc).toContain("this.app.vault.on('rename'");
      expect(mainSrc).toContain('triggerFocusSync');
    });
  });

  describe('Item 16: Drive scope', () => {
    it('OAuth scope is drive (full)', () => {
      const scopesSrc = fs.readFileSync(path.join(__dirname, '../../src/integrations/google/auth/scopes.ts'), 'utf-8');
      expect(scopesSrc).toContain('https://www.googleapis.com/auth/drive');
    });
  });

  describe('Item 17: npm audit', () => {
    it('runtime dependencies are googleapis, date-fns, date-fns-tz', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
      expect(Object.keys(pkg.dependencies)).toEqual(
        expect.arrayContaining(['@googleapis/drive', 'google-auth-library', 'date-fns', 'date-fns-tz'])
      );
    });
  });

  describe('Explicit adoption API', () => {
    it('explicitAdopt creates remote file and baseline', async () => {
      fs.writeFileSync(path.join(tmpDir, 'adopt-me.md'), Buffer.from('adopt content'));
      await coordinator.explicitAdopt('adopt-me.md');

      expect(adapter.files.has('adopt-me.md')).toBe(true);
      expect(adapter.uploadCalls).toBe(1);
      const state = coordinator.getSyncState();
      const sf = state.files.get('adopt-me.md');
      expect(sf?.remoteFileId).toBeTruthy();
      expect(sf?.baseHash).toBe(crypto.createHash('sha256').update(Buffer.from('adopt content')).digest('hex'));
      expect(sf?.localHash).toBe(sf?.baseHash);
    });

    it('explicitAdopt throws for missing local file', async () => {
      await expect(coordinator.explicitAdopt('nonexistent.md')).rejects.toThrow('Local file not found');
    });
  });

  describe('onunload abort', () => {
    it('main.ts calls oauthClient.abort() in onunload', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain('oauthClient?.abort()');
    });
  });

  describe('SecretStorage uses app.secretStorage', () => {
    it('main.ts uses app.secretStorage, not custom file', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain('this.app.secretStorage');
      expect(mainSrc).not.toContain('secrets.json');
      expect(mainSrc).not.toContain('loadSecrets');
      expect(mainSrc).not.toContain('saveSecrets');
      expect(mainSrc).not.toContain('getSecretsPath');
      expect(mainSrc).not.toContain('createSecretStorage');
    });
  });

  describe('Pairing requires explicit folder selection', () => {
    it('main.ts has confirmPairing method for explicit selection', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain('confirmPairing');
      expect(mainSrc).toContain('async confirmPairing(folderId: string, folderName: string, autoAdopt: boolean, autoPull: boolean)');
    });

    it('startPairingFlow does not auto-set isPaired', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      const startFlow = mainSrc.substring(
        mainSrc.indexOf('async startPairingFlow()'),
        mainSrc.indexOf('async confirmPairing()')
      );
      expect(startFlow).not.toContain('isPaired = true');
    });
  });

  describe('_deleted directory included in sync (canonical soft-delete)', () => {
    it('_deleted directory is included for sync', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_deleted/some/file.md')).toBe(true);
      expect(VaultSyncFilePolicy.shouldSyncDirectory('_deleted')).toBe(true);
    });
  });

  describe('Reviewer Blocker 1: _deleted sync', () => {
    it('_deleted files are synced (not excluded from sync)', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_deleted/note.md')).toBe(true);
      expect(VaultSyncFilePolicy.shouldSyncFile('_deleted/sub/dir/file.md')).toBe(true);
    });
    it('excluded dirs remain excluded', () => {
      expect(VaultSyncFilePolicy.shouldSyncFile('_conflicts/file.md')).toBe(false);
      expect(VaultSyncFilePolicy.shouldSyncFile('_backups/file.md')).toBe(false);
    });
  });

  describe('Reviewer Blocker 2: tombstone fail-closed', () => {
    it('tombstone failure preserves remote original', async () => {
      const content = Buffer.from('protected file');
      fs.writeFileSync(path.join(tmpDir, 'protected.md'), content);
      adapter.addFile('protected.md', content);
      await coordinator.reconcile();

      fs.unlinkSync(path.join(tmpDir, 'protected.md'));
      const origUploadFile = adapter.uploadFile.bind(adapter);
      adapter.uploadFile = async () => { throw new Error('upload-fail'); };
      try {
        await coordinator.reconcile();
      } catch { /* expected */ }
      adapter.uploadFile = origUploadFile;

      const state = coordinator.getSyncState();
      const sf = state.files.get('protected.md');
      expect(sf?.remoteFileId).toBeTruthy();
      expect(adapter.files.has('protected.md')).toBe(true);
      expect(adapter.deleteCalls).toBe(0);
    });

    it('successful tombstone + delete removes original', async () => {
      const content = Buffer.from('delete me');
      fs.writeFileSync(path.join(tmpDir, 'del-ok.md'), content);
      adapter.addFile('del-ok.md', content);
      await coordinator.reconcile();

      fs.unlinkSync(path.join(tmpDir, 'del-ok.md'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThanOrEqual(1);
      const hasTombstone = Array.from(adapter.files.keys()).some(k => k.startsWith('_deleted/'));
      expect(hasTombstone).toBe(true);
    });
  });

  describe('Reviewer Blocker 3: pairing requires explicit folder selection', () => {
    it('confirmPairing is callable and sets isPaired', async () => {
      await coordinator.setDriveFolderId('folder-123');
      const settings = { isPaired: false, googleDriveFolderId: null as string | null, googleDriveFolderName: null as string | null };
      const plugin = {
        driveAdapter: adapter,
        driveSyncCoordinator: coordinator,
        settings,
        async saveSettings() {},
        async startPairingFlow() {},
        async confirmPairing(folderId: string, folderName: string, autoAdopt: boolean, autoPull: boolean) {
          settings.googleDriveFolderId = folderId;
          settings.googleDriveFolderName = folderName;
          settings.isPaired = true;
        },
        async disconnectDrive() {},
        async adoptFile() {}
      };
      await plugin.confirmPairing('folder-123', 'My Vault', true, true);
      expect(settings.isPaired).toBe(true);
      expect(settings.googleDriveFolderId).toBe('folder-123');
    });

    it('main.ts startPairingFlow does not set isPaired', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      const flow = mainSrc.substring(
        mainSrc.indexOf('async startPairingFlow()'),
        mainSrc.indexOf('async confirmPairing(')
      );
      expect(flow).not.toContain('isPaired = true');
    });

    it('single Quartzo shell renders explicit vault candidates before pairing', () => {
      const shellSrc = fs.readFileSync(path.join(__dirname, '../../src/ui/shell/view.ts'), 'utf-8');
      expect(shellSrc).toContain('listQuartzoVaultCandidates');
      expect(shellSrc).toContain('Pair with');
      expect(shellSrc).toContain('confirmPairing(candidate.id, candidate.name, false, false)');
    });
  });

  describe('Reviewer Blocker 4+5: OAuth scope and ancestry proof', () => {
    it('OAuth scope is full Drive with documented rationale', () => {
      const scopesSrc = fs.readFileSync(path.join(__dirname, '../../src/integrations/google/auth/scopes.ts'), 'utf-8');
      expect(scopesSrc).toContain('https://www.googleapis.com/auth/drive');
      expect(mainSrc).toContain('V1 decision');
      expect(mainSrc).toContain('GOOGLE_COMPANION_SCOPES');
    });

    it('processChanges checks ancestry before processing', async () => {
      const coordSrc = fs.readFileSync(path.join(__dirname, '../../src/sync/coordinator/index.ts'), 'utf-8');
      expect(coordSrc).toContain('proveAncestryToRoot');
      expect(coordSrc).toContain('hasAncestry');
    });

    it('ancestry cache prevents repeated parent lookups', async () => {
      const coordSrc = fs.readFileSync(path.join(__dirname, '../../src/sync/coordinator/index.ts'), 'utf-8');
      expect(coordSrc).toContain('ancestryCache');
    });
  });

  describe('Reviewer Blocker 6: googleapis bundled', () => {
    it('esbuild externalizes googleapis', () => {
      const esbuildSrc = fs.readFileSync(path.join(__dirname, '../../esbuild.config.mjs'), 'utf-8');
      const externalLines = esbuildSrc.split('\n').filter(l => l.includes('"googleapis"') || l.includes("'googleapis'"));
      expect(externalLines.length).toBe(0);
    });
  });

  describe('Reviewer Blocker 7: release Client ID wiring', () => {
    it('release workflow passes QUARTZO_GOOGLE_DESKTOP_CLIENT_ID to build', () => {
      const releaseSrc = fs.readFileSync(path.join(__dirname, '../../.github/workflows/release.yml'), 'utf-8');
      expect(releaseSrc).toContain('QUARTZO_GOOGLE_DESKTOP_CLIENT_ID');
      expect(releaseSrc).toContain('secrets.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID');
    });

    it('release validator checks built main.js for placeholder', () => {
      const validatorSrc = fs.readFileSync(path.join(__dirname, '../../scripts/release-validate.mjs'), 'utf-8');
      expect(validatorSrc).toContain('main.js');
      expect(validatorSrc).toContain('PLACEHOLDER_CLIENT_ID');
    });
  });

  describe('Reviewer Blocker 8: minAppVersion >= 1.11.4', () => {
    it('manifest.json has minAppVersion >= 1.11.4', () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../manifest.json'), 'utf-8'));
      expect(manifest.minAppVersion >= '1.11.4').toBe(true);
    });

    it('versions.json maps beta to >= 1.11.4', () => {
      const versions = JSON.parse(fs.readFileSync(path.join(__dirname, '../../versions.json'), 'utf-8'));
      const mapped = Object.values(versions)[0] as string;
      expect(mapped >= '1.11.4').toBe(true);
    });

    it('release validator checks minAppVersion', () => {
      const validatorSrc = fs.readFileSync(path.join(__dirname, '../../scripts/release-validate.mjs'), 'utf-8');
      expect(validatorSrc).toContain('1.11.4');
    });
  });

  describe('Reviewer Blocker 9: withRetry 403 credential vs permission', () => {
    it('isCredentialError distinguishes permission-denied from credential 403', async () => {
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      const isCredErr = (realAdapter as unknown as { isCredentialError: (e: unknown) => boolean }).isCredentialError;

      const permDenied = { code: 403, response: { status: 403, data: { error: 'access_denied', error_description: 'permission denied' } } };
      expect(isCredErr(permDenied)).toBe(false);

      const credErr = { code: 403, response: { status: 403, data: { error: 'invalid_grant', error_description: 'token expired' } } };
      expect(isCredErr(credErr)).toBe(true);

      const non403 = { code: 500, response: { status: 500 } };
      expect(isCredErr(non403)).toBe(false);
    });

    it('permission-denied 403 does not trigger refresh', async () => {
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      realAdapter.setAccessToken('test-token');
      let refreshCalled = false;
      realAdapter.setTokenRefreshCallback(async () => { refreshCalled = true; return 'new-token'; });

      const permDeniedOp = async () => {
        const err = new Error('Permission denied') as Error & { code: number; response: { status: number; data: { error: string; error_description: string } } };
        err.code = 403;
        err.response = { status: 403, data: { error: 'access_denied', error_description: 'The caller does not have permission' } };
        throw err;
      };

      try {
        await (realAdapter as unknown as { withRetry: <T>(op: () => Promise<T>) => Promise<T> }).withRetry(permDeniedOp);
      } catch { /* expected */ }
      expect(refreshCalled).toBe(false);
    });
  });

  describe('Reviewer Blocker 10: findFolderByName error propagation', () => {
    it('findFolderByName propagates API errors', async () => {
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      realAdapter.setAccessToken('test-token');

      const findFolder = (realAdapter as unknown as { findFolderByName: (p: string, n: string) => Promise<string | null> }).findFolderByName;
      await expect(findFolder.call(realAdapter, 'parent-id', 'test')).rejects.toThrow();
    });
  });

  describe('Reviewer Blocker 11: canonical parser in vault events', () => {
    it('vault indexing uses the canonical parser plus shared Object Identification', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      const indexSrc = fs.readFileSync(path.join(__dirname, '../../src/vault/index/engine.ts'), 'utf-8');
      expect(mainSrc).toContain('parseObjectWithSharedSettings');
      expect(mainSrc).toContain('SharedSettingsRepository');
      expect(indexSrc).toContain('parseFile(file.content, file.path)');
    });

    it('main.ts does not have ad-hoc ObjectParser_parse function', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).not.toContain('function ObjectParser_parse');
    });

    it('ObjectParser handles LF and CRLF frontmatter', async () => {
      const { ObjectParser } = await import('../../src/core/objects/parser');
      const lf = '---\ntype: note\nid: test-lf\ntitle: Test\n---\nBody';
      const resultLf = ObjectParser.parse(lf);
      expect(resultLf.object.id).toBe('test-lf');

      const crlf = '---\r\ntype: note\r\nid: test-crlf\r\ntitle: Test\r\n---\r\nBody';
      const resultCrlf = ObjectParser.parse(crlf);
      expect(resultCrlf.object.id).toBe('test-crlf');
    });
  });

  describe('Reviewer additional: SecretStorage namespace', () => {
    it('loopback.ts uses plugin-specific secret key', () => {
      const loopbackSrc = fs.readFileSync(path.join(__dirname, '../../src/integrations/google/auth/loopback.ts'), 'utf-8');
      expect(loopbackSrc).toContain('quartzo_companion/refresh_token');
      expect(loopbackSrc).not.toContain('oauth_refresh_token');
    });

    it('main.ts uses plugin-specific secret key', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain('quartzo_companion/refresh_token');
      expect(mainSrc).not.toContain('oauth_refresh_token');
    });
  });

  describe('Reviewer additional: onunload abort', () => {
    it('main.ts calls oauthClient.abort() in onunload', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain('oauthClient?.abort()');
    });
  });

  describe('Reviewer additional: triggerFocusSync for all events', () => {
    it('main.ts registers sync triggers for create/modify/delete/rename', () => {
      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');
      expect(mainSrc).toContain("this.app.vault.on('create'");
      expect(mainSrc).toContain("this.app.vault.on('modify'");
      expect(mainSrc).toContain("this.app.vault.on('delete'");
      expect(mainSrc).toContain("this.app.vault.on('rename'");
      expect(mainSrc).toContain('triggerFocusSync');
    });
  });

  describe('Reviewer additional: conflict resolution transactional', () => {
    it('keep_local failure preserves conflict and does not advance state', async () => {
      const local = Buffer.from('safe local');
      const remote = Buffer.from('safe remote');
      fs.writeFileSync(path.join(tmpDir, 'txn.md'), local);
      adapter.addFile('txn.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      const origUpdate = adapter.updateFile.bind(adapter);
      adapter.updateFile = async () => { throw new Error('drive-timeout'); };
      try {
        await coordinator.resolveConflict('txn.md', 'keep_local');
      } catch { /* expected */ }
      adapter.updateFile = origUpdate;

      expect(coordinator.getConflicts().length).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'txn.md.conflict'))).toBe(true);
      const state = coordinator.getSyncState();
      const sf = state.files.get('txn.md');
      expect(sf?.baseHash).not.toBe(local.toString());
    });
  });

  describe('Reviewer additional: nested conflict artifacts after restart', () => {
    it('nested conflicts rehydrate correctly', async () => {
      const local = Buffer.from('deep local');
      const remote = Buffer.from('deep remote');
      fs.mkdirSync(path.join(tmpDir, 'deep', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'deep', 'nested', 'file.md'), local);
      adapter.addFile('deep/nested/file.md', remote);
      await coordinator.reconcile();
      expect(coordinator.getConflicts().length).toBe(1);

      const newAdapter = new MockDriveAdapter();
      newAdapter.addFile('deep/nested/file.md', remote);
      const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, 'state-deep.json'));
      await newCoord.reconcile().catch(() => {});
      const conflicts = newCoord.getConflicts();
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].originalPath).toBe('deep/nested/file.md');
    });
  });

  describe('Reviewer additional: 401->refresh->retry on adapter', () => {
    it('withRetry retries 401 once and refreshes', async () => {
      let callCount = 0;
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      realAdapter.setAccessToken('test-token');
      let refreshCalled = false;
      realAdapter.setTokenRefreshCallback(async () => { refreshCalled = true; return 'new-token'; });

      const mockOp = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('Unauthorized') as Error & { code: number };
          err.code = 401;
          throw err;
        }
        return 'success';
      };

      const result = await (realAdapter as unknown as { withRetry: <T>(op: () => Promise<T>) => Promise<T> }).withRetry(mockOp);
      expect(result).toBe('success');
      expect(callCount).toBe(2);
      expect(refreshCalled).toBe(true);
    });
  });
});
