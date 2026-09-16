from pathlib import Path
import json

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['dependencies']['google-auth-library'] = '10.5.0'
pkg_path.write_text(json.dumps(pkg, indent=2) + '\n', encoding='utf-8')

types_path = Path('src/ui/types.ts')
types = types_path.read_text(encoding='utf-8')
needle = "    driveAdapter: GoogleDriveAdapter | null;\n"
replacement = needle + "    authState: 'disconnected' | 'authenticating' | 'authenticated_unpaired' | 'paired' | 'authentication_required';\n"
if needle not in types:
    raise SystemExit('missing ViewContext driveAdapter field')
types = types.replace(needle, replacement, 1)
types_path.write_text(types, encoding='utf-8')

# These test doubles were mechanically renamed by an earlier change and still
# returned the literal string `raw-hash`. Production now routes every comparison
# through resolveRemoteHash, so a faithful double must prefer metadata and hash
# downloaded bytes only when metadata is absent. Assertions remain unchanged.
old_hash_mock = "  async resolveRemoteHash(metadata: DriveFileMetadata): Promise<string> { return 'raw-hash'; }"
new_hash_mock = """  async resolveRemoteHash(metadata: DriveFileMetadata): Promise<string> {
    if (metadata.quartzoHash) return metadata.quartzoHash;
    const content = await this.downloadFile(metadata.id);
    return crypto.createHash('sha256').update(content).digest('hex');
  }"""
for test_path in [
    Path('tests/sync/runtime.test.ts'),
    Path('tests/sync/regression.test.ts'),
    Path('tests/sync/p0-regression.test.ts'),
]:
    text = test_path.read_text(encoding='utf-8')
    if old_hash_mock not in text:
        raise SystemExit(f'missing stale hash mock in {test_path}')
    test_path.write_text(text.replace(old_hash_mock, new_hash_mock, 1), encoding='utf-8')

# The old regression expected a conflict for a pure remote path transition plus
# a local content edit. The canonical three-way matrix says this is NOT a
# conflict when remote content still equals base: remote ID proves the rename,
# then local B is pushed to that same ID at the new path.
p0_path = Path('tests/sync/p0-regression.test.ts')
p0 = p0_path.read_text(encoding='utf-8')
old_test = """  it('remote rename + local edit -> creates conflict', async () => {
    const contentA = Buffer.from('A');
    const remote = adapter.addRemoteFile('file.md', contentA);
    fs.writeFileSync(path.join(tmpDir, 'file.md'), contentA);
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const sf = coordinator.getSyncState().files.get('file.md')!;
    expect(sf.remoteFileId).toBe(remote.id);

    // Remote rename: rename remote file to 'renamed.md'
    await adapter.renameFile(sf.remoteFileId!, 'renamed.md');
    adapter.pendingChanges.push({
      fileId: sf.remoteFileId!,
      removed: false,
      file: { id: sf.remoteFileId!, name: 'renamed.md', quartzoHash: h('A'), parents: ['root-folder-id'], mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString() }
    });

    // Local edit (file still at old path)
    fs.writeFileSync(path.join(tmpDir, 'file.md'), Buffer.from('B'));

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBeGreaterThan(0);

    const conflicts = coordinator.getConflicts();
    expect(conflicts.length).toBeGreaterThan(0);

    // Old file must not be overwritten — still has 'B' content locally
    expect(fs.existsSync(path.join(tmpDir, 'file.md'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'file.md'), 'utf8')).toBe('B');
  });
"""
new_test = """  it('remote rename + local edit preserves identity and pushes local bytes when remote content is unchanged', async () => {
    const contentA = Buffer.from('A');
    const remote = adapter.addRemoteFile('file.md', contentA);
    fs.writeFileSync(path.join(tmpDir, 'file.md'), contentA);
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const sf = coordinator.getSyncState().files.get('file.md')!;
    expect(sf.remoteFileId).toBe(remote.id);

    await adapter.renameFile(sf.remoteFileId!, 'renamed.md');
    adapter.pendingChanges.push({
      fileId: sf.remoteFileId!,
      removed: false,
      file: { id: sf.remoteFileId!, name: 'renamed.md', quartzoHash: h('A'), parents: ['root-folder-id'], mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString() }
    });
    fs.writeFileSync(path.join(tmpDir, 'file.md'), Buffer.from('B'));

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(0);
    expect(coordinator.getConflicts()).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'file.md'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, 'renamed.md'), 'utf8')).toBe('B');

    const state = coordinator.getSyncState();
    const renamed = state.files.get('renamed.md');
    expect(renamed?.remoteFileId).toBe(remote.id);
    expect(renamed?.localHash).toBe(h('B'));
    expect(renamed?.remoteHash).toBe(h('B'));
    expect(Buffer.from(await adapter.downloadFile(remote.id)).toString()).toBe('B');
  });

  it('remote rename + local edit conflicts when remote content also changed', async () => {
    const contentA = Buffer.from('A');
    const remote = adapter.addRemoteFile('file.md', contentA);
    fs.writeFileSync(path.join(tmpDir, 'file.md'), contentA);
    await coordinator.setDriveFolderId('root-folder-id');
    await coordinator.reconcile();
    adapter.pendingChanges.length = 0;

    const sf = coordinator.getSyncState().files.get('file.md')!;
    await adapter.renameFile(sf.remoteFileId!, 'renamed.md');
    await adapter.updateFile(sf.remoteFileId!, Buffer.from('C'), h('C'));
    adapter.pendingChanges.push({
      fileId: sf.remoteFileId!,
      removed: false,
      file: { id: sf.remoteFileId!, name: 'renamed.md', quartzoHash: h('C'), parents: ['root-folder-id'], mimeType: 'application/octet-stream', modifiedTime: new Date().toISOString() }
    });
    fs.writeFileSync(path.join(tmpDir, 'file.md'), Buffer.from('B'));

    const result = await coordinator.reconcile();
    expect(result.conflicts).toBe(1);
    const conflict = coordinator.getConflicts().find(c => c.originalPath === 'renamed.md');
    expect(conflict).toBeTruthy();
    expect(Buffer.from(conflict!.localContent).toString()).toBe('B');
    expect(Buffer.from(conflict!.remoteContent).toString()).toBe('C');
    expect(conflict!.remoteFileId).toBe(remote.id);
  });
"""
if old_test not in p0:
    raise SystemExit('missing stale remote-rename/local-edit regression')
p0_path.write_text(p0.replace(old_test, new_test, 1), encoding='utf-8')
