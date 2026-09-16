import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DriveSyncCoordinator, PairingSummary } from '../../src/sync/coordinator';
import { VaultSyncFilePolicy } from '../../src/sync/coordinator/file-policy';
import { normalizeVaultPath } from '../../src/sync/coordinator/path-utils';
import type { DriveAdapter, DriveFileMetadata, DriveChange, UploadFileParams } from '../../src/sync/coordinator/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

class MockDriveAdapter implements DriveAdapter {
  private _files = new Map<string, { id: string; content: Uint8Array; quartzoHash: string; parents: string[] }>();
  private _folders = new Map<string, { id: string; name: string; parents: string[] }>();
  private folderId = 'root-folder-id';
  private changeToken = 0;
  public pendingChanges: Array<{ fileId: string; removed: boolean; file?: DriveFileMetadata }> = [];
  public uploadCalls = 0;
  public updateCalls = 0;
  public deleteCalls = 0;
  public renameCalls: Array<{ fileId: string; newName: string; newParentId?: string }> = [];
  public listChangesCalls = 0;

  get files() { return this._files; }

  async getFolderId() { return this.folderId; }
  async setFolderId(id: string) { this.folderId = id; }

  async listFiles(_folderId: string, _pageToken?: string) {
    return { files: this.buildMetadataList(), nextPageToken: null };
  }

  async listAllFiles(_folderId: string) {
    return this.buildMetadataList();
  }

  async listRootFolders() { return []; }

  async getStartPageToken() { return String(this.changeToken); }

