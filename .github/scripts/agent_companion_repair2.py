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
