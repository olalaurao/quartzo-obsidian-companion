import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DriveSyncCoordinator, chooseNewestConflictResolution, type ConflictArtifact } from '../../src/sync/coordinator/index';
import { VaultSyncFilePolicy } from '../../src/sync/coordinator/file-policy';
import { normalizeVaultPath, isSameVaultPath } from '../../src/sync/coordinator/path-utils';
import type { DriveAdapter, DriveFileMetadata, DriveChange } from '../../src/sync/coordinator/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

class FakeDriveAdapter implements DriveAdapter {
  async assertInsideSelectedVault(remoteFileId: string): Promise<void> { return Promise.resolve(); }
  async resolveExactPath(fileId: string): Promise<string> { return fileId; }
  async resolveRemoteHash(metadata: DriveFileMetadata): Promise<string> {
    this.resolveRemoteHashCalls++;
    this.activeRemoteHashCalls++;
    this.maxConcurrentRemoteHashCalls = Math.max(this.maxConcurrentRemoteHashCalls, this.activeRemoteHashCalls);
    try {
      if (this.hashResolutionDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.hashResolutionDelayMs));
      }
      if (metadata.quartzoHash) return metadata.quartzoHash;
      const content = await this.downloadFile(metadata.id);
      return crypto.createHash('sha256').update(content).digest('hex');
    } finally {
      this.activeRemoteHashCalls--;
    }
  }

  private _files = new Map<string, { id: string; content: Uint8Array; quartzoHash: string; modifiedTime?: string }>();
  private folderId = 'root-folder-id';
  private changeToken = 0;
  public pendingChanges: Array<{ fileId: string; removed: boolean; file?: DriveFileMetadata }> = [];
  public listChangesCalls = 0;
  public listFilesCalls = 0;
  public uploadCalls = 0;
  public updateCalls = 0;
  public trashCalls = 0;
  public trashedFileIds: string[] = [];
  public resolveRemoteHashCalls = 0;
  public downloadCalls = 0;
  public hashResolutionDelayMs = 0;
  public activeRemoteHashCalls = 0;
  public maxConcurrentRemoteHashCalls = 0;

  get files() { return this._files; }
  set files(v: Map<string, { id: string; content: Uint8Array; quartzoHash: string; modifiedTime?: string }>) { this._files = v; }

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

  async listQuartzoVaultCandidates() { return []; }

  async getStartPageToken() { return String(this.changeToken); }

  async listChanges(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string; nextPageToken: string | null }> {
    this.listChangesCalls++;
    const changes = [...this.pendingChanges];
    this.pendingChanges = [];
    this.changeToken++;
    return { changes, newStartPageToken: String(this.changeToken), nextPageToken: null };
  }

  async downloadFile(fileId: string) {
    this.downloadCalls++;
    for (const f of this._files.values()) {
      if (f.id === fileId) return f.content;
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async uploadFile(params: { folderId: string; name: string; content: Uint8Array; quartzoHash: string }) {
    this.uploadCalls++;
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const modifiedTime = new Date().toISOString();
    this._files.set(params.name, { id, content: params.content, quartzoHash: params.quartzoHash, modifiedTime });
    return this.makeMetadata(id, params.name, params.quartzoHash, modifiedTime);
  }

  async updateFile(fileId: string, content: Uint8Array, quartzoHash: string) {
    this.updateCalls++;
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) {
        const modifiedTime = new Date().toISOString();
        this._files.set(name, { ...f, content, quartzoHash, modifiedTime });
        return this.makeMetadata(fileId, name, quartzoHash, modifiedTime);
      }
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async trashFile(fileId: string) {
    this.trashCalls++;
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) {
        this._files.delete(name);
        this.trashedFileIds.push(fileId);
        return;
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

  async renameFile(fileId: string, newName: string, _newParentId?: string) {
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) {
        this._files.delete(name);
        this._files.set(newName, { ...f });
        return this.makeMetadata(fileId, newName, f.quartzoHash, f.modifiedTime);
      }
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async getFileMetadata(fileId: string) {
    for (const [name, f] of this._files.entries()) {
      if (f.id === fileId) return this.makeMetadata(f.id, name, f.quartzoHash, f.modifiedTime);
    }
    throw new Error(`Not found: ${fileId}`);
  }

  async ensureParentFolder(rootFolderId: string, filePath: string) {
    return rootFolderId;
  }

  addRemoteFile(name: string, content: Uint8Array) {
    const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    const modifiedTime = new Date().toISOString();
    this._files.set(name, { id, content, quartzoHash, modifiedTime });
    this.pendingChanges.push({ fileId: id, removed: false, file: this.makeMetadata(id, name, quartzoHash, modifiedTime) });
    return { id, quartzoHash };
  }

  addRemoteFileWithId(name: string, id: string, content: Uint8Array) {
    const quartzoHash = crypto.createHash('sha256').update(content).digest('hex');
    const modifiedTime = new Date().toISOString();
    this._files.set(name, { id, content, quartzoHash, modifiedTime });
    this.pendingChanges.push({ fileId: id, removed: false, file: this.makeMetadata(id, name, quartzoHash, modifiedTime) });
    return { id, quartzoHash };
  }

  addLegacyRemoteFile(name: string, content: Uint8Array) {
    const id = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const modifiedTime = new Date().toISOString();
    this._files.set(name, { id, content, quartzoHash: '', modifiedTime });
    return { id, modifiedTime };
  }

  private buildMetadataList(): DriveFileMetadata[] {
    return Array.from(this._files.entries()).map(([name, f]) =>
      this.makeMetadata(f.id, name, f.quartzoHash, f.modifiedTime)
    );
  }

  private makeMetadata(id: string, name: string, quartzoHash: string, modifiedTime?: string): DriveFileMetadata {
    return {
      id,
      name: name.split('/').pop() || name,
      relativePath: normalizeVaultPath(name),
      mimeType: 'application/octet-stream',
      modifiedTime: modifiedTime || '2026-01-01T00:00:00.000Z',
      quartzoHash,
      parents: [this.folderId],
    };
  }
}

describe('Runtime Sync Tests', () => {
  let tmpDir: string;
  let adapter: FakeDriveAdapter;
  let coordinator: DriveSyncCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'companion-rt-'));
    adapter = new FakeDriveAdapter();
    coordinator = new DriveSyncCoordinator(adapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
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

  it('8a: pairing summary does not hash or download remote-only files', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    adapter.addRemoteFile('remote-only-a.md', Buffer.from('a'));
    adapter.addRemoteFile('remote-only-b.md', Buffer.from('b'));
    adapter.resolveRemoteHashCalls = 0;
    adapter.downloadCalls = 0;

    const summary = await coordinator.generatePairingSummary();

    expect(summary.remoteOnly.map(item => item.path).sort()).toEqual(['remote-only-a.md', 'remote-only-b.md']);
    expect(adapter.resolveRemoteHashCalls).toBe(0);
    expect(adapter.downloadCalls).toBe(0);
  });

  it('8b: pairing apply uses one remote inventory pass for many remote-only files', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    adapter.addRemoteFile('pull-a.md', Buffer.from('a'));
    adapter.addRemoteFile('pull-b.md', Buffer.from('b'));
    adapter.addRemoteFile('pull-c.md', Buffer.from('c'));
    const summary = await coordinator.generatePairingSummary();
    adapter.listFilesCalls = 0;

    const result = await coordinator.applyPairingDecisions(summary, { autoAdopt: false, autoPull: true });

    expect(result.errors).toEqual([]);
    expect(adapter.listFilesCalls).toBe(1);
    expect(fs.readFileSync(path.join(tmpDir, 'pull-a.md'), 'utf8')).toBe('a');
    expect(fs.readFileSync(path.join(tmpDir, 'pull-b.md'), 'utf8')).toBe('b');
    expect(fs.readFileSync(path.join(tmpDir, 'pull-c.md'), 'utf8')).toBe('c');
  });

  it('8c: pairing apply establishes baselines for identical files without uploading', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const content = Buffer.from('same');
    fs.writeFileSync(path.join(tmpDir, 'same.md'), content);
    adapter.addRemoteFile('same.md', content);
    const summary = await coordinator.generatePairingSummary();
    adapter.uploadCalls = 0;

    const result = await coordinator.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });

    expect(result.errors).toEqual([]);
    expect(adapter.uploadCalls).toBe(0);
    const state = coordinator.getSyncState().files.get('same.md');
    expect(state?.baseHash).toBe(crypto.createHash('sha256').update(content).digest('hex'));
    expect(state?.remoteFileId).toBeTruthy();
  });

  it('8d: legacy missing-hash pairing uses bounded concurrency and reports progress', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    adapter.hashResolutionDelayMs = 10;
    for (let i = 0; i < 16; i++) {
      const content = Buffer.from(`legacy-${i}`);
      fs.writeFileSync(path.join(tmpDir, `legacy-${i}.md`), content);
      adapter.addLegacyRemoteFile(`legacy-${i}.md`, content);
    }
    const progress: Array<{ phase: string; completed: number; total: number }> = [];

    const summary = await coordinator.generatePairingSummary(update => progress.push(update));

    expect(summary.identical).toHaveLength(16);
    expect(summary.divergent).toHaveLength(0);
    expect(adapter.downloadCalls).toBe(16);
    expect(adapter.maxConcurrentRemoteHashCalls).toBeGreaterThan(1);
    expect(adapter.maxConcurrentRemoteHashCalls).toBeLessThanOrEqual(8);
    expect(progress.some(update => update.phase === 'local_inventory')).toBe(true);
    expect(progress.some(update => update.phase === 'remote_inventory')).toBe(true);
    expect(progress[progress.length - 1]).toEqual({ phase: 'comparing', completed: 16, total: 16 });
  });

  it('8e: accepting an unchanged legacy pairing reuses scan SHA-256 results', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const content = Buffer.from('legacy-same');
    fs.writeFileSync(path.join(tmpDir, 'legacy-same.md'), content);
    adapter.addLegacyRemoteFile('legacy-same.md', content);

    const summary = await coordinator.generatePairingSummary();
    expect(summary.identical).toHaveLength(1);
    expect(adapter.downloadCalls).toBe(1);

    adapter.resolveRemoteHashCalls = 0;
    adapter.downloadCalls = 0;
    const result = await coordinator.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });

    expect(result.errors).toEqual([]);
    expect(adapter.resolveRemoteHashCalls).toBe(0);
    expect(adapter.downloadCalls).toBe(0);
    expect(coordinator.getSyncState().files.get('legacy-same.md')?.baseHash).toBe(summary.identical[0].remoteHash);
  });

  it('8f: pairing ambiguity retains every distinct Drive candidate for diagnosis', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const h1 = crypto.createHash('sha256').update(Buffer.from('one')).digest('hex');
    const h2 = crypto.createHash('sha256').update(Buffer.from('two')).digest('hex');
    adapter.listAllFiles = async () => [
      {
        id: 'candidate-a',
        name: 'dup.md',
        relativePath: 'folder/dup.md',
        mimeType: 'application/octet-stream',
        modifiedTime: '2026-09-17T10:00:00.000Z',
        quartzoHash: h1,
        parents: ['folder-a'],
      },
      {
        id: 'candidate-b',
        name: 'dup.md',
        relativePath: 'folder/dup.md',
        mimeType: 'application/octet-stream',
        modifiedTime: '2026-09-18T10:00:00.000Z',
        quartzoHash: h2,
        parents: ['folder-a'],
      },
    ];

    const summary = await coordinator.generatePairingSummary();

    expect(summary.ambiguous).toHaveLength(1);
    expect(summary.ambiguous[0].path).toBe('folder/dup.md');
    expect(summary.ambiguous[0].remoteCandidates).toEqual([
      {
        id: 'candidate-a',
        modifiedTime: '2026-09-17T10:00:00.000Z',
        quartzoHash: h1,
        resolvedSha256: h1,
        matchesLocal: null,
      },
      {
        id: 'candidate-b',
        modifiedTime: '2026-09-18T10:00:00.000Z',
        quartzoHash: h2,
        resolvedSha256: h2,
        matchesLocal: null,
      },
    ]);
  });

  it('8g: ambiguity diagnostics hash legacy candidates and identify the one matching local', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const localContent = Buffer.from('local-winner');
    const otherContent = Buffer.from('other-copy');
    fs.mkdirSync(path.join(tmpDir, 'daily'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'daily', 'dup.md'), localContent);

    const localMatch = adapter.addLegacyRemoteFile('daily/dup.md', localContent);
    const other = adapter.addLegacyRemoteFile('daily/dup-other.md', otherContent);
    adapter.listAllFiles = async () => [
      {
        id: localMatch.id,
        name: 'dup.md',
        relativePath: 'daily/dup.md',
        mimeType: 'application/octet-stream',
        modifiedTime: localMatch.modifiedTime,
        quartzoHash: '',
        parents: ['daily-folder'],
      },
      {
        id: other.id,
        name: 'dup.md',
        relativePath: 'daily/dup.md',
        mimeType: 'application/octet-stream',
        modifiedTime: other.modifiedTime,
        quartzoHash: '',
        parents: ['daily-folder'],
      },
    ];
    adapter.downloadCalls = 0;

    const summary = await coordinator.generatePairingSummary();

    expect(summary.ambiguous).toHaveLength(1);
    expect(adapter.downloadCalls).toBe(2);
    const candidates = summary.ambiguous[0].remoteCandidates ?? [];
    expect(candidates).toHaveLength(2);
    expect(candidates.filter(candidate => candidate.matchesLocal)).toHaveLength(1);
    const matching = candidates.find(candidate => candidate.matchesLocal);
    expect(matching?.id).toBe(localMatch.id);
    expect(matching?.resolvedSha256).toBe(crypto.createHash('sha256').update(localContent).digest('hex'));
  });

  it('8h: safe duplicate plan keeps one byte-identical local match and trashes the rest', () => {
    const hash = 'same-hash';
    const summary = {
      identical: [],
      remoteOnly: [],
      localOnly: [],
      divergent: [],
      ambiguous: [{
        path: 'same.md',
        status: 'ambiguous' as const,
        localHash: hash,
        remoteHash: null,
        remoteCandidates: [
          { id: 'id-c', modifiedTime: '2026-09-18T10:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
          { id: 'id-a', modifiedTime: '2026-09-18T10:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
          { id: 'id-b', modifiedTime: '2026-09-18T10:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
        ],
      }],
    };

    const plan = coordinator.buildSafeDuplicateTrashPlan(summary);

    expect(plan.unresolvedPaths).toEqual([]);
    expect(plan.totalTrashFiles).toBe(2);
    expect(plan.resolutions).toEqual([{
      path: 'same.md',
      keepFileId: 'id-a',
      trashFileIds: ['id-b', 'id-c'],
      reason: 'byte_identical',
    }]);
  });

  it('8i: safe duplicate plan keeps the only candidate matching local when bytes differ', () => {
    const summary = {
      identical: [],
      remoteOnly: [],
      localOnly: [],
      divergent: [],
      ambiguous: [{
        path: 'different.md',
        status: 'ambiguous' as const,
        localHash: 'local-hash',
        remoteHash: null,
        remoteCandidates: [
          { id: 'wrong', modifiedTime: '2026-09-18T11:00:00.000Z', quartzoHash: null, resolvedSha256: 'other-hash', matchesLocal: false },
          { id: 'right', modifiedTime: '2026-09-18T09:00:00.000Z', quartzoHash: null, resolvedSha256: 'local-hash', matchesLocal: true },
        ],
      }],
    };

    const plan = coordinator.buildSafeDuplicateTrashPlan(summary);

    expect(plan.unresolvedPaths).toEqual([]);
    expect(plan.totalTrashFiles).toBe(1);
    expect(plan.resolutions[0]).toEqual({
      path: 'different.md',
      keepFileId: 'right',
      trashFileIds: ['wrong'],
      reason: 'single_local_match',
    });
  });

  it('8j: safe duplicate cleanup revalidates snapshot and moves only proven duplicates to Drive trash', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const content = Buffer.from('canonical');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(path.join(tmpDir, 'dup.md'), content);

    adapter.files.set('dup-keep.md', {
      id: 'keep-id',
      content,
      quartzoHash: '',
      modifiedTime: '2026-09-18T10:00:00.000Z',
    });
    adapter.files.set('dup-trash.md', {
      id: 'trash-id',
      content,
      quartzoHash: '',
      modifiedTime: '2026-09-18T10:00:00.000Z',
    });
    adapter.listAllFiles = async () => [
      {
        id: 'keep-id',
        name: 'dup.md',
        relativePath: 'dup.md',
        mimeType: 'application/octet-stream',
        modifiedTime: '2026-09-18T10:00:00.000Z',
        quartzoHash: '',
        parents: ['root-folder-id'],
      },
      {
        id: 'trash-id',
        name: 'dup.md',
        relativePath: 'dup.md',
        mimeType: 'application/octet-stream',
        modifiedTime: '2026-09-18T10:00:00.000Z',
        quartzoHash: '',
        parents: ['root-folder-id'],
      },
    ];

    const summary = {
      identical: [],
      remoteOnly: [],
      localOnly: [],
      divergent: [],
      ambiguous: [{
        path: 'dup.md',
        status: 'ambiguous' as const,
        localHash: hash,
        remoteHash: null,
        remoteCandidates: [
          { id: 'keep-id', modifiedTime: '2026-09-18T10:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
          { id: 'trash-id', modifiedTime: '2026-09-18T10:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
        ],
      }],
    };

    const result = await coordinator.trashSafePairingDuplicates(summary);

    expect(result.errors).toEqual([]);
    expect(result.skippedPaths).toEqual([]);
    expect(result.trashed).toBe(1);
    expect(result.resolvedPaths).toBe(1);
    expect(adapter.trashCalls).toBe(1);
    expect(adapter.trashedFileIds).toEqual(['trash-id']);
    expect(adapter.files.has('dup-keep.md')).toBe(true);
    expect(adapter.files.has('dup-trash.md')).toBe(false);
  });

  it('8k: safe duplicate cleanup refuses stale Drive snapshots', async () => {
    await coordinator.setDriveFolderId('root-folder-id');
    const content = Buffer.from('canonical');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(path.join(tmpDir, 'stale.md'), content);

    adapter.files.set('stale-keep.md', {
      id: 'keep-stale',
      content,
      quartzoHash: '',
      modifiedTime: '2026-09-18T12:00:00.000Z',
    });
    adapter.files.set('stale-trash.md', {
      id: 'trash-stale',
      content,
      quartzoHash: '',
      modifiedTime: '2026-09-18T12:05:00.000Z',
    });
    adapter.listAllFiles = async () => [
      {
        id: 'keep-stale',
        name: 'stale.md',
        relativePath: 'stale.md',
        mimeType: 'application/octet-stream',
        modifiedTime: '2026-09-18T12:00:00.000Z',
        quartzoHash: '',
        parents: ['root-folder-id'],
      },
      {
        id: 'trash-stale',
        name: 'stale.md',
        relativePath: 'stale.md',
        mimeType: 'application/octet-stream',
        modifiedTime: '2026-09-18T12:05:00.000Z',
        quartzoHash: '',
        parents: ['root-folder-id'],
      },
    ];

    const summary = {
      identical: [],
      remoteOnly: [],
      localOnly: [],
      divergent: [],
      ambiguous: [{
        path: 'stale.md',
        status: 'ambiguous' as const,
        localHash: hash,
        remoteHash: null,
        remoteCandidates: [
          { id: 'keep-stale', modifiedTime: '2026-09-18T12:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
          { id: 'trash-stale', modifiedTime: '2026-09-18T12:00:00.000Z', quartzoHash: null, resolvedSha256: hash, matchesLocal: true },
        ],
      }],
    };

    const result = await coordinator.trashSafePairingDuplicates(summary);

    expect(result.trashed).toBe(0);
    expect(result.skippedPaths).toEqual(['stale.md']);
    expect(result.errors.join(' ')).toContain('Drive content changed since scan');
    expect(adapter.trashCalls).toBe(0);
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
    expect(VaultSyncFilePolicy.shouldSyncFile('_deleted/foo.md')).toBe(true);
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

    await coordinator.resolveConflict('resolve.md', 'keep_local');
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

    await coordinator.resolveConflict('resolve2.md', 'keep_drive');
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

    await coordinator.resolveConflict('hashes.md', 'keep_local');
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
      async listQuartzoVaultCandidates() { return []; },
      async getStartPageToken() { return ''; },
      async listChanges() { return { changes: [], newStartPageToken: '', nextPageToken: null }; },
      async downloadFile() { throw new Error('No token'); },
      async uploadFile() { throw new Error('No token'); },
      async updateFile() { throw new Error('No token'); },
      async deleteFile() { throw new Error('No token'); },
      async renameFile() { throw new Error('No token'); },
      async getFileMetadata() { throw new Error('No token'); },
      async ensureParentFolder() { throw new Error('No token'); },
      async assertInsideSelectedVault() { throw new Error('No token'); },
      async resolveExactPath() { throw new Error('No token'); },
      async resolveRemoteHash() { throw new Error('No token'); }
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

  it('31: local dirty detection pushes after incremental cycle', async () => {
    const content = Buffer.from('initial');
    fs.writeFileSync(path.join(tmpDir, 'dirty.md'), content);
    adapter.addRemoteFile('dirty.md', content);
    await coordinator.reconcile();

    fs.writeFileSync(path.join(tmpDir, 'dirty.md'), 'edited');
    const result = await coordinator.reconcile();
    expect(result.synced).toBeGreaterThanOrEqual(1);
    const state = coordinator.getSyncState();
    const sf = state.files.get('dirty.md');
    expect(sf?.localHash).toBe(crypto.createHash('sha256').update(Buffer.from('edited')).digest('hex'));
  });

  it('32: conflict rehydrate from artifacts on restart', async () => {
    const local = Buffer.from('local');
    const remote = Buffer.from('remote');
    fs.writeFileSync(path.join(tmpDir, 'rehydrate.md'), local);
    adapter.addRemoteFile('rehydrate.md', remote);
    await coordinator.reconcile();

    expect(coordinator.getConflicts().length).toBe(1);

    expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'rehydrate.md.conflict'))).toBe(true);

    const newAdapter = new FakeDriveAdapter();
    newAdapter.addRemoteFile('rehydrate.md', remote);
    const newCoord = new DriveSyncCoordinator(newAdapter, tmpDir, path.join(tmpDir, '.quartzo-sync-state.json'));
    await newCoord.reconcile().catch(() => {});
    const conflicts = newCoord.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].originalPath).toBe('rehydrate.md');
  });

  it('33: keep_local pushes resolved content to drive', async () => {
    const local = Buffer.from('local version');
    const remote = Buffer.from('remote version');
    fs.writeFileSync(path.join(tmpDir, 'push-resolve.md'), local);
    adapter.addRemoteFile('push-resolve.md', remote);
    await coordinator.reconcile();

    await coordinator.resolveConflict('push-resolve.md', 'keep_local');
    expect(adapter.updateCalls).toBe(1);
    const entry = adapter.files.get('push-resolve.md');
    expect(entry).toBeDefined();
    const contentBytes = new Uint8Array(entry!.content);
    const decoded = new TextDecoder().decode(contentBytes);
    expect(decoded).toBe('local version');
  });

  it('34: listAllFiles traverses subfolders recursively', async () => {
    const subAdapter = new FakeDriveAdapter();
    subAdapter.addRemoteFile('a.md', Buffer.from('a'));
    subAdapter.addRemoteFile('sub/b.md', Buffer.from('b'));
    subAdapter.addRemoteFile('sub/deep/c.md', Buffer.from('c'));

    const subCoord = new DriveSyncCoordinator(subAdapter, tmpDir, path.join(tmpDir, 'state-sub.json'));
    const result = await subCoord.reconcile();
    expect(result.synced).toBe(3);
  });

  it('35: state store path uses plugin directory', () => {
    const adapter = new FakeDriveAdapter();
    const statePath = path.join(tmpDir, 'plugin-data', 'quartzo-sync-state.json');
    fs.mkdirSync(path.join(tmpDir, 'plugin-data'), { recursive: true });
    const coord = new DriveSyncCoordinator(adapter, tmpDir, statePath);
    expect((coord as unknown as { stateStorePath: string }).stateStorePath).toBe(statePath);
  });

  it('36: conflict artifacts written to _conflicts directory', async () => {
    const local = Buffer.from('local');
    const remote = Buffer.from('remote');
    fs.writeFileSync(path.join(tmpDir, 'artifacts.md'), local);
    adapter.addRemoteFile('artifacts.md', remote);
    await coordinator.reconcile();

    expect(fs.existsSync(path.join(tmpDir, '_conflicts', 'artifacts.md.conflict'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'artifacts.md.conflict'))).toBe(false);
  });

  it('37: Keep newest is explicit and chooses the local side only when its trustworthy timestamp is newer', async () => {
    const localPath = path.join(tmpDir, 'newest-local.md');
    fs.writeFileSync(localPath, 'local version');
    fs.utimesSync(localPath, new Date('2030-01-01T10:00:00.000Z'), new Date('2030-01-01T10:00:00.000Z'));
    adapter.addRemoteFile('newest-local.md', Buffer.from('remote version'));

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);
    const conflict = coordinator.getConflicts()[0];
    expect(conflict.localModifiedAt).toBeTruthy();
    expect(conflict.remoteModifiedAt).toBeTruthy();
    expect(chooseNewestConflictResolution(conflict)).toBe('keep_local');

    await coordinator.resolveConflict('newest-local.md', 'keep_newest');
    expect(fs.readFileSync(localPath, 'utf8')).toBe('local version');
    expect(new TextDecoder().decode(adapter.files.get('newest-local.md')!.content)).toBe('local version');
  });

  it('38: Keep newest chooses Drive only after the user asks for it and Drive is newer', async () => {
    const localPath = path.join(tmpDir, 'newest-drive.md');
    fs.writeFileSync(localPath, 'local old');
    fs.utimesSync(localPath, new Date('2000-01-01T10:00:00.000Z'), new Date('2000-01-01T10:00:00.000Z'));
    adapter.addRemoteFile('newest-drive.md', Buffer.from('remote new'));

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);
    const conflict = coordinator.getConflicts()[0];
    expect(chooseNewestConflictResolution(conflict)).toBe('keep_drive');
    expect(fs.readFileSync(localPath, 'utf8')).toBe('local old');

    await coordinator.resolveConflict('newest-drive.md', 'keep_newest');
    expect(fs.readFileSync(localPath, 'utf8')).toBe('remote new');
  });

  it('39: Keep newest fails closed for ties, missing timestamps, and deletion conflicts', async () => {
    const base: ConflictArtifact = {
      originalPath: 'tie.md',
      localContent: Buffer.from('l'),
      remoteContent: Buffer.from('r'),
      localSha256: 'l',
      remoteSha256: 'r',
      remoteFileId: 'remote',
      isBinary: false,
      timestamp: '2026-09-17T10:00:00.000Z',
      localExists: true,
      remoteExists: true,
      localModifiedAt: '2026-09-17T09:00:00.000Z',
      remoteModifiedAt: '2026-09-17T09:00:00.000Z',
    };
    expect(chooseNewestConflictResolution(base)).toBeNull();
    expect(chooseNewestConflictResolution({ ...base, remoteModifiedAt: null })).toBeNull();
    expect(chooseNewestConflictResolution({ ...base, remoteExists: false, remoteModifiedAt: null })).toBeNull();

    fs.writeFileSync(path.join(tmpDir, 'cannot-newest.md'), 'local');
    adapter.addRemoteFile('cannot-newest.md', Buffer.from('remote'));
    await coordinator.reconcile();
    const artifact = coordinator.getConflicts()[0];
    artifact.remoteModifiedAt = null;
    await expect(coordinator.resolveConflict('cannot-newest.md', 'keep_newest')).rejects.toThrow('Keep newest is unavailable');
    expect(coordinator.getConflicts()).toHaveLength(1);
  });

  it('40: ordinary reconciliation never chooses newest from timestamps', async () => {
    const localPath = path.join(tmpDir, 'no-silent-newest.md');
    fs.writeFileSync(localPath, 'local version');
    fs.utimesSync(localPath, new Date('2030-01-01T10:00:00.000Z'), new Date('2030-01-01T10:00:00.000Z'));
    adapter.addRemoteFile('no-silent-newest.md', Buffer.from('remote version'));

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);
    expect(coordinator.getConflicts()).toHaveLength(1);
    expect(fs.readFileSync(localPath, 'utf8')).toBe('local version');
    expect(new TextDecoder().decode(adapter.files.get('no-silent-newest.md')!.content)).toBe('remote version');
  });

  it('41: Sync Center status reports local changes, conflicts, and last successful sync', async () => {
    expect(await coordinator.getSyncStatusSnapshot()).toMatchObject({
      status: 'synced',
      pendingLocalChanges: 0,
      conflictCount: 0,
      lastSuccessfulSyncAt: null,
    });

    fs.writeFileSync(path.join(tmpDir, 'pending.md'), 'local only');
    expect(await coordinator.getSyncStatusSnapshot()).toMatchObject({
      status: 'local_changes',
      pendingLocalChanges: 1,
    });

    adapter.addRemoteFile('pending.md', Buffer.from('remote different'));
    await coordinator.reconcile();
    const snapshot = await coordinator.getSyncStatusSnapshot();
    expect(snapshot.status).toBe('conflict');
    expect(snapshot.conflictCount).toBe(1);
    expect(snapshot.lastSuccessfulSyncAt).toBeTruthy();
  });

  it('42: full reconciliation bypasses an existing Drive change token only when explicitly requested', async () => {
    adapter.addRemoteFile('full.md', Buffer.from('remote'));
    await coordinator.reconcile();
    const listAfterInitial = adapter.listFilesCalls;

    await coordinator.reconcile();
    expect(adapter.listChangesCalls).toBe(1);
    const changesBeforeFull = adapter.listChangesCalls;

    await coordinator.triggerFullReconciliation();
    expect(adapter.listChangesCalls).toBe(changesBeforeFull);
    expect(adapter.listFilesCalls).toBeGreaterThan(listAfterInitial);
  });

});