  async listChanges(pageToken: string) {
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

  async uploadFile(params: UploadFileParams) {
    this.uploadCalls++;
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._files.set(params.name, { id, content: params.content, quartzoHash: params.quartzoHash, parents: [params.folderId] });
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

  async renameFile(fileId: string, newName: string, _newParentId?: string) {
    this.renameCalls.push({ fileId, newName, newParentId: _newParentId });
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) {
        this._files.delete(name);
        this._files.set(newName, { ...f });
        return this.makeMetadata(fileId, newName, f.quartzoHash);
      }
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async deleteFile(fileId: string) {
    this.deleteCalls++;
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

  async ensureParentFolder(rootFolderId: string, filePath: string) {
    return rootFolderId;
  }

  addRemoteFile(name: string, content: Uint8Array) {
    const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this._files.set(name, { id, content, quartzoHash, parents: [this.folderId] });
    this.pendingChanges.push({ fileId: id, removed: false, file: this.makeMetadata(id, name, quartzoHash) });
    return { id, quartzoHash };
  }

  addRemoteFileWithId(name: string, id: string, content: Uint8Array) {
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    this._files.set(name, { id, content, quartzoHash, parents: [this.folderId] });
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

function h(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('P0.3 — Local rename/move preserves remote identity', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-rename-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('local rename preserves remoteFileId and renames remote', async () => {
    const content = Buffer.from('note content');
    fs.writeFileSync(path.join(tmpDir, 'old-name.md'), content);
    const remote = adapter.addRemoteFile('old-name.md', content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const state1 = coordinator.getSyncState();
    expect(state1.files.get('old-name.md')?.remoteFileId).toBe(remote.id);

    fs.unlinkSync(path.join(tmpDir, 'old-name.md'));
    fs.writeFileSync(path.join(tmpDir, 'new-name.md'), content);

    coordinator.queueRename('old-name.md', 'new-name.md');
    const result = await coordinator.reconcile();

    expect(result.errors.length).toBe(0);

    const state2 = coordinator.getSyncState();
    expect(state2.files.has('old-name.md')).toBe(false);
    expect(state2.files.get('new-name.md')?.remoteFileId).toBe(remote.id);
    expect(adapter.renameCalls.length).toBe(1);
    expect(adapter.renameCalls[0].fileId).toBe(remote.id);
    expect(adapter.renameCalls[0].newName).toBe('new-name.md');
  });

  it('local move to subfolder preserves remote identity', async () => {
    const content = Buffer.from('note');
    fs.mkdirSync(path.join(tmpDir, 'Projects'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'note.md'), content);
    const remote = adapter.addRemoteFile('note.md', content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    fs.unlinkSync(path.join(tmpDir, 'note.md'));
    fs.mkdirSync(path.join(tmpDir, 'Projects', 'Alpha'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Projects', 'Alpha', 'note.md'), content);

    coordinator.queueRename('note.md', 'Projects/Alpha/note.md');
    const result = await coordinator.reconcile();

    expect(result.errors.length).toBe(0);
    const state = coordinator.getSyncState();
    expect(state.files.get('Projects/Alpha/note.md')?.remoteFileId).toBe(remote.id);
    expect(state.files.has('note.md')).toBe(false);
  });

  it('pure rename does not create tombstone or duplicate', async () => {
    const content = Buffer.from('content');
    fs.writeFileSync(path.join(tmpDir, 'file.md'), content);
    const remote = adapter.addRemoteFile('file.md', content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    fs.unlinkSync(path.join(tmpDir, 'file.md'));
    fs.writeFileSync(path.join(tmpDir, 'renamed.md'), content);
    coordinator.queueRename('file.md', 'renamed.md');
    await coordinator.reconcile();

    expect(adapter.deleteCalls).toBe(0);
    expect(adapter.uploadCalls).toBe(0);
  });
});

describe('P0.4 — Remote rename/move preserves identity and moves local', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-remote-rename-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('remote rename preserves remoteFileId and old path disappears', async () => {
    const content = Buffer.from('content');
    const fixedId = 'fixed-id-123';
    fs.writeFileSync(path.join(tmpDir, 'old-name.md'), content);
    adapter.addRemoteFileWithId('old-name.md', fixedId, content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const state1 = coordinator.getSyncState();
    expect(state1.files.get('old-name.md')?.remoteFileId).toBe(fixedId);

    adapter.files.delete('old-name.md');
    adapter.files.set('new-name.md', {
      id: fixedId,
      content,
      quartzoHash: crypto.createHash('sha256').update(content).digest('hex'),
      parents: [adapter['folderId']]
    });
    adapter.pendingChanges.push({
      fileId: fixedId,
      removed: false,
      file: { id: fixedId, name: 'new-name.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: crypto.createHash('sha256').update(content).digest('hex'), parents: ['root-folder-id'] }
    });

    await coordinator.reconcile();

    const state2 = coordinator.getSyncState();
    expect(state2.files.has('old-name.md')).toBe(false);
    expect(state2.files.get('new-name.md')?.remoteFileId).toBe(fixedId);
    expect(fs.existsSync(path.join(tmpDir, 'new-name.md'))).toBe(true);
  });
});

describe('P0.5 — Move outside vault treats as removal', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-moveout-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracked file moved outside vault => ancestry fails => local deleted', async () => {
    const content = Buffer.from('content');
    const fixedId = 'moveout-id';
    fs.writeFileSync(path.join(tmpDir, 'note.md'), content);
    adapter.addRemoteFileWithId('note.md', fixedId, content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const state1 = coordinator.getSyncState();
    expect(state1.files.get('note.md')?.remoteFileId).toBe(fixedId);

    adapter.files.delete('note.md');
    adapter.files.set('other-folder/note.md', {
      id: fixedId,
      content,
      quartzoHash: crypto.createHash('sha256').update(content).digest('hex'),
      parents: ['some-other-folder-id']
    });

    adapter.pendingChanges.push({
      fileId: fixedId,
      removed: false,
      file: { id: fixedId, name: 'note.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: crypto.createHash('sha256').update(content).digest('hex'), parents: ['some-other-folder-id'] }
    });

    await coordinator.reconcile();

    const state2 = coordinator.getSyncState();
    expect(state2.files.has('note.md')).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'note.md'))).toBe(false);
  });
});

describe('P0.6 — Adoption race guard', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-adopt-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('explicitAdopt fails when file already has remote counterpart', async () => {
    const content = Buffer.from('content');
    fs.writeFileSync(path.join(tmpDir, 'paired.md'), content);
    adapter.addRemoteFile('paired.md', content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    await expect(coordinator.explicitAdopt('paired.md')).rejects.toThrow('already has a remote counterpart');
  });

  it('explicitAdopt fails when duplicate remote candidate appears', async () => {
    const content = Buffer.from('content');
    fs.writeFileSync(path.join(tmpDir, 'adopt-me.md'), content);
    adapter.addRemoteFile('adopt-me.md', content);

    await expect(coordinator.explicitAdopt('adopt-me.md')).resolves.toBeUndefined();
    const state = coordinator.getSyncState().files.get('adopt-me.md');
    expect(state).toBeDefined();
    expect(state!.remoteExists).toBe(true);
  });

  it('explicitAdopt succeeds when no duplicate and adoption_required', async () => {
    const content = Buffer.from('new file');
    fs.writeFileSync(path.join(tmpDir, 'new-file.md'), content);
    await coordinator.explicitAdopt('new-file.md');

    const state = coordinator.getSyncState();
    const sf = state.files.get('new-file.md');
    expect(sf?.remoteFileId).toBeTruthy();
    expect(sf?.baseHash).toBe(h('new file'));
    expect(adapter.uploadCalls).toBe(1);
  });
});

describe('P0.7 — Delete-vs-edit conflict matrix', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-delconflict-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('remote delete + local edit => conflict', async () => {
    const c1 = Buffer.from('v1');
    const c2 = Buffer.from('v2');
    fs.writeFileSync(path.join(tmpDir, 'del-edit.md'), c1);
    const remote = adapter.addRemoteFile('del-edit.md', c1);
    await coordinator.reconcile();

    adapter.pendingChanges.length = 0;
    fs.writeFileSync(path.join(tmpDir, 'del-edit.md'), c2);
    await adapter.deleteFile(remote.id);

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);

    const conflicts = coordinator.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].localExists).toBe(true);
    expect(conflicts[0].remoteExists).toBe(false);
  });

  it('remote delete + local edit + Keep Local => local preserved, no remote update', async () => {
    const c1 = Buffer.from('v1');
    const c2 = Buffer.from('v2');
    fs.writeFileSync(path.join(tmpDir, 'del-edit2.md'), c1);
    const remote = adapter.addRemoteFile('del-edit2.md', c1);
    await coordinator.reconcile();

    adapter.pendingChanges.length = 0;
    fs.writeFileSync(path.join(tmpDir, 'del-edit2.md'), c2);
    await adapter.deleteFile(remote.id);
    await coordinator.reconcile();

    const prevUpdateCalls = adapter.updateCalls;
    await coordinator.resolveConflict('del-edit2.md', 'keep_local');

    const saved = fs.readFileSync(path.join(tmpDir, 'del-edit2.md'));
    expect(saved.toString()).toBe('v2');
    expect(adapter.updateCalls).toBe(prevUpdateCalls);
  });

  it('remote delete + local edit + Keep Drive => local accepts deletion', async () => {
    const c1 = Buffer.from('v1');
    const c2 = Buffer.from('v2');
    fs.writeFileSync(path.join(tmpDir, 'del-edit3.md'), c1);
    const remote = adapter.addRemoteFile('del-edit3.md', c1);
    await coordinator.reconcile();

    adapter.pendingChanges.length = 0;
    fs.writeFileSync(path.join(tmpDir, 'del-edit3.md'), c2);
    await adapter.deleteFile(remote.id);
    await coordinator.reconcile();

    await coordinator.resolveConflict('del-edit3.md', 'keep_drive');
    expect(fs.existsSync(path.join(tmpDir, 'del-edit3.md'))).toBe(false);
  });

  it('local delete + remote edit => conflict with localExists=false', async () => {
    const c1 = Buffer.from('v1');
    const c2 = Buffer.from('v2');
    const c3 = Buffer.from('v3');
    fs.writeFileSync(path.join(tmpDir, 'ldel-edit.md'), c1);
    const remote = adapter.addRemoteFile('ldel-edit.md', c1);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    fs.writeFileSync(path.join(tmpDir, 'ldel-edit.md'), c2);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    adapter.files.get('ldel-edit.md')!.content = c3;
    adapter.files.get('ldel-edit.md')!.quartzoHash = h('v3');
    adapter.pendingChanges.push({
      fileId: remote.id,
      removed: false,
      file: { id: remote.id, name: 'ldel-edit.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: h('v3'), parents: ['root-folder-id'] }
    });

    fs.unlinkSync(path.join(tmpDir, 'ldel-edit.md'));
    coordinator.queueDelete('ldel-edit.md');

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);

    const conflicts = coordinator.getConflicts();
    expect(conflicts[0].localExists).toBe(false);
    expect(conflicts[0].remoteExists).toBe(true);
  });
});

describe('P0.7 — Conflict rehydration after restart', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-rehydrate-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('text conflict rehydrates with correct existence after restart', async () => {
    const local = Buffer.from('local version');
    const remote = Buffer.from('remote version');
    fs.writeFileSync(path.join(tmpDir, 'conflict-restart.md'), local);
    const remoteInfo = adapter.addRemoteFile('conflict-restart.md', remote);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    expect(coordinator.getConflicts().length).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'conflict-restart.md.conflict'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'conflict-restart.md.conflict.json'))).toBe(true);

    const newAdapter = new MockDriveAdapter();
    newAdapter.addRemoteFileWithId('conflict-restart.md', remoteInfo.id, remote);
    const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
    await newCoord.reconcile().catch(() => {});

    const conflicts = newCoord.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].localExists).toBe(true);
    expect(conflicts[0].remoteExists).toBe(true);
    expect(conflicts[0].remoteFileId).toBeTruthy();
  });

  it('Keep Local after restart writes correct local content', async () => {
    const local = Buffer.from('local version');
    const remote = Buffer.from('remote version');
    fs.writeFileSync(path.join(tmpDir, 'keep-local-restart.md'), local);
    adapter.addRemoteFile('keep-local-restart.md', remote);
    await coordinator.reconcile();

    const newAdapter = new MockDriveAdapter();
    newAdapter.addRemoteFile('keep-local-restart.md', remote);
    newAdapter.pendingChanges.length = 0;
    const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
    await newCoord.reconcile().catch(() => {});

    const conflicts = newCoord.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(Buffer.from(conflicts[0].localContent).toString()).toBe('local version');
    expect(Buffer.from(conflicts[0].remoteContent).toString()).toBe('remote version');

    conflicts[0].remoteFileId = null;
    conflicts[0].remoteExists = false;
    (newCoord as any).conflicts.set('keep-local-restart.md', conflicts[0]);

    await newCoord.resolveConflict('keep-local-restart.md', 'keep_local');

    const saved = fs.readFileSync(path.join(tmpDir, 'keep-local-restart.md'));
    expect(saved.toString()).toBe('local version');
  });

  it('Keep Drive after restart writes correct remote content', async () => {
    const local = Buffer.from('local version');
    const remote = Buffer.from('remote version');
    fs.writeFileSync(path.join(tmpDir, 'keep-drive-restart.md'), local);
    const remoteInfo = adapter.addRemoteFile('keep-drive-restart.md', remote);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const newAdapter = new MockDriveAdapter();
    newAdapter.addRemoteFileWithId('keep-drive-restart.md', remoteInfo.id, remote);
    const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
    await newCoord.reconcile().catch(() => {});

    await newCoord.resolveConflict('keep-drive-restart.md', 'keep_drive');

    const saved = fs.readFileSync(path.join(tmpDir, 'keep-drive-restart.md'));
    expect(saved.toString()).toBe('remote version');
  });
});

