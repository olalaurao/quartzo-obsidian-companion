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
    path: 'src/integrations/google/calendar/adapter.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement', 'throw new Error("Not implemented")'],
    description: 'Google Calendar read-only adapter'
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


function checkSingleQuartzoWorkspaceView() {
  const mainPath = path.join(rootDir, 'src/main.ts');
  const content = fs.readFileSync(mainPath, 'utf8');
  const registrations = content.match(/registerView\(/g) || [];
  if (registrations.length !== 1 || !content.includes('registerView(QUARTZO_VIEW_TYPE')) {
    console.error(`FAIL: V1 requires one primary Quartzo workspace view; found ${registrations.length} registrations`);
    return false;
  }
  console.log('PASS: Single primary Quartzo workspace view');
  return true;
}

function checkNoHardcodedQuickAddFolders() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const creationPath = path.join(rootDir, 'src/core/object-creation.ts');
  if (!fs.existsSync(shellPath) || !fs.existsSync(creationPath)) {
    console.error('FAIL: Quartzo shell or canonical object-creation owner missing');
    return false;
  }
  const shell = fs.readFileSync(shellPath, 'utf8');
  const creation = fs.readFileSync(creationPath, 'utf8');
  const content = `${shell}
${creation}`;
  const forbidden = ['tasks/', 'notes/', 'journal/', 'reminders/'];
  const violations = forbidden.filter(value => content.includes(`'${value}`) || content.includes(`"${value}`));
  if (violations.length > 0) {
    console.error(`FAIL: Quick Add contains hardcoded canonical folders: ${violations.join(', ')}`);
    return false;
  }
  if (!creation.includes('resolveCreationFolder') || !shell.includes('buildQuickAddDocument')) {
    console.error('FAIL: Quick Add does not route through canonical shared Object Identification creation owner');
    return false;
  }
  console.log('PASS: Quick Add paths come from shared Object Identification');
  return true;
}
function checkNoUnsafeInnerHtml() {
  const violations = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        if (source.includes('.innerHTML')) violations.push(path.relative(rootDir, full));
      }
    }
  }
  scan(path.join(rootDir, 'src'));
  if (violations.length > 0) {
    console.error(`FAIL: Runtime source uses innerHTML instead of safe DOM/textContent: ${violations.join(', ')}`);
    return false;
  }
  console.log('PASS: Runtime UI does not use innerHTML');
  return true;
}

function checkCanonicalUiDateAndIdentityOwners() {
  const shell = fs.readFileSync(path.join(rootDir, 'src/ui/shell/view.ts'), 'utf8');
  const main = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');
  const dailySchedule = fs.readFileSync(path.join(rootDir, 'src/core/daily_schedule/engine.ts'), 'utf8');
  const forbidden = ['toISOString().slice(0, 10)', "toISOString().split('T')[0]", 'setUTCDate(', 'getUTCDay(', 'Date.UTC(', 'Math.random().toString(36)'];
  const violations = forbidden.filter(pattern => shell.includes(pattern) || main.includes(pattern) || dailySchedule.includes(pattern));
  if (violations.length > 0) {
    console.error(`FAIL: Quartzo UI bypasses canonical local-date/identity owners: ${violations.join(', ')}`);
    return false;
  }
  if (!shell.includes('createCanonicalObjectId()') || !shell.includes('shiftLocalMonth(') || !main.includes('localIsoDate(new Date())')) {
    console.error('FAIL: Quartzo UI is not wired to canonical local-date and object identity owners');
    return false;
  }
  console.log('PASS: UI uses canonical local-date and object identity owners');
  return true;
}

function checkGoogleCalendarRemainsReadOnly() {
  const adapterPath = path.join(rootDir, 'src/integrations/google/calendar/adapter.ts');
  const scopesPath = path.join(rootDir, 'src/integrations/google/auth/scopes.ts');
  if (!fs.existsSync(adapterPath) || !fs.existsSync(scopesPath)) {
    console.error('FAIL: Google Calendar read-only integration files are missing');
    return false;
  }
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const scopes = fs.readFileSync(scopesPath, 'utf8');
  const writePatterns = ["method: 'POST'", "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'", '.insert(', '.update(', '.delete('];
  const writes = writePatterns.filter(pattern => adapter.includes(pattern));
  if (writes.length > 0) {
    console.error(`FAIL: Google Calendar V1 adapter contains write paths: ${writes.join(', ')}`);
    return false;
  }
  if (!scopes.includes('https://www.googleapis.com/auth/calendar.readonly')) {
    console.error('FAIL: Google Calendar read-only scope is missing');
    return false;
  }
  if (/['"]https:\/\/www\.googleapis\.com\/auth\/calendar['"]/.test(scopes)) {
    console.error('FAIL: Companion requests broad Google Calendar write scope');
    return false;
  }
  console.log('PASS: Google Calendar integration is read-only and least-privilege');
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
  if (!checkSingleQuartzoWorkspaceView()) allPassed = false;
  if (!checkNoHardcodedQuickAddFolders()) allPassed = false;
  if (!checkNoUnsafeInnerHtml()) allPassed = false;
  if (!checkCanonicalUiDateAndIdentityOwners()) allPassed = false;
  if (!checkGoogleCalendarRemainsReadOnly()) allPassed = false;

  console.log('\n' + (allPassed ? 'All architecture checks passed' : 'Some architecture checks failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
