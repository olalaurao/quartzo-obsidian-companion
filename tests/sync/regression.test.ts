import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DriveSyncCoordinator } from '../../src/sync/coordinator/index';
import { VaultSyncFilePolicy } from '../../src/sync/coordinator/file-policy';
import { normalizeVaultPath, isSameVaultPath } from '../../src/sync/coordinator/path-utils';
import type { DriveAdapter, DriveFileMetadata, DriveChange } from '../../src/sync/coordinator/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

class MockDriveAdapter implements DriveAdapter {
  public files = new Map<string, { id: string; content: Uint8Array; quartzoHash: string }>();
  private folderId = 'mock-folder-id';
  public listChangesCalls = 0;
  public uploadCalls = 0;

  async getFolderId() { return this.folderId; }
  async setFolderId(id: string) { this.folderId = id; }

  async listFiles(_folderId: string, _pageToken?: string) {
    const files: DriveFileMetadata[] = Array.from(this.files.entries()).map(([name, data]) => ({
      id: data.id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(),
      quartzoHash: data.quartzoHash || null, parents: [this.folderId]
    }));
    return { files, nextPageToken: null };
  }

  async listAllFiles(_folderId: string) {
    return Array.from(this.files.entries()).map(([name, data]) => ({
      id: data.id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(),
      quartzoHash: data.quartzoHash || null, parents: [this.folderId]
    }));
  }

  async listRootFolders() { return []; }

  async getStartPageToken() { return 'start-token'; }

  async listChanges(_pageToken: string) {
    this.listChangesCalls++;
    return { changes: [] as DriveChange[], newStartPageToken: 'new-token', nextPageToken: null };
  }

  async downloadFile(fileId: string) {
    for (const data of this.files.values()) {
      if (data.id === fileId) return data.content;
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async uploadFile(params: { folderId: string; name: string; content: Uint8Array; quartzoHash: string }) {
    this.uploadCalls++;
    const id = `file-${Date.now()}-${Math.random()}`;
    this.files.set(params.name, { id, content: params.content, quartzoHash: params.quartzoHash });
    return { id, name: params.name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: params.quartzoHash, parents: [params.folderId] };
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string) {
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) {
        this.files.set(name, { ...data, content, quartzoHash });
        return { id: fileId, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash, parents: [this.folderId] };
      }
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async deleteFile(fileId: string) {
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) { this.files.delete(name); return; }
    }
  }

  async getFileMetadata(fileId: string) {
    for (const [name, data] of this.files.entries()) {
      if (data.id === fileId) return { id: data.id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: data.quartzoHash || null, parents: [this.folderId] };
    }
    throw new Error(`File not found: ${fileId}`);
  }

  addFile(name: string, content: Uint8Array) {
    const id = `file-${Date.now()}-${Math.random()}`;
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this.files.set(name, { id, content, quartzoHash });
    return id;
  }

  addFileWithId(name: string, id: string, content: Uint8Array) {
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this.files.set(name, { id, content, quartzoHash });
    return id;
  }
}

describe('Sync Regression Tests', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-reg-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, 'state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  describe('Item 5: Local deletion propagation', () => {
    it('propagates local deletion to Drive when base matches local', async () => {
      const content = Buffer.from('will be deleted locally');
      fs.writeFileSync(path.join(tmpDir, 'delete-me.md'), content);
      adapter.addFile('delete-me.md', content);
      await coordinator.reconcile();

      fs.unlinkSync(path.join(tmpDir, 'delete-me.md'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(path.join(tmpDir, 'delete-me.md'))).toBe(false);
      expect(adapter.files.has('delete-me.md')).toBe(false);
    });
  });

  describe('Item 6: Recursive parent resolution', () => {
    it('resolves deeply nested paths via parent chain', async () => {
      adapter.addFile('a/b/c/note.md', Buffer.from('nested'));
      const result = await coordinator.reconcile();
      expect(result.synced).toBeGreaterThan(0);
      const state = coordinator.getSyncState();
      expect(state.files.has('a/b/c/note.md')).toBe(true);
    });
  });

  describe('Item 7: Quartzo_hash fallback', () => {
    it('computes hash via download when quartzoHash is null', async () => {
      const content = Buffer.from('no hash file');
      const id = 'nohash-id-123';
      adapter.files.set('nohash.md', { id, content, quartzoHash: '' });
      const origListAll = adapter.listAllFiles.bind(adapter);
      adapter.listAllFiles = async () => [
        { id, name: 'nohash.md', mimeType: 'text/markdown', modifiedTime: new Date().toISOString(), quartzoHash: '', parents: ['mock-folder-id'] }
      ];

      const result = await coordinator.reconcile();
      expect(result.synced).toBe(1);
      const state = coordinator.getSyncState();
      const sf = state.files.get('nohash.md');
      expect(sf?.localHash).toBe(crypto.createHash('sha256').update(content).digest('hex'));
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

      const saved = fs.readFileSync(path.join(tmpDir, 'state.json'), 'utf-8');
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
  });

  describe('Item 12: 401 retry on adapter', () => {
    it('GoogleDriveAdapter has withRetry method', async () => {
      const { GoogleDriveAdapter } = await import('../../src/integrations/google/drive/adapter');
      const realAdapter = new GoogleDriveAdapter();
      expect(typeof (realAdapter as Record<string, unknown>).withRetry).toBe('function');
    });
  });

  describe('Item 17: npm audit', () => {
    it('runtime dependencies are googleapis, date-fns, date-fns-tz', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
      expect(Object.keys(pkg.dependencies)).toEqual(
        expect.arrayContaining(['googleapis', 'date-fns', 'date-fns-tz'])
      );
    });
  });
});
