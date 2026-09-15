import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const criticalPaths = [
  {
    path: 'src/sync/coordinator/index.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement'],
    description: 'DriveSyncCoordinator'
  },
  {
    path: 'src/integrations/google/drive/adapter.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement', 'throw new Error("Not implemented")'],
    description: 'GoogleDriveAdapter'
  },
  {
    path: 'src/integrations/google/auth/loopback.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement'],
    description: 'OAuth loopback'
  },
  {
    path: 'src/main.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement'],
    description: 'Plugin main (composition root)'
  }
];

function checkFile(filePath, forbiddenPatterns, description) {
  const fullPath = path.join(rootDir, filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`FAIL: ${description} file not found: ${filePath}`);
    return false;
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const violations = [];
  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) violations.push(pattern);
  }
  if (violations.length > 0) {
    console.error(`FAIL: ${description} contains forbidden patterns:`);
    violations.forEach(v => console.error(`   - ${v}`));
    return false;
  }
  console.log(`PASS: ${description}`);
  return true;
}

function checkNoSyncStateInRoot() {
  const syncStatePath = path.join(rootDir, '.quartzo-sync-state.json');
  if (fs.existsSync(syncStatePath)) {
    console.error('FAIL: Sync state file found in vault root (must be plugin-local)');
    return false;
  }
  console.log('PASS: No sync state in vault root');
  return true;
}

function checkSingleFilePolicy() {
  const policyFiles = [];
  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        scan(full);
      } else if (entry.name === 'file-policy.ts') {
        policyFiles.push(full);
      }
    }
  }
  scan(path.join(rootDir, 'src'));
  if (policyFiles.length !== 1) {
    console.error(`FAIL: Expected exactly 1 VaultSyncFilePolicy, found ${policyFiles.length}`);
    return false;
  }
  console.log('PASS: Single VaultSyncFilePolicy');
  return true;
}

function checkTestSyncIncludesRuntime() {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const testSync = pkg.scripts?.['test:sync'];
  if (!testSync) {
    console.error('FAIL: test:sync script not found');
    return false;
  }
  if (!testSync.includes('runtime')) {
    console.error('FAIL: test:sync does not include runtime tests');
    return false;
  }
  console.log('PASS: test:sync includes runtime');
  return true;
}

function checkOAuthNotConnectedWithoutRealClientId() {
  const mainPath = path.join(rootDir, 'src/main.ts');
  if (!fs.existsSync(mainPath)) return true;
  const content = fs.readFileSync(mainPath, 'utf-8');
  if (content.includes("clientId: 'real'") || content.includes('clientId: "real"')) {
    console.error('FAIL: OAuth production Client ID hardcoded');
    return false;
  }
  console.log('PASS: No hardcoded real OAuth Client ID');
  return true;
}

function main() {
  console.log('Running architecture/completeness checks...\n');
  let allPassed = true;

  for (const check of criticalPaths) {
    if (!checkFile(check.path, check.forbiddenPatterns, check.description)) allPassed = false;
  }
  if (!checkNoSyncStateInRoot()) allPassed = false;
  if (!checkSingleFilePolicy()) allPassed = false;
  if (!checkTestSyncIncludesRuntime()) allPassed = false;
  if (!checkOAuthNotConnectedWithoutRealClientId()) allPassed = false;

  console.log('\n' + (allPassed ? 'All architecture checks passed' : 'Some architecture checks failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
