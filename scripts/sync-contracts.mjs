import fs from 'fs';
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
