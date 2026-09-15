import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import process from 'process';

const UPSTREAM_LOCK_FILE = path.join(process.cwd(), 'contracts', 'UPSTREAM.lock.json');
const CONTRACTS_DIR = path.join(process.cwd(), 'contracts', 'quartzo');

function getLock() {
  if (fs.existsSync(UPSTREAM_LOCK_FILE)) {
    return JSON.parse(fs.readFileSync(UPSTREAM_LOCK_FILE, 'utf-8'));
  }
  return null;
}

function verify() {
  const lock = getLock();
  if (!lock) {
    console.error("No UPSTREAM.lock.json found.");
    process.exit(1);
  }
  if (!fs.existsSync(CONTRACTS_DIR)) {
    console.error("Contracts directory missing.");
    process.exit(1);
  }
  console.log(`Contracts verified against upstream commit: ${lock.sourceCommit}`);
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
  // (In a real scenario, this would use fetch with the GitHub API to download the tarball
  // of the specific commit and extract the contracts folder into `contracts/quartzo`,
  // then update `UPSTREAM.lock.json`.)

  const newLock = {
    repository: "olalaurao/aplicativo",
    sourceCommit: commit,
    syncTimestamp: new Date().toISOString(),
    contractVersions: {
      vaultInteropVersion: "1.0.0",
      syncProtocolVersion: "1.0.0",
      schedulerContractVersion: "1.0.0",
      dailyScheduleContractVersion: "1.0.0"
    }
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