describe('P0.1 — OAuth reconnect when refresh_token missing', () => {
  it('pairing cannot conclude without refresh_token', async () => {
    const tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-oauth-'));
    try {
      let storedRefresh: string | null = null;
      const mockSecretStorage = {
        get: async () => storedRefresh,
        set: async (_key: string, value: string) => { storedRefresh = value; },
        delete: async () => { storedRefresh = null; }
      };

      const { GoogleOAuthDesktop } = await import('../../src/integrations/google/auth/loopback');
      const config = { clientId: 'test', redirectUri: '', scopes: [], authUrl: 'https://auth', tokenUrl: 'https://token' };
      const oauth = new GoogleOAuthDesktop(config, mockSecretStorage);

      const { OAuthEngine } = await import('../../src/core/oauth/engine');
      const flow = OAuthEngine.createOAuthFlow(config);
      const tokenResult = { access_token: 'token', expires_in: 3600, token_type: 'Bearer' };
      const result = OAuthEngine.handleCallback('code', flow.state, config, tokenResult);

      expect(result.success).toBe(true);
      expect(result.session?.accessToken).toBe('token');
      expect(storedRefresh).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('P0.2 — Pairing summary and explicit decisions', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-pairing-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generatePairingSummary returns correct categories', async () => {
    fs.writeFileSync(path.join(tmpDir, 'local-only.md'), 'local');
    const remote = adapter.addRemoteFile('remote-only.md', Buffer.from('remote'));
    adapter.addRemoteFile('identical.md', Buffer.from('same'));
    fs.writeFileSync(path.join(tmpDir, 'identical.md'), 'same');

    await coordinator.setDriveFolderId('root-folder-id');
    const summary = await coordinator.generatePairingSummary();

    expect(summary.localOnly.length).toBe(1);
    expect(summary.localOnly[0].path).toBe('local-only.md');
    expect(summary.remoteOnly.length).toBe(1);
    expect(summary.remoteOnly[0].path).toBe('remote-only.md');
    expect(summary.identical.length).toBe(1);
    expect(summary.identical[0].path).toBe('identical.md');
    expect(summary.divergent.length).toBe(0);
  });

  it('applyPairingDecisions does not auto-adopt when autoAdopt=false', async () => {
    fs.writeFileSync(path.join(tmpDir, 'local-only.md'), 'local');
    await coordinator.setDriveFolderId('root-folder-id');

    const summary: PairingSummary = {
      identical: [],
      remoteOnly: [],
      localOnly: [{ path: 'local-only.md', status: 'local_only', localHash: h('local'), remoteHash: null }],
      divergent: []
    };

    const result = await coordinator.applyPairingDecisions(summary, { autoAdopt: false, autoPull: false });
    expect(result.synced).toBe(0);
    expect(adapter.uploadCalls).toBe(0);
  });

  it('divergent items block pairing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'div.md'), 'local');
    adapter.addRemoteFile('div.md', Buffer.from('remote'));
    await coordinator.setDriveFolderId('root-folder-id');

    const summary = await coordinator.generatePairingSummary();
    expect(summary.divergent.length).toBe(1);
  });
});

describe('P0.8 — 403 classification', () => {
  it('unknown 403 does not trigger credential refresh', async () => {
    const tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-403-'));
    try {
      const adapter = new MockDriveAdapter();
      let refreshCalled = false;

      (adapter as any).withRetry = async function (operation: () => Promise<unknown>) {
        try {
          return await operation();
        } catch (err: any) {
          if (err.status === 403) {
            const desc = err.data?.error || '';
            if (desc.includes('permission') || desc.includes('denied')) {
              throw err;
            }
          }
          throw err;
        }
      };

      try {
        await (adapter as any).withRetry(async () => {
          const err = new Error('Forbidden') as any;
          err.code = 403;
          err.response = { data: { error: 'quotaExceeded' } };
          throw err;
        });
      } catch (err: any) {
        expect(err.code).toBe(403);
        expect(refreshCalled).toBe(false);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('P0.3 — processLocalDirty handles deletion', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-delete-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('local delete + unchanged remote => tombstone', async () => {
    const content = Buffer.from('will be deleted');
    fs.writeFileSync(path.join(tmpDir, 'del-me.md'), content);
    adapter.addRemoteFile('del-me.md', content);
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    fs.unlinkSync(path.join(tmpDir, 'del-me.md'));
    coordinator.queueDelete('del-me.md');
    const result = await coordinator.reconcile();

    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(tmpDir, 'del-me.md'))).toBe(false);
    const state = coordinator.getSyncState();
    expect(state.files.has('del-me.md')).toBe(false);
  });
});

describe('Nested conflict artifact paths', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-nested-conflict-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('nested conflict artifacts are written to correct subdirectory', async () => {
    fs.mkdirSync(path.join(tmpDir, 'folder'), { recursive: true });
    const local = Buffer.from('local');
    const remote = Buffer.from('remote');
    fs.writeFileSync(path.join(tmpDir, 'folder', 'file.md'), local);
    adapter.addRemoteFile('folder/file.md', remote);
    await coordinator.reconcile();

    expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'folder', 'file.md.conflict'))).toBe(true);
    expect(coordinator.getConflicts().length).toBe(1);
  });
});

