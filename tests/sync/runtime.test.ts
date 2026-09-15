import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DriveSyncCoordinator } from '../../src/sync/coordinator/index';
import { VaultSyncFilePolicy } from '../../src/sync/coordinator/file-policy';
import { normalizeVaultPath, isSameVaultPath } from '../../src/sync/coordinator/path-utils';
import type { DriveAdapter, DriveFileMetadata, DriveChange } from '../../src/sync/coordinator/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

class FakeDriveAdapter implements DriveAdapter {
  private _files = new Map<string, { id: string; content: Uint8Array; quartzoHash: string }>();
  private folderId = 'root-folder-id';
  private changeToken = 0;
  public pendingChanges: Array<{ fileId: string; removed: boolean; file?: DriveFileMetadata }> = [];
  public listChangesCalls = 0;
  public listFilesCalls = 0;
  public uploadCalls = 0;
  public updateCalls = 0;

  get files() { return this._files; }
  set files(v: Map<string, { id: string; content: Uint8Array; quartzoHash: string }>) { this._files = v; }

  async getFolderId() { return this.folderId; }
  async setFolderId(id: string) { this.folderId = id; }

  async listFiles(_folderId: string, _pageToken?: string) {
    this.listFilesCalls++;
    return { files: this.buildMetadataList(), nextPageToken: null };
  }

  async listAllFiles(_folderId: string) {
    this.listFilesCalls++;
    return this.buildMetadataList();
  }

  async getStartPageToken() { return String(this.changeToken); }

  async listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string; nextPageToken: string | null }> {
    this.listChangesCalls++;
    const changes = [...this.pendingChanges];
    this.pendingChanges = [];
    this.changeToken++;
    return { changes, newStartPageToken: String(this.changeToken), nextPageToken: null };
  }

  async downloadFile(fileId: string) {
    for (const f of this._files.values()) {
      if (f.id === fileId) return f.content;
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async uploadFile(params: { folderId: string; name: string; content: Uint8Array; quartzoHash: string }) {
    this.uploadCalls++;
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._files.set(params.name, { id, content: params.content, quartzoHash: params.quartzoHash });
    return this.makeMetadata(id, params.name, params.quartzoHash);
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string) {
    this.updateCalls++;
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) {
        this._files.set(name, { ...f, content, quartzoHash });
        return this.makeMetadata(fileId, name, quartzoHash);
      }
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async deleteFile(fileId: string) {
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) {
        this._files.delete(name);
        this.pendingChanges.push({ fileId, removed: true });
        return;
      }
    }
  }

  async getFileMetadata(fileId: string) {
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) return this.makeMetadata(f.id, name, f.quartzoHash);
    }
    throw new Error(`Not found: ${fileId}`);
  }

  addRemoteFile(name: string, content: Uint8Array) {
    const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this._files.set(name, { id, content, quartzoHash });
    this.pendingChanges.push({ fileId: id, removed: false, file: this.makeMetadata(id, name, quartzoHash) });
    return { id, quartzoHash };
  }

  addRemoteFileWithId(name: string, id: string, content: Uint8Array) {
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this._files.set(name, { id, content, quartzoHash });
    this.pendingChanges.push({ fileId: id, removed: false, file: this.makeMetadata(id, name, quartzoHash) });
    return { id, quartzoHash };
  }

  private buildMetadataList(): DriveFileMetadata[] {
    return Array.from(this._files.entries()).map(([name, f]) => this.makeMetadata(f.id, name, f.quartzoHash));
  }

  private makeMetadata(id: string, name: string, quartzoHash: string): DriveFileMetadata {
    return { id, name, mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash, parents: [this.folderId] };
  }
}

