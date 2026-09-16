from pathlib import Path
import json, re


def read(p):
    return Path(p).read_text(encoding='utf-8')

def write(p, s):
    Path(p).write_text(s, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Real upstream contract vendoring/verification. Expected data comes from the
# pinned upstream commit, never from the local vendor candidate.
# ---------------------------------------------------------------------------
sync_contracts = r'''import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import process from 'process';

const UPSTREAM_LOCK_FILE = path.join(process.cwd(), 'contracts', 'UPSTREAM.lock.json');
const CONTRACTS_DIR = path.join(process.cwd(), 'contracts', 'quartzo');
const DOC_ROOT = 'docs/integrations/obsidian_companion/';
const CONTRACT_ROOT = 'contracts/quartzo/';
const DEFAULT_REPOSITORY = 'olalaurao/aplicativo';

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.json();
}

async function getBlob(repository, sha) {
  const blob = await getJson(`https://api.github.com/repos/${repository}/git/blobs/${sha}`);
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    throw new Error(`Unsupported blob encoding for ${sha}`);
  }
  return Buffer.from(blob.content.replace(/\n/g, ''), 'base64');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function walkDir(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function sourceEntries(repository, commit) {
  const commitData = await getJson(`https://api.github.com/repos/${repository}/git/commits/${commit}`);
  const tree = await getJson(`https://api.github.com/repos/${repository}/git/trees/${commitData.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('Upstream tree response is truncated; refusing incomplete contract verification.');

  const entries = new Map();
  for (const item of tree.tree || []) {
    if (item.type !== 'blob' || !item.path || !item.sha) continue;
    let vendorPath = null;
    if (item.path.startsWith(DOC_ROOT)) {
      const rel = item.path.slice(DOC_ROOT.length);
      if (rel && !rel.includes('/')) vendorPath = rel;
    } else if (item.path.startsWith(CONTRACT_ROOT)) {
      const rel = item.path.slice(CONTRACT_ROOT.length);
      // docs/integrations/obsidian_companion/README.md is the Companion-facing
      // README already historically vendored at README.md. Avoid a collision
      // with the internal contracts/quartzo/README.md.
      if (rel && rel !== 'README.md') vendorPath = rel;
    }
    if (!vendorPath) continue;
    if (entries.has(vendorPath)) {
      throw new Error(`Upstream contract mapping collision for ${vendorPath}`);
    }
    entries.set(vendorPath, { sourcePath: item.path, blobSha: item.sha });
  }
  if (!entries.has('contract_manifest.json') || !entries.has('QUARTZO_SYNC_PROTOCOL_V1.md')) {
    throw new Error('Required upstream contract files are missing.');
  }
  return entries;
}

function readLock() {
  if (!fs.existsSync(UPSTREAM_LOCK_FILE)) throw new Error('No UPSTREAM.lock.json found.');
  return JSON.parse(fs.readFileSync(UPSTREAM_LOCK_FILE, 'utf8'));
}

function localManifest() {
  const manifest = {};
  for (const file of walkDir(CONTRACTS_DIR)) {
    const rel = path.relative(CONTRACTS_DIR, file).replace(/\\/g, '/');
    manifest[rel] = sha256(fs.readFileSync(file));
  }
  return manifest;
}

async function sync(commit) {
  if (!commit) throw new Error('Provide a commit hash: node scripts/sync-contracts.mjs sync <commit>');
  const repository = DEFAULT_REPOSITORY;
  const entries = await sourceEntries(repository, commit);

  fs.rmSync(CONTRACTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });

  const manifest = {};
  const sources = {};
  for (const [vendorPath, source] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = await getBlob(repository, source.blobSha);
    const target = path.join(CONTRACTS_DIR, ...vendorPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    manifest[vendorPath] = sha256(bytes);
    sources[vendorPath] = source.sourcePath;
  }

  const versions = JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, 'contract_manifest.json'), 'utf8'));
  const lock = {
    repository,
    sourceCommit: commit,
    syncTimestamp: new Date().toISOString(),
    contractVersions: versions,
    sources,
    manifest
  };
  fs.writeFileSync(UPSTREAM_LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
  console.log(`PASS: vendored ${Object.keys(manifest).length} files from ${repository}@${commit}`);
}

async function verify() {
  const lock = readLock();
  if (!lock.repository || !lock.sourceCommit || !lock.manifest || !lock.sources) {
    throw new Error('UPSTREAM.lock.json is missing repository/sourceCommit/manifest/sources.');
  }
  const upstream = await sourceEntries(lock.repository, lock.sourceCommit);
  const upstreamKeys = [...upstream.keys()].sort();
  const lockedKeys = Object.keys(lock.manifest).sort();
  const sourceKeys = Object.keys(lock.sources).sort();
  const current = localManifest();
  const currentKeys = Object.keys(current).sort();

  const sameKeys = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!sameKeys(upstreamKeys, lockedKeys) || !sameKeys(lockedKeys, sourceKeys)) {
    throw new Error('Locked contract set does not exactly match the pinned upstream contract set.');
  }
  if (!sameKeys(lockedKeys, currentKeys)) {
    throw new Error('Local vendor tree has missing or extra contract files.');
  }

  for (const vendorPath of lockedKeys) {
    const source = upstream.get(vendorPath);
    if (!source || lock.sources[vendorPath] !== source.sourcePath) {
      throw new Error(`Source path mismatch for ${vendorPath}`);
    }
    const upstreamBytes = await getBlob(lock.repository, source.blobSha);
    const upstreamHash = sha256(upstreamBytes);
    if (lock.manifest[vendorPath] !== upstreamHash) {
      throw new Error(`Lock hash does not match upstream bytes for ${vendorPath}`);
    }
    if (current[vendorPath] !== upstreamHash) {
      throw new Error(`Vendored file differs from upstream for ${vendorPath}`);
    }
  }

  const manifestVersions = JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, 'contract_manifest.json'), 'utf8'));
  if (JSON.stringify(manifestVersions) !== JSON.stringify(lock.contractVersions)) {
    throw new Error('Contract versions in lock differ from upstream contract_manifest.json.');
  }
  console.log(`PASS: ${lockedKeys.length} contracts verified byte-for-byte against ${lock.repository}@${lock.sourceCommit}`);
}

const [command, commit] = process.argv.slice(2);
try {
  if (command === 'sync') await sync(commit);
  else if (command === 'verify') await verify();
  else throw new Error('Usage: node scripts/sync-contracts.mjs <sync COMMIT|verify>');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
'''
write('scripts/sync-contracts.mjs', sync_contracts)

# ---------------------------------------------------------------------------
# Pin a Node-20-compatible Google stack. @googleapis/drive 21 uses
# googleapis-common 8 (Node 18+) and is compatible with google-auth-library 10.
# npm install in the workflow regenerates package-lock and proves engines/types.
# ---------------------------------------------------------------------------
pkg = json.loads(read('package.json'))
pkg['dependencies']['@googleapis/drive'] = '21.0.0'
pkg['dependencies']['google-auth-library'] = '10.3.0'
pkg['dependencies'].pop('googleapis-common', None)
pkg['scripts']['audit:prod'] = 'npm audit --omit=dev --audit-level=high'
write('package.json', json.dumps(pkg, indent=2) + '\n')

# ---------------------------------------------------------------------------
# Drive adapter: shared properties, exact query handling, fail-closed duplicate
# folder segments, boundary guards, and idempotent non-idempotent creates.
# ---------------------------------------------------------------------------
adapter_path = 'src/integrations/google/drive/adapter.ts'
adapter = read(adapter_path)
adapter = adapter.replace("appProperties: {\n            Quartzo_hash: quartzoHash\n          }", "properties: {\n            Quartzo_hash: quartzoHash\n          }")

start = adapter.index('  async ensureParentFolder(')
end = adapter.index('  async deleteFile(', start)
replacement = r'''  private errorStatus(error: unknown): number | undefined {
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

'''
adapter = adapter[:start] + replacement + adapter[end:]

adapter = replace_once(adapter,
"  async deleteFile(fileId: string): Promise<void> {\n    return this.withRetry(async () => {",
"  async deleteFile(fileId: string): Promise<void> {\n    await this.assertInsideSelectedVault(fileId);\n    return this.withRetry(async () => {",
'delete boundary guard')
adapter = replace_once(adapter,
"  async renameFile(fileId: string, newName: string, newParentId?: string): Promise<DriveFileMetadata> {\n    return this.withRetry(async () => {",
"  async renameFile(fileId: string, newName: string, newParentId?: string): Promise<DriveFileMetadata> {\n    await this.assertInsideSelectedVault(fileId);\n    if (newParentId) await this.assertInsideSelectedVault(newParentId);\n    return this.withRetry(async () => {",
'rename boundary guard')
write(adapter_path, adapter)

# ---------------------------------------------------------------------------
# Coordinator safety: real coalescing, remote-hash fallback in incremental
# changes, duplicate-path quarantine, remote-rename three-way behavior,
# expected-write watcher suppression, and atomic device-local state writes.
# ---------------------------------------------------------------------------
coord_path = 'src/sync/coordinator/index.ts'
coord = read(coord_path)
coord = coord.replace('  private syncQueue: Array<() => Promise<void>> = [];', '''  private syncRerunRequested = false;
  private quarantinedPaths = new Set<string>();
  private expectedWatcherWrites = new Map<string, { transactionId: string; hash: string | null }>();
  private transactionCounter = 0;
  private currentTransactionId: string | null = null;''')
coord = replace_once(coord,
"    this.syncMutex = true;\n    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };",
"    this.syncMutex = true;\n    this.currentTransactionId = `sync-${Date.now()}-${++this.transactionCounter}`;\n    this.quarantinedPaths.clear();\n    const result: SyncResult = { synced: 0, conflicts: 0, errors: [] };",
'reconcile transaction')
coord = replace_once(coord,
"    if (this.syncMutex) {\n      this.queueSync();\n      return { synced: 0, conflicts: 0, errors: ['Sync already in progress, queued'] };\n    }",
"    if (this.syncMutex) {\n      this.syncRerunRequested = true;\n      return { synced: 0, conflicts: 0, errors: ['Sync already in progress, coalesced'] };\n    }",
'coalescing entry')
coord = replace_once(coord,
"    } finally {\n      this.syncMutex = false;\n      this.processSyncQueue();\n    }",
"    } finally {\n      this.syncMutex = false;\n      this.currentTransactionId = null;\n      if (this.syncRerunRequested) {\n        this.syncRerunRequested = false;\n        void this.reconcile();\n      }\n    }",
'coalescing finally')

old_remote_map = '''    const remoteFileMap = new Map<string, DriveFileMetadata>();
    const remoteIdSeen = new Map<string, string>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath) continue;

      if (!VaultSyncFilePolicy.shouldSyncFile(remotePath)) continue;

      const normalizedRemote = normalizeVaultPath(remotePath);
      if (remoteFileMap.has(normalizedRemote)) {
        const existingId = remoteFileMap.get(normalizedRemote)!.id;
        if (existingId !== file.id) {
          result.errors.push(`Ambiguous remote identity for ${normalizedRemote}: ${existingId} vs ${file.id}`);
          this.conflicts.set(normalizedRemote, {
            originalPath: normalizedRemote,
            localContent: new Uint8Array(),
            remoteContent: new Uint8Array(),
            localSha256: '',
            remoteSha256: '',
            remoteFileId: file.id,
            isBinary: false,
            timestamp: new Date().toISOString(),
            localExists: false,
            remoteExists: true
          });
          result.conflicts++;
          continue;
        }
      }

      remoteFileMap.set(normalizedRemote, file);
    }
'''
new_remote_map = '''    const remoteFileMap = new Map<string, DriveFileMetadata>();
    const candidatesByPath = new Map<string, DriveFileMetadata[]>();

    for (const file of remoteFiles) {
      const remotePath = await this.resolveRemotePath(file, driveFolderId);
      if (!remotePath || !VaultSyncFilePolicy.shouldSyncFile(remotePath)) continue;
      const normalizedRemote = normalizeVaultPath(remotePath);
      const candidates = candidatesByPath.get(normalizedRemote) || [];
      candidates.push(file);
      candidatesByPath.set(normalizedRemote, candidates);
    }

    for (const [remotePath, candidates] of candidatesByPath) {
      const uniqueIds = new Set(candidates.map(candidate => candidate.id));
      if (uniqueIds.size > 1) {
        this.quarantinedPaths.add(remotePath);
        result.errors.push(`Ambiguous remote identity for ${remotePath}: ${[...uniqueIds].join(', ')}`);
        result.conflicts++;
        continue;
      }
      remoteFileMap.set(remotePath, candidates[0]);
    }
'''
coord = replace_once(coord, old_remote_map, new_remote_map, 'duplicate quarantine')
coord = replace_once(coord,
"      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedLocal)) continue;\n\n      const remoteFile = remoteFileMap.get(normalizedLocal);",
"      if (!VaultSyncFilePolicy.shouldSyncFile(normalizedLocal)) continue;\n      if (this.quarantinedPaths.has(normalizedLocal)) continue;\n\n      const remoteFile = remoteFileMap.get(normalizedLocal);",
'quarantine local pass')
coord = coord.replace(
"      let remoteHash = remoteFile ? (remoteFile.quartzoHash || null) : null;\n      if (remoteFile && remoteFile.id && remoteHash === null) {\n        try {\n          const downloaded = await this.driveAdapter.downloadFile(remoteFile.id);\n          remoteHash = crypto.createHash('sha256').update(downloaded).digest('hex');\n          remoteFile.quartzoHash = remoteHash;\n        } catch { /* fallback to conflict */ }\n      }",
"      let remoteHash = remoteFile ? await this.driveAdapter.resolveRemoteHash(remoteFile) : null;\n      if (remoteFile) remoteFile.quartzoHash = remoteHash;")
coord = coord.replace(
"    const allKnown = new Set([...localInventory.keys(), ...remoteFileMap.keys()]);",
"    const allKnown = new Set([...localInventory.keys(), ...remoteFileMap.keys(), ...this.quarantinedPaths]);")

# Remote rename transition: a proven remote ID is identity. Move the local old
# candidate to the new path when no destination collision, then run normal
# three-way reconciliation. Destination collisions become two independent,
# explicit conflict candidates rather than one aliased fake artifact.
rename_pattern = re.compile(r'''        const localFile = localInventory\.get\(normalizedRemote\);\n        let syncFile = this\.syncState\.files\.get\(normalizedRemote\);\n\n        if \(!syncFile\) \{.*?\n        \}\n\n        const remoteHash = change\.file\.quartzoHash \|\| null;''', re.S)
rename_replacement = '''        let localFile = localInventory.get(normalizedRemote);
        let syncFile = this.syncState.files.get(normalizedRemote);

        if (!syncFile) {
          const existingSyncFile = this.findSyncFileByRemoteId(change.file.id);
          if (existingSyncFile && existingSyncFile.path !== normalizedRemote) {
            const oldKey = existingSyncFile.path;
            const oldLocal = localInventory.get(oldKey);
            const destinationLocal = localInventory.get(normalizedRemote);

            this.syncState.files.delete(oldKey);
            existingSyncFile.path = normalizedRemote;
            this.syncState.files.set(normalizedRemote, existingSyncFile);
            syncFile = existingSyncFile;

            if (destinationLocal) {
              // Destination collision: keep the tracked remote identity at the
              // new path, but quarantine BOTH independent local candidates.
              result.conflicts++;
              await this.handleConflict(normalizedRemote, destinationLocal, change.file, syncFile);
              if (oldLocal) {
                const oldShadow = this.createSyncFile(oldKey, oldLocal);
                oldShadow.baseHash = null;
                oldShadow.remoteFileId = null;
                this.syncState.files.set(oldKey, oldShadow);
                result.conflicts++;
                await this.handleConflict(oldKey, oldLocal, undefined, oldShadow);
              }
              continue;
            }

            if (oldLocal) {
              const oldLocalPath = pathModule.join(this.vaultPath, oldKey);
              const newLocalPath = pathModule.join(this.vaultPath, normalizedRemote);
              const bytes = new Uint8Array(fs.readFileSync(oldLocalPath));
              this.registerExpectedWatcherWrite(oldKey, null);
              this.registerExpectedWatcherWrite(normalizedRemote, bytes);
              const newDir = pathModule.dirname(newLocalPath);
              if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
              fs.renameSync(oldLocalPath, newLocalPath);
              localInventory.delete(oldKey);
              localInventory.set(normalizedRemote, oldLocal);
              localFile = oldLocal;
            } else {
              await this.pullFile(normalizedRemote, change.file, syncFile);
              result.synced++;
              continue;
            }
          } else {
            syncFile = this.createSyncFile(normalizedRemote, localFile || { hash: '', exists: false });
          }
        }

        const remoteHash = await this.driveAdapter.resolveRemoteHash(change.file);'''
coord, count = rename_pattern.subn(rename_replacement, coord, count=1)
if count != 1:
    raise SystemExit(f'remote rename patch failed: {count}')

# After identity transition localFile may have been recomputed.
coord = coord.replace('        syncFile.remoteFileId = change.file.id;\n\n        if (!localFile) {', '        change.file.quartzoHash = remoteHash;\n        syncFile.remoteFileId = change.file.id;\n\n        if (!localFile) {', 1)

# Watcher expected-write registration for coordinator-driven local mutations.
coord = replace_once(coord,
"        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);",
"        if (fs.existsSync(localFilePath)) {\n          this.registerExpectedWatcherWrite(normalized, null);\n          fs.unlinkSync(localFilePath);\n        }",
'conflict remote delete local write')
# Replace both resolution write occurrences.
coord = coord.replace(
"        fs.writeFileSync(localFilePath, Buffer.from(artifact.localContent));",
"        this.registerExpectedWatcherWrite(normalized, artifact.localContent);\n        fs.writeFileSync(localFilePath, Buffer.from(artifact.localContent));")
coord = coord.replace(
"        fs.writeFileSync(localFilePath, Buffer.from(artifact.remoteContent));",
"        this.registerExpectedWatcherWrite(normalized, artifact.remoteContent);\n        fs.writeFileSync(localFilePath, Buffer.from(artifact.remoteContent));")
coord = replace_once(coord,
"    fs.writeFileSync(localFilePath, Buffer.from(content));\n\n    const localHash",
"    this.registerExpectedWatcherWrite(filePath, content);\n    fs.writeFileSync(localFilePath, Buffer.from(content));\n\n    const localHash",
'pull watcher suppression')
coord = replace_once(coord,
"    if (fs.existsSync(localFilePath)) {\n      fs.unlinkSync(localFilePath);\n    }",
"    if (fs.existsSync(localFilePath)) {\n      this.registerExpectedWatcherWrite(filePath, null);\n      fs.unlinkSync(localFilePath);\n    }",
'delete local watcher suppression')

# Atomic state persistence and recovery of a completed temp write.
old_load = """      if (fs.existsSync(this.stateStorePath)) {
        const content = fs.readFileSync(this.stateStorePath, 'utf-8');
        const data = JSON.parse(content);
"""
new_load = """      const tempPath = `${this.stateStorePath}.tmp`;
      if (!fs.existsSync(this.stateStorePath) && fs.existsSync(tempPath)) {
        JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
        fs.renameSync(tempPath, this.stateStorePath);
      }
      if (fs.existsSync(this.stateStorePath)) {
        const content = fs.readFileSync(this.stateStorePath, 'utf-8');
        const data = JSON.parse(content);
"""
coord = replace_once(coord, old_load, new_load, 'state recovery')
old_save = """      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.stateStorePath, content, 'utf-8');
"""
new_save = """      const content = JSON.stringify(data, null, 2);
      const tempPath = `${this.stateStorePath}.tmp`;
      const dir = pathModule.dirname(this.stateStorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fd = fs.openSync(tempPath, 'w');
      try {
        fs.writeFileSync(fd, content, 'utf-8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempPath, this.stateStorePath);
"""
coord = replace_once(coord, old_save, new_save, 'atomic state save')

# Remove old queue methods and add expected-write API for Obsidian watcher layer.
queue_pattern = re.compile(r'''  private queueSync\(\): void \{.*?\n  \}\n\n  private async processSyncQueue\(\): Promise<void> \{.*?\n  \}\n''', re.S)
coord, count = queue_pattern.subn('', coord, count=1)
if count != 1:
    raise SystemExit('queue methods patch failed')
insert_marker = '  async triggerManualSync(): Promise<SyncResult> {'
watcher_api = r'''  private registerExpectedWatcherWrite(filePath: string, content: Uint8Array | null): void {
    const normalized = normalizeVaultPath(filePath);
    const transactionId = this.currentTransactionId || `write-${Date.now()}-${++this.transactionCounter}`;
    this.expectedWatcherWrites.set(normalized, {
      transactionId,
      hash: content === null ? null : this.calculateHash(content)
    });
  }

  consumeExpectedWatcherEvent(filePath: string, content: Uint8Array | null): boolean {
    const normalized = normalizeVaultPath(filePath);
    const expected = this.expectedWatcherWrites.get(normalized);
    if (!expected || !expected.transactionId) return false;
    const actualHash = content === null ? null : this.calculateHash(content);
    if (actualHash !== expected.hash) return false;
    this.expectedWatcherWrites.delete(normalized);
    return true;
  }

'''
coord = coord.replace(insert_marker, watcher_api + insert_marker, 1)
write(coord_path, coord)

# ---------------------------------------------------------------------------
# First-run auth gating + watcher suppression at Obsidian event boundary.
# ---------------------------------------------------------------------------
main_path = 'src/main.ts'
main = read(main_path)
main = replace_once(main,
"  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];",
"  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];\n  authState: 'disconnected' | 'authenticating' | 'authenticated_unpaired' | 'paired' | 'authentication_required' = 'disconnected';",
'auth state field')
# Do not discover before authenticated session.
main = main.replace('        if (this.context.plugin.driveAdapter) {', "        if (this.context.plugin.driveAdapter && this.context.plugin.authState === 'authenticated_unpaired') {", 1)
# startPairingFlow state transitions.
main = replace_once(main,
"  async startPairingFlow() {\n    const clientId = this.getResolvedClientId();",
"  async startPairingFlow() {\n    this.authState = 'authenticating';\n    const clientId = this.getResolvedClientId();",
'auth start state')
main = replace_once(main,
"      this.settings.firstRunCompleted = true;\n      await this.saveSettings();\n\n      new Notice('Google Drive authenticated. Select your vault folder.');",
"      this.settings.firstRunCompleted = true;\n      this.authState = 'authenticated_unpaired';\n      await this.saveSettings();\n\n      new Notice('Google Drive authenticated. Select your vault folder.');",
'auth success state')
main = replace_once(main,
"    } catch (error) {\n      new Notice(`Authentication failed: ${error}`);",
"    } catch (error) {\n      this.authState = 'disconnected';\n      new Notice(`Authentication failed: ${error}`);",
'auth failure state')
# Paired state when pairing completes.
main = main.replace("    this.settings.isPaired = true;", "    this.settings.isPaired = true;\n    this.authState = 'paired';", 1)
# Restored session success/failure.
main = main.replace("      this.driveAdapter.setAccessToken(tokenResponse.access_token);", "      this.driveAdapter.setAccessToken(tokenResponse.access_token);\n      this.authState = this.settings.isPaired ? 'paired' : 'authenticated_unpaired';", 1)
main = main.replace("      new Notice('Session expired. Please reconnect Google Drive.');", "      this.authState = 'authentication_required';\n      new Notice('Session expired. Please reconnect Google Drive.');", 1)

old_sync_handlers = '''    const onchange = this.app.vault.on('create', () => {
      if (this.settings.syncAuto && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(onchange);

    const onmodifySync = this.app.vault.on('modify', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        if (this.settings.syncAuto) {
          this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
        }
      }
    });
    this.eventRefs.push(onmodifySync);

    const ondeleteSync = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.queueDelete(file.path);
        if (this.settings.syncAuto) {
          this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
        }
      }
    });
    this.eventRefs.push(ondeleteSync);

    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.queueRename(oldPath, file.path);
        if (this.settings.syncAuto) {
          this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
        }
      }
    });
    this.eventRefs.push(onrenameSync);
'''
new_sync_handlers = '''    const onchange = this.app.vault.on('create', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes))) return;
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onchange);

    const onmodifySync = this.app.vault.on('modify', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes))) return;
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onmodifySync);

    const ondeleteSync = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        if (this.driveSyncCoordinator.consumeExpectedWatcherEvent(file.path, null)) return;
        this.driveSyncCoordinator.queueDelete(file.path);
        if (this.settings.syncAuto) this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(ondeleteSync);

    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          const oldSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(oldPath, null) ?? false;
          const newSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes)) ?? false;
          if (oldSuppressed && newSuppressed) return;
          this.driveSyncCoordinator?.queueRename(oldPath, file.path);
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onrenameSync);
'''
main = replace_once(main, old_sync_handlers, new_sync_handlers, 'watcher sync handlers')
write(main_path, main)

# Pin the validated upstream SHA; the real sync command will replace vendor bytes
# and generate a non-self-certified lock during the workflow.
print('repair patch applied')
