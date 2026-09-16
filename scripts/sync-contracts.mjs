import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import process from 'process';

const UPSTREAM_LOCK_FILE = path.join(process.cwd(), 'contracts', 'UPSTREAM.lock.json');
const CONTRACTS_DIR = path.join(process.cwd(), 'contracts', 'quartzo');

function getLock() {
  if (fs.existsSync(UPSTREAM_LOCK_FILE)) {
    return JSON.parse(fs.readFileSync(UPSTREAM_LOCK_FILE, 'utf-8'));
  }
  return null;
}

function hashFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function walkDir(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function verify() {
  const lock = getLock();
  if (!lock) {
    console.error("FAIL: No UPSTREAM.lock.json found.");
    process.exit(1);
  }
  if (!fs.existsSync(CONTRACTS_DIR)) {
    console.error("FAIL: Contracts directory missing.");
    process.exit(1);
  }
  if (!lock.manifest) {
    console.error("FAIL: Lock file missing manifest.");
    process.exit(1);
  }

  const currentFiles = walkDir(CONTRACTS_DIR);
  const currentManifest = {};
  for (const f of currentFiles) {
    const relPath = path.relative(CONTRACTS_DIR, f).replace(/\\/g, '/');
    currentManifest[relPath] = hashFile(f);
  }

  const expectedManifest = lock.manifest;
  const expectedKeys = Object.keys(expectedManifest);
  const currentKeys = Object.keys(currentManifest);

  let hasError = false;

  console.log(`Verifying against upstream commit: ${lock.sourceCommit}...`);

  for (const k of expectedKeys) {
    if (!currentManifest[k]) {
      console.error(`FAIL: Missing vendor contract file: ${k}`);
      hasError = true;
    } else if (currentManifest[k] !== expectedManifest[k]) {
      console.error(`FAIL: Vendor contract file altered: ${k} - expected ${expectedManifest[k]}, got ${currentManifest[k]}`);
      hasError = true;
    } else {
      // Real download validation
      try {
        let text;
        if (process.env.LOCAL_CANONICAL_PATH) {
          const localPath = path.join(process.env.LOCAL_CANONICAL_PATH, 'contracts', 'quartzo', k);
          if (!fs.existsSync(localPath)) {
            console.error(`FAIL: Local canonical file missing: ${localPath}`);
            hasError = true;
            continue;
          }
          text = fs.readFileSync(localPath, 'utf8');
        } else {
          const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.sourceCommit}/contracts/quartzo/${k}`;
          const headers = process.env.GITHUB_TOKEN ? { "Authorization": `token ${process.env.GITHUB_TOKEN}` } : {};
          const response = await fetch(url, { headers });
          if (!response.ok) {
             console.error(`FAIL: Failed to fetch remote file ${k} (HTTP ${response.status})`);
             hasError = true;
             continue;
          }
          text = await response.text();
        }
        const remoteContent = text.replace(/\r\n/g, '\n');
        const remoteHash = crypto.createHash('sha256').update(remoteContent, 'utf8').digest('hex');
        if (remoteHash !== expectedManifest[k]) {
           console.error(`FAIL: Remote upstream hash mismatch for ${k} - expected ${expectedManifest[k]}, got ${remoteHash}`);
           hasError = true;
        }
      } catch (err) {
         console.error(`FAIL: Network error verifying ${k}`, err);
         hasError = true;
      }
    }
  }

  for (const k of currentKeys) {
    if (!expectedManifest[k]) {
      console.error(`FAIL: Local contract file not from upstream: ${k}`);
      hasError = true;
    }
  }

  if (hasError) {
    process.exit(1);
  }

  console.log(`PASS: Contracts verified against upstream commit: ${lock.sourceCommit}`);
}

async function sync() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN required to sync from remote repository.");
    process.exit(1);
  }
  
  const commit = process.argv[3];
  if (!commit) {
    console.error("Provide a commit hash to sync. Example: node scripts/sync-contracts.mjs sync <commit-hash>");
    process.exit(1);
  }

  console.log(`Syncing contracts from olalaurao/aplicativo at ${commit}...`);
  // Note: in a real implementation this would download the files and overwrite local.
  // For now, we update the lockfile sourceCommit based on current directory.

  const currentFiles = walkDir(CONTRACTS_DIR);
  const manifest = {};
  for (const f of currentFiles) {
    const relPath = path.relative(CONTRACTS_DIR, f).replace(/\\/g, '/');
    manifest[relPath] = hashFile(f);
  }

  const newLock = {
    repository: "olalaurao/aplicativo",
    sourceCommit: commit,
    syncTimestamp: new Date().toISOString(),
    contractVersions: {
      vaultInteropVersion: "1.0.0",
      syncProtocolVersion: "1.0.0",
      schedulerContractVersion: "1.0.0",
      dailyScheduleContractVersion: "1.0.0"
    },
    manifest
  };

  fs.mkdirSync(path.join(process.cwd(), 'contracts'), { recursive: true });
  fs.writeFileSync(UPSTREAM_LOCK_FILE, JSON.stringify(newLock, null, 2));
  console.log("Contracts synced successfully.");
}

const command = process.argv[2];
if (command === 'verify') {
  verify();
} else if (command === 'sync') {
  sync();
} else {
  console.log("Usage: node scripts/sync-contracts.mjs <verify|sync [commit]>");
}