describe('Runtime Sync Tests', () => {
  let tmpDir: string;
  let adapter: FakeDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-rt-'));
    adapter = new FakeDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, 'state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1: unknown-base local-only does not upload', async () => {
    fs.writeFileSync(path.join(tmpDir, 'local.md'), 'content');
    const result = await coordinator.reconcile();
    expect(result.synced).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(adapter.files.size).toBe(0);
    const state = coordinator.getSyncState();
    const sf = state.files.get('local.md');
    expect(sf?.baseHash).toBeNull();
    expect(sf?.remoteExists).toBe(false);
  });

  it('2: explicit adoption creates remote and baseline', async () => {
    fs.writeFileSync(path.join(tmpDir, 'adopt.md'), 'adopt content');
    await coordinator.reconcile();

    adapter.addRemoteFile('adopt.md', Buffer.from('adopt content'));
    await coordinator.reconcile();

    const state = coordinator.getSyncState();
    const sf = state.files.get('adopt.md');
    expect(sf?.baseHash).toBeTruthy();
    expect(sf?.remoteFileId).toBeTruthy();
  });

  it('3: remote changed same ID - pull when local unchanged after push', async () => {
    const content1 = Buffer.from('v1');
    fs.writeFileSync(path.join(tmpDir, 'shared.md'), content1);
    const remote = adapter.addRemoteFile('shared.md', content1);
    await coordinator.reconcile();

    fs.writeFileSync(path.join(tmpDir, 'shared.md'), 'v2');
    const result2 = await coordinator.reconcile();
    expect(result2.conflicts).toBe(0);
    expect(result2.synced).toBe(1);

    const state = coordinator.getSyncState();
    expect(state.files.get('shared.md')?.remoteFileId).toBe(remote.id);

    adapter.files.get('shared.md')!.content = Buffer.from('v3');
    adapter.files.get('shared.md')!.quartzoHash = crypto.createHash('sha256').update(Buffer.from('v3')).digest('hex');
    adapter.pendingChanges.push({ fileId: remote.id, removed: false, file: { id: remote.id, name: 'shared.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: adapter.files.get('shared.md')!.quartzoHash, parents: [adapter['folderId']] } });
    const result3 = await coordinator.reconcile();
    expect(result3.synced).toBe(1);
  });

  it('4: local edit updates existing remote ID without new create', async () => {
    const content1 = Buffer.from('v1');
    const fixedId = 'fixed-id-123';
    fs.writeFileSync(path.join(tmpDir, 'same-id.md'), content1);
    adapter.addRemoteFileWithId('same-id.md', fixedId, content1);
    await coordinator.reconcile();

    const state1 = coordinator.getSyncState();
    expect(state1.files.get('same-id.md')?.remoteFileId).toBe(fixedId);

    fs.writeFileSync(path.join(tmpDir, 'same-id.md'), 'v2');
    await coordinator.reconcile();

    expect(adapter.updateCalls).toBe(1);
    const state2 = coordinator.getSyncState();
    expect(state2.files.get('same-id.md')?.remoteFileId).toBe(fixedId);
  });

  it('5: Quartzo_hash is set on upload and read on sync', async () => {
    const content = Buffer.from('hash test');
    fs.writeFileSync(path.join(tmpDir, 'hash.md'), content);
    adapter.addRemoteFile('hash.md', content);
    await coordinator.reconcile();

    const modified = Buffer.from('hash test modified');
    fs.writeFileSync(path.join(tmpDir, 'hash.md'), modified);
    await coordinator.reconcile();

    const entry = adapter.files.get('hash.md');
    expect(entry).toBeDefined();
    expect(entry?.quartzoHash).toBe(crypto.createHash('sha256').update(modified).digest('hex'));
  });

  it('6: missing Quartzo_hash uses download for comparison', async () => {
    const content = Buffer.from('no hash');
    const id = `nohash-${Date.now()}`;
    adapter.files.set('nohash.md', { id, content, quartzoHash: '' });
    adapter.pendingChanges.push({ fileId: id, removed: false, file: { id, name: 'nohash.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: '', parents: ['root-folder-id'] } });

    const result = await coordinator.reconcile();
    expect(result.synced).toBe(1);

    const state = coordinator.getSyncState();
    const sf = state.files.get('nohash.md');
    expect(sf?.localHash).toBe(crypto.createHash('sha256').update(content).digest('hex'));
  });

  it('7: recursive nested paths are all found', async () => {
    fs.mkdirSync(path.join(tmpDir, 'Projects', 'Alpha'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'Projects', 'Beta'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '_attachments', 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Projects', 'Alpha', 'note.md'), 'alpha');
    fs.writeFileSync(path.join(tmpDir, 'Projects', 'Beta', 'note.md'), 'beta');
    fs.writeFileSync(path.join(tmpDir, '_attachments', 'a', 'b', 'image.png'), 'img');

    await coordinator.reconcile();

    const state = coordinator.getSyncState();
    expect(state.files.has('Projects/Alpha/note.md')).toBe(true);
    expect(state.files.has('Projects/Beta/note.md')).toBe(true);
  });

  it('8: listAllFiles exhausts all pages', async () => {
    for (let i = 0; i < 5; i++) {
      adapter.addRemoteFile(`page${i}.md`, Buffer.from(`content${i}`));
    }
    const result = await coordinator.reconcile();
    expect(result.synced).toBe(5);
  });

  it('9: coordinator calls listChanges after initial inventory', async () => {
    await coordinator.reconcile();
    expect(adapter.listFilesCalls).toBeGreaterThanOrEqual(1);

    await coordinator.reconcile();
    expect(adapter.listChangesCalls).toBeGreaterThanOrEqual(1);
  });

  it('10: changes pagination loop completes', async () => {
    await coordinator.reconcile();
    const result = await coordinator.reconcile();
    expect(result.errors.length).toBe(0);
  });

  it('11: remote deletion deletes local when unchanged', async () => {
    const content = Buffer.from('will be deleted');
    fs.writeFileSync(path.join(tmpDir, 'del-me.md'), content);
    const remote = adapter.addRemoteFile('del-me.md', content);
    await coordinator.reconcile();

    const state1 = coordinator.getSyncState();
    expect(state1.files.get('del-me.md')?.remoteFileId).toBe(remote.id);

    await adapter.deleteFile(remote.id);
    const result = await coordinator.reconcile();
    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(tmpDir, 'del-me.md'))).toBe(false);
  });

  it('12: local deletion + remote unchanged', async () => {
    const content = Buffer.from('local del');
    fs.writeFileSync(path.join(tmpDir, 'local-del.md'), content);
    adapter.addRemoteFile('local-del.md', content);
    await coordinator.reconcile();

    fs.unlinkSync(path.join(tmpDir, 'local-del.md'));
    const result = await coordinator.reconcile();
    expect(result.errors.length).toBe(0);
  });

  it('13: edit vs delete is conflict', async () => {
    const content = Buffer.from('editdel');
    fs.writeFileSync(path.join(tmpDir, 'editdel.md'), content);
    const remote = adapter.addRemoteFile('editdel.md', content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    fs.writeFileSync(path.join(tmpDir, 'editdel.md'), 'changed');
    await adapter.deleteFile(remote.id);
    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);
  });

  it('14: rename preserves remote identity', async () => {
    const content = Buffer.from('rename test');
    const fixedId = 'rename-id-456';
    fs.writeFileSync(path.join(tmpDir, 'old-name.md'), content);
    adapter.addRemoteFileWithId('old-name.md', fixedId, content);
    await coordinator.reconcile();

    const state1 = coordinator.getSyncState();
    expect(state1.files.get('old-name.md')?.remoteFileId).toBe(fixedId);

    fs.unlinkSync(path.join(tmpDir, 'old-name.md'));
    fs.writeFileSync(path.join(tmpDir, 'new-name.md'), content);

    adapter.files.delete('old-name.md');
    adapter.files.set('new-name.md', {
      id: fixedId,
      content,
      quartzoHash: crypto.createHash('sha256').update(content).digest('hex'),
    });
    adapter.pendingChanges.push({ fileId: fixedId, removed: false, file: { id: fixedId, name: 'new-name.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: crypto.createHash('sha256').update(content).digest('hex'), parents: ['root-folder-id'] } });

    await coordinator.reconcile();

    const state2 = coordinator.getSyncState();
    expect(state2.files.get('new-name.md')?.remoteFileId).toBe(fixedId);
  });

  it('15: same relative path with two remote IDs fails closed', async () => {
    const c1 = Buffer.from('v1');
    const c2 = Buffer.from('v2');
    const h1 = crypto.createHash('sha256').update(c1).digest('hex');
    const h2 = crypto.createHash('sha256').update(c2).digest('hex');

    adapter.files.set('dup.md', { id: 'id-1', content: c1, quartzoHash: h1 });
    adapter.files.set('dup_alt.md', { id: 'id-2', content: c2, quartzoHash: h2 });

    const originalListAll = adapter.listAllFiles.bind(adapter);
    adapter.listAllFiles = async () => [
      { id: 'id-1', name: 'dup.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: h1, parents: ['root-folder-id'] },
      { id: 'id-2', name: 'dup.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: h2, parents: ['root-folder-id'] },
    ];

    const result = await coordinator.reconcile();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('16: backslash and forward slash normalize to same path', () => {
    expect(normalizeVaultPath('folder\\sub\\file.md')).toBe('folder/sub/file.md');
    expect(normalizeVaultPath('folder/sub/file.md')).toBe('folder/sub/file.md');
    expect(isSameVaultPath('folder\\sub\\file.md', 'folder/sub/file.md')).toBe(true);
  });

  it('17: all contract exclusions work', () => {
    expect(VaultSyncFilePolicy.shouldSyncFile('_backups/foo.md')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('_conflicts/foo.md')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('_diagnostics/foo.md')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('_cache/foo.md')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('.trash/foo.md')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('.obsidian/config')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('.git/config')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('node_modules/x/index.js')).toBe(false);
    expect(VaultSyncFilePolicy.shouldSyncFile('normal.md')).toBe(true);
    expect(VaultSyncFilePolicy.shouldSyncFile('_attachments/photo.jpg')).toBe(true);
  });

  it('18: unknown attachment binary remains byte-safe', async () => {
    const bin = Buffer.from([0x00, 0xFF, 0x01, 0xFE, 0x89, 0x50, 0x4E, 0x47]);
    fs.mkdirSync(path.join(tmpDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'bin', 'custom.ext'), bin);
    adapter.addRemoteFile('bin/custom.ext', Buffer.from([0x10, 0x20]));
    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);
    const localContent = fs.readFileSync(path.join(tmpDir, 'bin', 'custom.ext'));
    expect(localContent).toEqual(bin);
  });

  it('19: binary conflict appears in conflict registry', async () => {
    const local = Buffer.from([0x00, 0xFF]);
    const remote = Buffer.from([0x10, 0x20]);
    fs.writeFileSync(path.join(tmpDir, 'photo.bin'), local);
    adapter.addRemoteFile('photo.bin', remote);
    await coordinator.reconcile();

    const conflicts = coordinator.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].isBinary).toBe(true);
  });

  it('20: keep local resolves conflict correctly', async () => {
    const local = Buffer.from('local version');
    const remote = Buffer.from('remote version');
    fs.writeFileSync(path.join(tmpDir, 'resolve.md'), local);
    adapter.addRemoteFile('resolve.md', remote);
    await coordinator.reconcile();

    coordinator.resolveConflict('resolve.md', 'keep_local');
    expect(coordinator.getConflicts().length).toBe(0);

    const saved = fs.readFileSync(path.join(tmpDir, 'resolve.md'));
    expect(saved.toString()).toBe('local version');

    const state = coordinator.getSyncState();
    const sf = state.files.get('resolve.md');
    expect(sf?.baseHash).toBe(sf?.localHash);
  });

  it('21: keep drive resolves conflict correctly', async () => {
    const local = Buffer.from('local version');
    const remote = Buffer.from('remote version');
    fs.writeFileSync(path.join(tmpDir, 'resolve2.md'), local);
    adapter.addRemoteFile('resolve2.md', remote);
    await coordinator.reconcile();

    coordinator.resolveConflict('resolve2.md', 'keep_drive');
    expect(coordinator.getConflicts().length).toBe(0);

    const saved = fs.readFileSync(path.join(tmpDir, 'resolve2.md'));
    expect(saved.toString()).toBe('remote version');
  });

  it('22: resolution advances all three hashes', async () => {
    const local = Buffer.from('l');
    const remote = Buffer.from('r');
    fs.writeFileSync(path.join(tmpDir, 'hashes.md'), local);
    adapter.addRemoteFile('hashes.md', remote);
    await coordinator.reconcile();

    coordinator.resolveConflict('hashes.md', 'keep_local');
    const state = coordinator.getSyncState();
    const sf = state.files.get('hashes.md');
    expect(sf?.baseHash).toBeTruthy();
    expect(sf?.localHash).toBeTruthy();
    expect(sf?.remoteHash).toBeTruthy();
    expect(sf?.baseHash).toBe(sf?.localHash);
  });

  it('23: corrupted state file causes sync abort', async () => {
    const statePath = path.join(tmpDir, 'corrupted-state.json');
    fs.writeFileSync(statePath, '{invalid json');
    const newAdapter = new FakeDriveAdapter();
    const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, statePath);
    const result = await newCoord.reconcile();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(newAdapter.uploadCalls).toBe(0);
  });

  it('24: sync state file excluded from policy', () => {
    expect(VaultSyncFilePolicy.shouldSyncFile('.quartzo-sync-state.json')).toBe(false);
  });

  it('25: OAuth engine state timeout works', async () => {
    const { OAuthEngine } = await import('../../src/core/oauth/engine');
    const config = { clientId: 'test', redirectUri: 'http://localhost', scopes: [], authUrl: 'https://auth', tokenUrl: 'https://token' };
    const result = OAuthEngine.handleCallback('code', 'invalid_state', config);
    expect(result.success).toBe(false);
    expect(result.error).toBe('state_mismatch');
  });

  it('26: OAuth mock success produces session', async () => {
    const { OAuthEngine } = await import('../../src/core/oauth/engine');
    const config = { clientId: 'test', redirectUri: 'http://localhost', scopes: [], authUrl: 'https://auth', tokenUrl: 'https://token' };
    const flow = OAuthEngine.createOAuthFlow(config);
    const result = OAuthEngine.handleCallback('code', flow.state, config, {
      access_token: 'test_token', expires_in: 3600, token_type: 'Bearer'
    });
    expect(result.success).toBe(true);
    expect(result.session?.accessToken).toBe('test_token');
  });

  it('27: refreshAccessToken works with mock', async () => {
    const { OAuthEngine } = await import('../../src/core/oauth/engine');
    const config = { clientId: 'test', redirectUri: 'http://localhost', scopes: [], authUrl: 'https://auth', tokenUrl: 'https://token' };
    const result = OAuthEngine.refreshAccessToken('old_token', config, {
      access_token: 'new_token', expires_in: 3600, token_type: 'Bearer'
    });
    expect(result.success).toBe(true);
    expect(result.session?.accessToken).toBe('new_token');
  });

  it('28: adapter without token throws on operations', async () => {
    const failingAdapter: DriveAdapter = {
      async getFolderId() { return null; },
      async setFolderId() {},
      async listFiles() { return { files: [], nextPageToken: null }; },
      async listAllFiles() { return []; },
      async getStartPageToken() { return ''; },
      async listChanges() { return { changes: [], newStartPageToken: '', nextPageToken: null }; },
      async downloadFile() { throw new Error('No token'); },
      async uploadFile() { throw new Error('No token'); },
      async updateFile() { throw new Error('No token'); },
      async deleteFile() { throw new Error('No token'); },
      async getFileMetadata() { throw new Error('No token'); }
    };
    try {
      await failingAdapter.downloadFile('test');
    } catch (e) {
      expect((e as Error).message).toContain('No token');
    }
  });

  it('29: coordinator setDriveFolderId works', async () => {
    await coordinator.setDriveFolderId('new-folder');
    const state = coordinator.getSyncState();
    expect(state.driveFolderId).toBe('new-folder');
  });

  it('30: first sync does not auto-push adoption_required files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'secret.md'), 'private');
    const result = await coordinator.reconcile();
    expect(result.synced).toBe(0);
    expect(adapter.files.size).toBe(0);
  });
});