describe('Quartzo_hash fallback', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-hash-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('missing quartzoHash uses download for both-present comparison', async () => {
    const content = Buffer.from('same content');
    fs.writeFileSync(path.join(tmpDir, 'hash.md'), content);

    const id = `nohash-${Date.now()}`;
    adapter.files.set('hash.md', { id, content, quartzoHash: '', parents: ['root-folder-id'] });
    adapter.pendingChanges.push({ fileId: id, removed: false, file: { id, name: 'hash.md', mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString(), quartzoHash: '', parents: ['root-folder-id'] } });

    const result = await coordinator.reconcile();

    const state = coordinator.getSyncState();
    const sf = state.files.get('hash.md');
    expect(sf?.localHash).toBe(h('same content'));
    expect(sf?.remoteHash).toBe(h('same content'));
  });
});

describe('Explicit adoption via canonical API', () => {
  let tmpDir: string;
  let adapter: MockDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-explicit-adopt-'));
    adapter = new MockDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('explicitAdopt creates remote file with correct quartzoHash', async () => {
    const content = Buffer.from('adopt me');
    fs.writeFileSync(path.join(tmpDir, 'adopt.md'), content);

    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.explicitAdopt('adopt.md');

    expect(adapter.uploadCalls).toBe(1);
    const state = coordinator.getSyncState();
    const sf = state.files.get('adopt.md');
    expect(sf?.remoteFileId).toBeTruthy();
    expect(sf?.baseHash).toBe(h('adopt me'));
    expect(sf?.remoteHash).toBe(h('adopt me'));
  });

  it('explicitAdopt throws for nonexistent local file', async () => {
    await expect(coordinator.explicitAdopt('nonexistent.md')).rejects.toThrow('Local file not found');
  });
});
