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
  const quickAddPath = path.join(rootDir, 'src/ui/quick-add/modal.ts');
  const creationPath = path.join(rootDir, 'src/core/object-creation.ts');
  if (!fs.existsSync(shellPath) || !fs.existsSync(quickAddPath) || !fs.existsSync(creationPath)) {
    console.error('FAIL: Quartzo shell, Quick Add UI owner, or canonical object-creation owner missing');
    return false;
  }
  const shell = fs.readFileSync(shellPath, 'utf8');
  const quickAdd = fs.readFileSync(quickAddPath, 'utf8');
  const creation = fs.readFileSync(creationPath, 'utf8');
  const content = `${quickAdd}
${creation}`;
  const forbidden = ['tasks/', 'notes/', 'journal/', 'reminders/'];
  const violations = forbidden.filter(value => content.includes(`'${value}`) || content.includes(`"${value}`));
  if (violations.length > 0) {
    console.error(`FAIL: Quick Add contains hardcoded canonical folders: ${violations.join(', ')}`);
    return false;
  }
  if (!creation.includes('resolveCreationFolder') ||
      !quickAdd.includes('buildQuickAddDocument') ||
      !shell.includes("from '../quick-add/modal'") ||
      shell.includes('class QuickAddModal extends Modal')) {
    console.error('FAIL: Quick Add is not routed through its UI owner and canonical Object Identification creation owner');
    return false;
  }
  console.log('PASS: Quick Add is extracted from the shell and paths come from shared Object Identification');
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
  const quickAdd = fs.readFileSync(path.join(rootDir, 'src/ui/quick-add/modal.ts'), 'utf8');
  const main = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');
  const dailySchedule = fs.readFileSync(path.join(rootDir, 'src/core/daily_schedule/engine.ts'), 'utf8');
  const forbidden = ['toISOString().slice(0, 10)', "toISOString().split('T')[0]", 'setUTCDate(', 'getUTCDay(', 'Date.UTC(', 'Math.random().toString(36)'];
  const violations = forbidden.filter(pattern =>
    shell.includes(pattern) || quickAdd.includes(pattern) || main.includes(pattern) || dailySchedule.includes(pattern)
  );
  if (violations.length > 0) {
    console.error(`FAIL: Quartzo UI bypasses canonical local-date/identity owners: ${violations.join(', ')}`);
    return false;
  }
  if (!quickAdd.includes('createCanonicalObjectId()') ||
      !shell.includes('shiftLocalMonth(') ||
      !main.includes('localIsoDate(new Date())')) {
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
function checkReminderRuntimeBoundaries() {
  const servicePath = path.join(rootDir, 'src/core/reminders/service.ts');
  const projectionPath = path.join(rootDir, 'src/core/reminders/projection.ts');
  const platformPath = path.join(rootDir, 'src/platform/notifications.ts');
  const registryPath = path.join(rootDir, 'src/local-state/notification-delivery-registry.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  for (const file of [servicePath, projectionPath, platformPath, registryPath, mainPath]) {
    if (!fs.existsSync(file)) {
      console.error(`FAIL: Reminder runtime file missing: ${path.relative(rootDir, file)}`);
      return false;
    }
  }
  const service = fs.readFileSync(servicePath, 'utf8');
  const projection = fs.readFileSync(projectionPath, 'utf8');
  const platform = fs.readFileSync(platformPath, 'utf8');
  const registry = fs.readFileSync(registryPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const coreForbidden = ["from 'obsidian'", '.setInterval(', 'Notification.requestPermission', "toISOString().split('T')[0]", '24 * 60 * 60 * 1000'];
  const coreViolations = coreForbidden.filter(pattern => service.includes(pattern) || projection.includes(pattern));
  if (coreViolations.length > 0) {
    console.error(`FAIL: Reminder core bypasses lifecycle/platform/local-date owners: ${coreViolations.join(', ')}`);
    return false;
  }
  if (!main.includes("reminderDelivery: 'in_obsidian_only'") || !main.includes('registerInterval(window.setInterval') || !main.includes("quartzo-notification-delivery.json")) {
    console.error('FAIL: Reminder runtime is not lifecycle-managed with device-local default delivery');
    return false;
  }
  if (platform.includes("from 'obsidian'") ||
      !platform.includes('requestDesktopPermission()') ||
      !platform.includes('showInObsidianNotice: (message: string) => void') ||
      !platform.includes('this.showInObsidianNotice(') ||
      !main.includes('message => { new Notice(message); }')) {
    console.error('FAIL: Reminder delivery must keep Obsidian Notice side effects at the composition boundary');
    return false;
  }
  if (!registry.includes("node:fs") || registry.includes('app/quartzo_shared_settings.md')) {
    console.error('FAIL: Reminder delivery registry is not device-local');
    return false;
  }
  console.log('PASS: Reminder delivery stays lifecycle-managed, device-local and platform-owned');
  return true;
}
function checkConflictResolutionIsExplicit() {
  const enginePath = path.join(rootDir, 'src/core/sync/engine.ts');
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const engine = fs.readFileSync(enginePath, 'utf8');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const forbiddenInEngine = ['modifiedTime', 'localModifiedAt', 'remoteModifiedAt', 'keep_newest', 'Keep newest'];
  const violations = forbiddenInEngine.filter(pattern => engine.includes(pattern));
  if (violations.length > 0) {
    console.error(`FAIL: canonical three-way reconciliation uses timestamp/newest semantics: ${violations.join(', ')}`);
    return false;
  }
  if (!coordinator.includes("resolution === 'keep_newest'") || !coordinator.includes('chooseNewestConflictResolution(artifact)')) {
    console.error('FAIL: Keep newest is not implemented as an explicit conflict-resolution action');
    return false;
  }
  if (!coordinator.includes('localModifiedAt') || !coordinator.includes('remoteModifiedAt')) {
    console.error('FAIL: conflict artifacts do not preserve both modification timestamps');
    return false;
  }
  if (!shell.includes("['keep_newest', 'Keep newest']") || !shell.includes("button.disabled = true")) {
    console.error('FAIL: Conflict Center does not expose fail-closed explicit Keep newest UX');
    return false;
  }
  console.log('PASS: Conflict resolution never silently chooses newest');
  return true;
}
function checkDeviceLocalSettingsBoundaries() {
  const mainPath = path.join(rootDir, 'src/main.ts');
  const sharedCorePath = path.join(rootDir, 'src/core/shared-settings.ts');
  const sharedVaultPath = path.join(rootDir, 'src/vault/shared-settings.ts');
  const main = fs.readFileSync(mainPath, 'utf8');
  const shared = `${fs.readFileSync(sharedCorePath, 'utf8')}\n${fs.readFileSync(sharedVaultPath, 'utf8')}`;
  const requiredLocal = [
    'syncMode',
    'syncPollingIntervalSeconds',
    'hideSensitivePreviews',
    'hideJournalPreviewText',
    'hideNotificationBody',
    'focusControllerId',
  ];
  const missing = requiredLocal.filter(key => !main.includes(key));
  if (missing.length > 0) {
    console.error(`FAIL: Companion-local settings are missing: ${missing.join(', ')}`);
    return false;
  }
  const leaked = requiredLocal.filter(key => shared.includes(key));
  if (leaked.length > 0) {
    console.error(`FAIL: Device-local settings leaked into shared Quartzo settings: ${leaked.join(', ')}`);
    return false;
  }
  if (main.includes('this.settings.privacyMode') || main.includes("setName('Privacy Mode')")) {
    console.error('FAIL: Legacy monolithic privacyMode remains a runtime settings owner');
    return false;
  }
  if (!main.includes("syncMode: 'manual'") || !main.includes(".setName('Sync mode')")) {
    console.error('FAIL: Sync mode is not a single manual-default setting');
    return false;
  }
  if (main.includes('this.settings.syncAuto') || main.includes('this.settings.syncOnStartup') || main.includes('this.settings.syncOnFocus')) {
    console.error('FAIL: Legacy automatic sync toggles remain runtime owners');
    return false;
  }
  if (main.includes(".setName('Auto sync')") || main.includes(".setName('Sync on Obsidian startup')") || main.includes(".setName('Sync on window focus')")) {
    console.error('FAIL: Legacy automatic sync toggles remain visible in Settings');
    return false;
  }
  if (!main.includes("stored.syncAuto === true") || !main.includes("? 'automatic'") || !main.includes(": 'manual'")) {
    console.error('FAIL: Legacy sync settings do not migrate fail-safe to Manual');
    return false;
  }
  if (!main.includes("registerDomEvent(window, 'focus'") || !main.includes("this.settings.syncMode !== 'automatic'") || !main.includes('this.settings.syncPollingIntervalSeconds') || !main.includes('seconds * 1000')) {
    console.error('FAIL: Automatic sync triggers are not gated by the single sync mode');
    return false;
  }
  const firstRunStart = main.indexOf('class QuartzoFirstRunModal extends Modal');
  const firstRunEnd = main.indexOf('class QuartzoSettingTab', firstRunStart);
  const firstRun = firstRunStart >= 0 && firstRunEnd > firstRunStart ? main.slice(firstRunStart, firstRunEnd) : '';
  if (!firstRun.includes('startPairingFlow()') || !firstRun.includes('useWithoutSync()') || firstRun.includes('firstRunCompleted = true')) {
    console.error('FAIL: First Run bypasses canonical pairing or marks setup complete prematurely');
    return false;
  }
  console.log('PASS: Device-local Settings and First Run preserve canonical ownership boundaries');
  return true;
}
function checkObsidianSecretStorageIds() {
  const idsPath = path.join(rootDir, 'src/platform/secret-ids.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const loopbackPath = path.join(rootDir, 'src/integrations/google/auth/loopback.ts');
  if (!fs.existsSync(idsPath)) {
    console.error('FAIL: Canonical Obsidian SecretStorage ID owner is missing');
    return false;
  }
  const idsSource = fs.readFileSync(idsPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const loopback = fs.readFileSync(loopbackPath, 'utf8');
  const ids = Array.from(idsSource.matchAll(/export const [A-Z0-9_]+_SECRET_ID = '([^']+)'/g), match => match[1]);
  if (ids.length !== 1 || ids.some(id => !/^[a-z0-9-]{1,64}$/.test(id))) {
    console.error(`FAIL: Obsidian SecretStorage IDs must match ^[a-z0-9-]{1,64}$; found: ${ids.join(', ') || '(none)'}`);
    return false;
  }
  if (main.includes('quartzo_companion/') || loopback.includes('quartzo_companion/')) {
    console.error('FAIL: Legacy invalid Obsidian SecretStorage IDs remain in runtime OAuth paths');
    return false;
  }
  if (!main.includes('GOOGLE_REFRESH_TOKEN_SECRET_ID') || !loopback.includes('GOOGLE_REFRESH_TOKEN_SECRET_ID')) {
    console.error('FAIL: Runtime OAuth paths bypass the canonical SecretStorage ID owner');
    return false;
  }
  if (idsSource.includes('GOOGLE_OAUTH_CLIENT_SECRET_ID') || main.includes('GOOGLE_OAUTH_CLIENT_SECRET_ID')) {
    console.error('FAIL: Desktop OAuth client secret must not be stored in Obsidian SecretStorage');
    return false;
  }
  console.log('PASS: Obsidian SecretStorage IDs are canonical and API-compatible');
  return true;
}

function checkOAuthDesktopPlatformBoundary() {
  const loopbackPath = path.join(rootDir, 'src/integrations/google/auth/loopback.ts');
  const openerPath = path.join(rootDir, 'src/platform/browser-opener.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const loopback = fs.readFileSync(loopbackPath, 'utf8');
  const opener = fs.readFileSync(openerPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const forbidden = ['child_process', 'xdg-open', 'start ""', 'exec(command)'];
  const violations = forbidden.filter(pattern => loopback.includes(pattern) || opener.includes(pattern));
  if (violations.length > 0) {
    console.error(`FAIL: OAuth browser launch depends on external OS commands: ${violations.join(', ')}`);
    return false;
  }
  if (!opener.includes("require('electron')") || !opener.includes('shell.openExternal') || !main.includes('this.browserOpener')) {
    console.error('FAIL: OAuth loopback is not wired through the Electron platform browser opener');
    return false;
  }
  if (!loopback.includes("http://127.0.0.1:${this.port}") || !loopback.includes("code_challenge_method', 'S256'")) {
    console.error('FAIL: OAuth desktop loopback/PKCE contract regressed');
    return false;
  }
  if (loopback.includes("params.append('client_secret'") || main.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET')) {
    console.error('FAIL: Desktop OAuth must use Client ID + PKCE only and must not send or bundle a client secret');
    return false;
  }
  console.log('PASS: OAuth desktop browser launch stays inside Obsidian/Electron with loopback PKCE and no client secret');
  return true;
}
function checkReleasePipelineHardening() {
  const releasePath = path.join(rootDir, '.github/workflows/release.yml');
  const preflightPath = path.join(rootDir, '.github/workflows/release-preflight.yml');
  const validatePath = path.join(rootDir, 'scripts/release-validate.mjs');
  const packagePath = path.join(rootDir, 'scripts/package-release.mjs');
  for (const file of [releasePath, preflightPath, validatePath, packagePath]) {
    if (!fs.existsSync(file)) {
      console.error(`FAIL: Release pipeline file missing: ${path.relative(rootDir, file)}`);
      return false;
    }
  }
  const release = fs.readFileSync(releasePath, 'utf8');
  const preflight = fs.readFileSync(preflightPath, 'utf8');
  const validate = fs.readFileSync(validatePath, 'utf8');
  const packager = fs.readFileSync(packagePath, 'utf8');
  if (!release.includes('git merge-base --is-ancestor') || !release.includes('fetch-depth: 0')) {
    console.error('FAIL: Release workflow does not prove tagged commit provenance from main');
    return false;
  }
  if (!release.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_ID') || !preflight.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_ID')) {
    console.error('FAIL: Release/preflight do not require the production OAuth Client ID');
    return false;
  }
  if (release.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET') || preflight.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET')) {
    console.error('FAIL: Release/preflight must not require or inject a Google Desktop OAuth client secret');
    return false;
  }
  if (!validate.includes('must not contain QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET')) {
    console.error('FAIL: Release validator must reject bundled Google Desktop OAuth client secrets');
    return false;
  }
  if (!release.includes('npm run release:package') || !preflight.includes('npm run release:package')) {
    console.error('FAIL: Release workflows bypass the canonical release packager');
    return false;
  }
  if (!release.includes('include-hidden-files: true') || !preflight.includes('include-hidden-files: true')) {
    console.error('FAIL: Hidden canonical release artifact directory is not uploadable by GitHub Actions');
    return false;
  }
  if (!release.includes('.release-artifact/SHA256SUMS.txt') || !packager.includes('SHA256SUMS.txt')) {
    console.error('FAIL: Release package does not publish checksums');
    return false;
  }
  if (!validate.includes("['main.js', 'manifest.json', 'styles.css']") || !validate.includes('apps\\.googleusercontent\\.com')) {
    console.error('FAIL: Production release validation is missing artifact/OAuth checks');
    return false;
  }
  if (!validate.includes("gitRefType === 'tag'") || !validate.includes('Git tag')) {
    console.error('FAIL: Release validation does not separate branch preflight from tag/version enforcement');
    return false;
  }
  console.log('PASS: Beta release pipeline is preflighted, provenance-checked and checksummed');
  return true;
}
function checkPairingDuplicateCleanupIsReversible() {
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const adapterPath = path.join(rootDir, 'src/integrations/google/drive/adapter.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');

  const cleanupStart = coordinator.indexOf('async trashSafePairingDuplicates(');
  const cleanupEnd = coordinator.indexOf('async applyPairingDecisions(', cleanupStart);
  const cleanup = cleanupStart >= 0 && cleanupEnd > cleanupStart
    ? coordinator.slice(cleanupStart, cleanupEnd)
    : '';

  if (!cleanup.includes('this.driveAdapter.trashFile(') || cleanup.includes('this.driveAdapter.deleteFile(')) {
    console.error('FAIL: Pairing duplicate cleanup is not routed exclusively through reversible Drive trash');
    return false;
  }
  if (!adapter.includes('async trashFile(') ||
      !adapter.includes('requestBody: { trashed: true }') ||
      !adapter.includes("fields: 'id, trashed'") ||
      !adapter.includes('response.data.trashed !== true')) {
    console.error('FAIL: Google Drive adapter does not verify reversible trash postcondition for pairing cleanup');
    return false;
  }
  if (!adapter.includes("trashed = false") ||
      !adapter.includes('trashed: file.trashed ?? false') ||
      !coordinator.includes('if (file.trashed === true) continue;')) {
    console.error('FAIL: Pairing remote inventory can re-admit resources already confirmed in Drive trash');
    return false;
  }
  if (!main.includes('Safe duplicate cleanup did not fully finish') ||
      !main.includes('Drive has not confirmed duplicate cleanup yet')) {
    console.error('FAIL: Pairing cleanup can collapse back to Pairing blocked without preserving cleanup failure details');
    return false;
  }
  if (!main.includes('Move safe duplicates to Drive trash?') || !main.includes('Nothing is permanently deleted')) {
    console.error('FAIL: Pairing duplicate cleanup lacks explicit reversible user confirmation');
    return false;
  }
  console.log('PASS: Pairing duplicate cleanup is explicit, content-proven and reversible through Drive trash');
  return true;
}

function checkPostPairingDuplicateRecovery() {
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const viewPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const view = fs.readFileSync(viewPath, 'utf8');

  if (!coordinator.includes('getRemoteIdentityAmbiguityPaths()') ||
      !coordinator.includes('this.quarantinedPaths.add(normalizedRemote)')) {
    console.error('FAIL: Coordinator does not expose true remote identity ambiguity as canonical read-only state');
    return false;
  }
  if (!main.includes('async reviewSyncRemoteDuplicates()') ||
      !main.includes("mode: 'pairing' | 'sync_repair'") ||
      !main.includes('trashSafePairingDuplicates(summary)') ||
      !main.includes('triggerFullReconciliation()')) {
    console.error('FAIL: Paired duplicate repair bypasses the canonical safe cleanup/reconciliation path');
    return false;
  }
  if (!view.includes('getRemoteIdentityAmbiguityPaths()') ||
      !view.includes('Review Drive duplicates')) {
    console.error('FAIL: Sync Center cannot surface coordinator-owned remote duplicate recovery');
    return false;
  }
  console.log('PASS: Post-pairing Drive duplicates remain fail-closed and recover through canonical reversible cleanup');
  return true;
}

function checkDriveQuotaResilience() {
  const adapterPath = path.join(rootDir, 'src/integrations/google/drive/adapter.ts');
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');

  const listAllStart = adapter.indexOf('async listAllFiles(folderId: string)');
  const recursiveStart = adapter.indexOf('private async listAllFilesRecursive', listAllStart);
  const vaultCandidatesStart = adapter.indexOf('async listQuartzoVaultCandidates', recursiveStart);
  const listAllBody = listAllStart >= 0 && recursiveStart > listAllStart
    ? adapter.slice(listAllStart, recursiveStart)
    : '';
  const recursiveBody = recursiveStart >= 0 && vaultCandidatesStart > recursiveStart
    ? adapter.slice(recursiveStart, vaultCandidatesStart)
    : '';

  if (!adapter.includes('isRateLimitError(error)') ||
      !adapter.includes('maxRetries = Math.max(maxRetries, 5)') ||
      !adapter.includes('rateLimitUntil')) {
    console.error('FAIL: Drive per-minute quota/rate-limit responses are not handled with shared retry backoff');
    return false;
  }
  if (listAllBody.includes('return this.withRetry') ||
      !recursiveBody.includes('const response = await this.withRetry(() => this.getDriveClient().files.list({')) {
    console.error('FAIL: Recursive Drive inventory retries the whole traversal instead of only the failed page');
    return false;
  }
  if (!coordinator.includes('remoteHashCache') ||
      !coordinator.includes('cached.modifiedTime === modifiedTime') ||
      !coordinator.includes('resolveRemoteHashCached')) {
    console.error('FAIL: Pairing/full reconciliation do not reuse proven legacy hashes by remote ID + modifiedTime');
    return false;
  }
  console.log('PASS: Drive quota handling backs off per request and sync rescans reuse proven hashes');
  return true;
}

function checkDriveTimeoutsAndSyncProgress() {
  const adapterPath = path.join(rootDir, 'src/integrations/google/drive/adapter.ts');
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const viewPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const typesPath = path.join(rootDir, 'src/sync/coordinator/types.ts');
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const view = fs.readFileSync(viewPath, 'utf8');
  const types = fs.readFileSync(typesPath, 'utf8');

  if (!adapter.includes('const DRIVE_REQUEST_TIMEOUT_MS') ||
      !adapter.includes('const DRIVE_MEDIA_REQUEST_TIMEOUT_MS') ||
      !adapter.includes('{ timeout: DRIVE_REQUEST_TIMEOUT_MS }') ||
      !adapter.includes('timeout: DRIVE_MEDIA_REQUEST_TIMEOUT_MS') ||
      !adapter.includes('private isTimeoutError(error: unknown)') ||
      !types.includes('export class DriveRequestTimeoutError') ||
      !adapter.includes('throw new DriveRequestTimeoutError')) {
    console.error('FAIL: Google Drive requests can remain unbounded or timeout errors are not typed canonically');
    return false;
  }

  const requiredPhases = [
    "'local_inventory'",
    "'remote_inventory'",
    "'resolving_paths'",
    "'hashing_remote'",
    "'processing_changes'",
    "'processing_local_changes'",
    "'reconciling'",
    "'finalizing'",
  ];
  if (!coordinator.includes('export interface SyncProgress') ||
      requiredPhases.some(phase => !coordinator.includes(phase)) ||
      !coordinator.includes('getSyncProgress()') ||
      !coordinator.includes('beginSyncProgress(') ||
      !coordinator.includes('reportSyncProgress(') ||
      !coordinator.includes('this.syncProgress = null') ||
      !coordinator.includes('REMOTE_HASH_CONCURRENCY = 8')) {
    console.error('FAIL: Sync/full reconciliation does not expose canonical bounded live progress');
    return false;
  }

  if (!view.includes('formatSyncProgress(') ||
      !view.includes('startSyncProgressTicker(') ||
      !view.includes('last progress update') ||
      !view.includes('triggerFullReconciliation(onProgress)') ||
      !view.includes('triggerManualSync(onProgress)')) {
    console.error('FAIL: Sync Center does not project coordinator-owned phase/progress/heartbeat state');
    return false;
  }

  console.log('PASS: Drive requests are deadline-bounded and sync progress remains coordinator-owned and observable');
  return true;
}

function checkManualStartupStateHydration() {
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');

  if (!coordinator.includes('async hydratePersistedState(): Promise<void>') ||
      !coordinator.includes('await this.loadSyncState()') ||
      !coordinator.includes('this.rehydrateConflicts()')) {
    console.error('FAIL: Coordinator does not own local persisted-state hydration');
    return false;
  }

  const constructionIndex = main.indexOf('this.driveSyncCoordinator = new DriveSyncCoordinator(');
  const hydrateIndex = main.indexOf('await this.driveSyncCoordinator.hydratePersistedState()', constructionIndex);
  const viewContextIndex = main.indexOf('this.viewContext = {', constructionIndex);
  if (constructionIndex < 0 || hydrateIndex < 0 || viewContextIndex < 0 || hydrateIndex > viewContextIndex) {
    console.error('FAIL: Sync UI can be exposed before device-local sync state is hydrated');
    return false;
  }

  const hydrateBodyStart = coordinator.indexOf('async hydratePersistedState(): Promise<void>');
  const hydrateBodyEnd = coordinator.indexOf('\n  }', hydrateBodyStart);
  const hydrateBody = hydrateBodyStart >= 0 && hydrateBodyEnd > hydrateBodyStart
    ? coordinator.slice(hydrateBodyStart, hydrateBodyEnd)
    : '';
  if (hydrateBody.includes('driveAdapter.') || hydrateBody.includes('reconcile(')) {
    console.error('FAIL: Manual startup hydration performs Drive/network reconciliation');
    return false;
  }

  console.log('PASS: Manual startup hydrates device-local sync state before UI without network reconciliation');
  return true;
}

function checkFirstPairingApplyProgress() {
  const coordinatorPath = path.join(rootDir, 'src/sync/coordinator/index.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');

  const requiredPhases = [
    "'revalidating_remote'",
    "'baselining'",
    "'adopting_local'",
    "'pulling_remote'",
    "'finalizing'",
  ];
  if (!coordinator.includes('export interface PairingApplyProgress') ||
      requiredPhases.some(phase => !coordinator.includes(phase)) ||
      !coordinator.includes('onProgress?: (progress: PairingApplyProgress) => void') ||
      !coordinator.includes('private pairingApplyInProgress = false') ||
      !coordinator.includes('private pairingLastError: string | null = null') ||
      !coordinator.includes('isPairingApplyInProgress()') ||
      !coordinator.includes('getPairingApplyProgress()') ||
      !coordinator.includes('getPairingLastError()')) {
    console.error('FAIL: First-pairing mutation stage does not expose canonical apply progress');
    return false;
  }
  if (!main.includes("question.textContent = 'Pairing is in progress.'") ||
      !main.includes('confirmButton.disabled = true') ||
      !main.includes('Keep Obsidian open') ||
      !main.includes('renderPairingWorkflowError') ||
      !main.includes("'Pairing did not finish'") ||
      !main.includes("'Copy error'") ||
      !main.includes('await this.refreshQuartzoView()')) {
    console.error('FAIL: Pairing UI can become visually idle/stale while first-pairing mutations are running');
    return false;
  }
  if (!main.includes('private pairingWorkflowModal: HTMLDivElement | null = null') ||
      !main.includes('createPairingWorkflowSurface()') ||
      !main.includes('renderSafeDuplicateTrashConfirmation(') ||
      !main.includes('renderPairingSummaryContent(') ||
      !main.includes('Rescanning the vaults') ||
      main.includes('confirmSafeDuplicateTrash(') ||
      main.includes('new Modal(this.app)')) {
    console.error('FAIL: First pairing can split diagnostics, cleanup confirmation, rescan, or apply progress across stacked modal surfaces');
    return false;
  }
  const viewPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const view = fs.readFileSync(viewPath, 'utf8');
  if (!view.includes('coordinator?.isPairingApplyInProgress()') ||
      !view.includes('Pairing is in progress. Keep Obsidian open.') ||
      !view.includes('Pairing in progress…') ||
      !view.includes('Last pairing attempt failed:') ||
      !view.includes('Companion version:')) {
    console.error('FAIL: Sync view can offer a second pairing while the coordinator still owns an active pairing');
    return false;
  }
  const typesPath = path.join(rootDir, 'src/sync/coordinator/types.ts');
  const types = fs.readFileSync(typesPath, 'utf8');
  const adapterPath = path.join(rootDir, 'src/integrations/google/drive/adapter.ts');
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  if (!types.includes('export class TemporaryDriveQuotaError') ||
      !adapter.includes('throw new TemporaryDriveQuotaError') ||
      !coordinator.includes('error instanceof TemporaryDriveQuotaError')) {
    console.error('FAIL: Persistent temporary Drive quota does not abort pairing through a canonical typed error');
    return false;
  }
  console.log('PASS: First-pairing progress/failure is globally visible, single-owner, and aborts persistent quota safely');
  return true;
}

function checkCanonicalOccurrenceActions() {
  const servicePath = path.join(rootDir, 'src/core/occurrence_actions/service.ts');
  const policyPath = path.join(rootDir, 'src/core/occurrence_actions/policy.ts');
  const identityPath = path.join(rootDir, 'src/core/occurrence_actions/identity.ts');
  const statePath = path.join(rootDir, 'src/vault/occurrence-state.ts');
  const domainPath = path.join(rootDir, 'src/vault/occurrence-domain-mutations.ts');
  const schedulePath = path.join(rootDir, 'src/core/daily_schedule/engine.ts');
  const viewPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const scheduleListPath = path.join(rootDir, 'src/ui/daily/schedule-list.ts');
  const controlsPath = path.join(rootDir, 'src/ui/occurrence/action-controls.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');

  const service = fs.readFileSync(servicePath, 'utf8');
  const policy = fs.readFileSync(policyPath, 'utf8');
  const identity = fs.readFileSync(identityPath, 'utf8');
  const state = fs.readFileSync(statePath, 'utf8');
  const domain = fs.readFileSync(domainPath, 'utf8');
  const schedule = fs.readFileSync(schedulePath, 'utf8');
  const view = fs.readFileSync(viewPath, 'utf8');
  const scheduleList = fs.readFileSync(scheduleListPath, 'utf8');
  const controls = fs.readFileSync(controlsPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');

  if (!service.includes('export class OccurrenceActionService') ||
      !service.includes('processedActionIds.includes(normalizedActionId)') ||
      !service.includes('await this.options.store.replaceResponses(previousResponses)') ||
      service.includes('findObjectPath(') ||
      service.includes('syncQueue')) {
    console.error('FAIL: Occurrence actions are not owned by the canonical idempotent coordinator');
    return false;
  }
  if (!state.includes("SHARED_OCCURRENCE_STATE_PATH = 'sessions/shared_occurrence_state_v1.md'") ||
      !state.includes('await this.vault.process(') ||
      !domain.includes('await this.vault.process(')) {
    console.error('FAIL: Shared occurrence/domain writes bypass the canonical Vault.process repositories');
    return false;
  }
  if (!identity.includes('normalizedId.endsWith') ||
      !schedule.includes('occurrenceResponseIdForDailyItem(item.id, item.date)') ||
      !schedule.includes('actionOccurrenceId')) {
    console.error('FAIL: Companion occurrence actions do not use the app canonical dated identity');
    return false;
  }
  const reportDoneStart = policy.indexOf('function canReportDone(');
  const reportDoneEnd = policy.indexOf('function canSkip(', reportDoneStart);
  const reportDoneBlock = reportDoneStart >= 0 && reportDoneEnd > reportDoneStart
    ? policy.slice(reportDoneStart, reportDoneEnd)
    : '';
  if (!reportDoneBlock || reportDoneBlock.includes("'systemRun'")) {
    console.error('FAIL: Scheduled System exposes a generic Done owner instead of Run + Finish evidence');
    return false;
  }
  if (!schedule.includes('isScheduledSystemOccurrenceCompleted') ||
      !schedule.includes("sourceType === 'system' ? false") ||
      !schedule.includes('occurrenceId: `system:${id}@${date}`')) {
    console.error('FAIL: Daily Schedule System completion is not exact execution evidence by canonical occurrence ID');
    return false;
  }
  if (!policy.includes('export class OccurrenceActionPolicy') ||
      !controls.includes('OccurrenceActionPolicy.resolve({') ||
      !controls.includes('options.perform(action, actionOptions)') ||
      !scheduleList.includes('renderOccurrenceActionControls(row, {') ||
      !view.includes('renderDailyScheduleList(container, items, {') ||
      view.includes('occurrence_responses') ||
      scheduleList.includes('occurrence_responses') ||
      controls.includes('occurrence_responses')) {
    console.error('FAIL: Daily UI owns occurrence business state instead of projecting the canonical policy/coordinator');
    return false;
  }
  if (!main.includes('companionOccurrenceDomainMode(item.sourceType)') ||
      !main.includes("domainMode === 'unsupported'") ||
      !service.includes('completeDomainOccurrence') ||
      !service.includes('clearDomainOccurrence')) {
    console.error('FAIL: Required source-domain side effects can be partially applied instead of failing closed');
    return false;
  }

  console.log('PASS: Occurrence actions are canonical, idempotent, dated, Vault-safe and fail closed on unsupported domain parity');
  return true;
}
function checkCanonicalManualExecution() {
  const coreDir = path.join(rootDir, 'src/core/manual-execution');
  const policyPath = path.join(coreDir, 'policy.ts');
  const systemPath = path.join(coreDir, 'system.ts');
  const routinePath = path.join(coreDir, 'routine.ts');
  const referencesPath = path.join(coreDir, 'references.ts');
  const effectivePath = path.join(coreDir, 'effective-state.ts');
  const repositoryPath = path.join(rootDir, 'src/vault/manual-execution.ts');
  const controlsPath = path.join(rootDir, 'src/ui/occurrence/action-controls.ts');
  const listPath = path.join(rootDir, 'src/ui/daily/schedule-list.ts');
  const modalPath = path.join(rootDir, 'src/ui/execution/manual-execution-modal.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const vectorsPath = path.join(rootDir, 'contracts/quartzo/system_routine_execution/vectors.json');
  const lockPath = path.join(rootDir, 'contracts/UPSTREAM.lock.json');

  for (const file of [
    policyPath, systemPath, routinePath, referencesPath, effectivePath,
    repositoryPath, controlsPath, listPath, modalPath, mainPath, vectorsPath, lockPath,
  ]) {
    if (!fs.existsSync(file)) {
      console.error(`FAIL: Manual execution canonical file missing: ${path.relative(rootDir, file)}`);
      return false;
    }
  }

  const policy = fs.readFileSync(policyPath, 'utf8');
  const system = fs.readFileSync(systemPath, 'utf8');
  const routine = fs.readFileSync(routinePath, 'utf8');
  const references = fs.readFileSync(referencesPath, 'utf8');
  const effective = fs.readFileSync(effectivePath, 'utf8');
  const repository = fs.readFileSync(repositoryPath, 'utf8');
  const controls = fs.readFileSync(controlsPath, 'utf8');
  const list = fs.readFileSync(listPath, 'utf8');
  const modal = fs.readFileSync(modalPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  if (!Array.isArray(vectors) || vectors.length === 0 ||
      lock.contractVersions?.systemRoutineExecutionContractVersion !== '1.1.0' ||
      !lock.manifest?.['system_routine_execution/vectors.json']) {
    console.error('FAIL: Manual execution is not pinned to the vendored executable contract');
    return false;
  }

  if (!policy.includes('resolveManualExecutionRunCapability') ||
      !policy.includes("return 'requiresFocusRuntime'") ||
      !policy.includes('allowsBackgroundAutoRun') ||
      !system.includes('finalizeSystemRun') ||
      !system.includes('execution_history') ||
      !system.includes('systemSummaryTaskId') ||
      !system.includes('isScheduledSystemOccurrenceCompleted') ||
      !system.includes('occurrence_id') ||
      !system.includes('scheduled_for') ||
      !system.includes('different scheduled occurrence context') ||
      !routine.includes('manualRoutineOccurrenceId') ||
      !routine.includes('routine_executions_version: 2') ||
      !references.includes('resolveManualExecutionReferences') ||
      !effective.includes('resolveEffectiveLinkedSteps')) {
    console.error('FAIL: Manual execution semantics are not owned by the canonical pure core');
    return false;
  }

  if (!repository.includes('export class ManualExecutionRepository') ||
      repository.split('await this.vault.process(').length - 1 < 2 ||
      !repository.includes('ensureSystemSummaryTask') ||
      !repository.includes("resolveCreationFolder(settings, 'task')")) {
    console.error('FAIL: System/Routine execution persistence bypasses the canonical Vault adapter');
    return false;
  }

  if (!main.includes('prepareManualExecution(item)') ||
      !main.includes('resolveManualExecutionRunCapability(') ||
      !main.includes('new ManualExecutionModal(') ||
      !main.includes('this.manualExecutionRepository') ||
      !main.includes('OccurrenceActionService') ||
      !main.includes("source.type === 'system' && scheduledOccurrence") ||
      !main.includes('{ occurrenceId: run.occurrenceId, scheduledFor: run.scheduledFor }') ||
      !controls.includes('manualExecutionCapability') ||
      !controls.includes('startManualExecution') ||
      !list.includes('manualExecutionCapability: options.manualExecutionCapability?.(item)') ||
      !modal.includes('options.finish(this.plainCompletions)')) {
    console.error('FAIL: UI/composition root does not project the canonical manual execution owner');
    return false;
  }

  if (controls.includes('execution_history') ||
      controls.includes('routine_executions') ||
      list.includes('execution_history') ||
      list.includes('routine_executions') ||
      modal.includes('execution_history') ||
      modal.includes('routine_executions')) {
    console.error('FAIL: Manual execution UI serializes execution evidence directly');
    return false;
  }

  console.log('PASS: System/Routine manual Run is vector-pinned, whole-run gated, Vault-safe and single-owner');
  return true;
}


function checkCanonicalFocusRuntime() {
  const contractPath = path.join(rootDir, 'src/core/focus-runtime/contract.ts');
  const codecPath = path.join(rootDir, 'src/core/focus-runtime/state-codec.ts');
  const runtimePath = path.join(rootDir, 'src/core/focus-runtime/runtime.ts');
  const repositoryPath = path.join(rootDir, 'src/vault/focus-runtime.ts');
  const focusViewPath = path.join(rootDir, 'src/ui/focus/view.ts');
  const manualModalPath = path.join(rootDir, 'src/ui/execution/manual-execution-modal.ts');
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const parserPath = path.join(rootDir, 'src/core/objects/parser.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const sharedCorePath = path.join(rootDir, 'src/core/shared-settings.ts');
  const sharedVaultPath = path.join(rootDir, 'src/vault/shared-settings.ts');
  const vectorsPath = path.join(rootDir, 'contracts/quartzo/focus_runtime/vectors.json');
  const lockPath = path.join(rootDir, 'contracts/UPSTREAM.lock.json');

  for (const file of [
    contractPath, codecPath, runtimePath, repositoryPath, focusViewPath,
    manualModalPath, shellPath, parserPath, mainPath, sharedCorePath,
    sharedVaultPath, vectorsPath, lockPath,
  ]) {
    if (!fs.existsSync(file)) {
      console.error(`FAIL: Focus runtime canonical file missing: ${path.relative(rootDir, file)}`);
      return false;
    }
  }

  const contract = fs.readFileSync(contractPath, 'utf8');
  const codec = fs.readFileSync(codecPath, 'utf8');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  const repository = fs.readFileSync(repositoryPath, 'utf8');
  const focusView = fs.readFileSync(focusViewPath, 'utf8');
  const manualModal = fs.readFileSync(manualModalPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const parser = fs.readFileSync(parserPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const shared = fs.readFileSync(sharedCorePath, 'utf8') + '\n'
    + fs.readFileSync(sharedVaultPath, 'utf8');
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  if (!Array.isArray(vectors) || vectors.length === 0 ||
      lock.contractVersions?.focusRuntimeContractVersion !== '1.0.0' ||
      !lock.manifest?.['focus_runtime/vectors.json']) {
    console.error('FAIL: Focus runtime is not pinned to the vendored executable contract');
    return false;
  }

  if (contract.includes("from 'obsidian'") ||
      codec.includes("from 'obsidian'") ||
      runtime.includes("from 'obsidian'") ||
      !contract.includes('resolveFocusRuntimeControl') ||
      !contract.includes('focusRemainingSeconds') ||
      !contract.includes('focusChecklistLinkId') ||
      !runtime.includes('startFocusRuntime') ||
      !runtime.includes('finishFocusRuntime')) {
    console.error('FAIL: Focus runtime pure semantics are not isolated in the canonical core');
    return false;
  }

  if (!repository.includes("FOCUS_RUNTIME_PATH = 'sessions/current.md'") ||
      !repository.includes('export class FocusRuntimeRepository') ||
      !repository.includes('await this.vault.process(file, current =>') ||
      !repository.includes('pomodoro_sessions') ||
      !repository.includes('Focus runtime changed before finalization') ||
      !codec.includes('...existing')) {
    console.error('FAIL: Focus persistence bypasses the single Vault-safe adapter or drops unknown fields');
    return false;
  }

  if (!main.includes('focusControllerId') ||
      !main.includes('createCanonicalObjectId()') ||
      shared.includes('focusControllerId') ||
      !main.includes('new FocusRuntimeRepository(this.app.vault)') ||
      !main.includes('resolveFocusRuntimeControl({') ||
      !main.includes("clientKind: 'companion'") ||
      !main.includes('FOCUS_RUNTIME_PATH') ||
      !main.includes('processFocusRuntimeTick(') ||
      !main.includes('startChecklistFocus(') ||
      !main.includes('focusChecklistLinkId(parentObjectId, step.id)') ||
      !main.includes('focusRuntimeAvailable: this.focusRuntimeRepository != null')) {
    console.error('FAIL: Focus controller identity/lifecycle/manual-execution wiring bypasses the canonical owner');
    return false;
  }

  if (!focusView.includes('controlled by another device') ||
      !focusView.includes('!initial.canControl') ||
      !focusView.includes('renderFocusRuntime(') ||
      focusView.includes('extends Modal') ||
      main.includes('FocusRuntimeModal') ||
      !shell.includes("this.action === 'focus'") ||
      !shell.includes('renderFocusRuntime(content, this.context.plugin)') ||
      !manualModal.includes('renderFocusRuntime(contentEl, this.options.focusController')) {
    console.error('FAIL: Focus UI is not a shared inline read-only projection of the canonical runtime');
    return false;
  }

  if (!parser.includes("'daily': 'daily_note'") ||
      !parser.includes("objectType === 'daily_note'") ||
      !parser.includes('frontmatter.id ?? frontmatter.date')) {
    console.error('FAIL: Quartzo daily Focus evidence is not projected through the canonical VaultIndex parser');
    return false;
  }

  console.log('PASS: Focus runtime is vector-pinned, timestamp-based, device-owned, Vault-safe and single-owner');
  return true;
}

function checkCanonicalOccurrenceReschedule() {
  const servicePath = path.join(rootDir, 'src/core/occurrence_reschedule/service.ts');
  const codecPath = path.join(rootDir, 'src/core/occurrence_reschedule/state-codec.ts');
  const planningPath = path.join(rootDir, 'src/vault/planning-state.ts');
  const actionTypesPath = path.join(rootDir, 'src/core/occurrence_actions/types.ts');
  const controlsPath = path.join(rootDir, 'src/ui/occurrence/action-controls.ts');
  const schedulePath = path.join(rootDir, 'src/core/daily_schedule/engine.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');

  for (const file of [servicePath, codecPath, planningPath, actionTypesPath, controlsPath, schedulePath, mainPath]) {
    if (!fs.existsSync(file)) {
      console.error(`FAIL: Reschedule canonical file missing: ${path.relative(rootDir, file)}`);
      return false;
    }
  }

  const service = fs.readFileSync(servicePath, 'utf8');
  const codec = fs.readFileSync(codecPath, 'utf8');
  const planning = fs.readFileSync(planningPath, 'utf8');
  const actionTypes = fs.readFileSync(actionTypesPath, 'utf8');
  const controls = fs.readFileSync(controlsPath, 'utf8');
  const schedule = fs.readFileSync(schedulePath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');

  if (!service.includes('planOccurrenceReschedule(') ||
      !service.includes("storage: 'source_task'") ||
      !service.includes("storage: 'shared_planning_override'") ||
      !service.includes('OccurrenceActionPolicy.resolve({')) {
    console.error('FAIL: Reschedule is not owned by the canonical capability-gated planning owner');
    return false;
  }
  if (!planning.includes("SHARED_PLANNING_STATE_PATH = 'sessions/shared_planning_state_v1.md'") ||
      !planning.includes('await this.vault.process(file, current =>') ||
      !codec.includes('...parsed.frontmatter') ||
      !codec.includes('...rawOverrides') ||
      !codec.includes('...existing')) {
    console.error('FAIL: Reschedule planning writes can bypass Vault.process or discard unknown planning fields');
    return false;
  }
  if (actionTypes.includes("'reschedule'") ||
      !controls.includes('const reschedule = options.reschedule') ||
      !controls.includes('capabilities.canReplan && reschedule') ||
      !main.includes('performOccurrenceReschedule(')) {
    console.error('FAIL: Reschedule is mixed into occurrence responses or bypasses the shared UI callback');
    return false;
  }
  if (!schedule.includes('occurrenceOverrides') ||
      !schedule.includes('obj.scheduled_time ?? obj.time') ||
      !main.includes('getOccurrenceOverrides()') ||
      !main.includes('SHARED_PLANNING_STATE_PATH')) {
    console.error('FAIL: Shared Reschedule state is not projected back through the canonical Daily Schedule');
    return false;
  }

  console.log('PASS: Reschedule is a canonical planning mutation, Vault-safe and separate from occurrence responses');
  return true;
}
function checkCanonicalHomeAndDayDial() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const homePath = path.join(rootDir, 'src/ui/home/view.ts');
  const homeProjectionPath = path.join(rootDir, 'src/ui/home/home-projection.ts');
  const dialProjectionPath = path.join(rootDir, 'src/ui/day-dial/projection.ts');
  const dialViewPath = path.join(rootDir, 'src/ui/day-dial/view.ts');

  const shell = fs.readFileSync(shellPath, 'utf8');
  const home = fs.readFileSync(homePath, 'utf8');
  const homeProjection = fs.readFileSync(homeProjectionPath, 'utf8');
  const dialProjection = fs.readFileSync(dialProjectionPath, 'utf8');
  const dialView = fs.readFileSync(dialViewPath, 'utf8');

  if (!shell.includes('renderHomeView(container, {') ||
      !shell.includes('schedule,') ||
      !home.includes('projectHomeSchedule(options.schedule') ||
      !home.includes('renderDayDial(container, {') ||
      !home.includes('schedule: options.schedule')) {
    console.error('FAIL: Home and Day Dial are not projections of the same canonical Daily Schedule snapshot');
    return false;
  }

  const forbiddenOwners = ['DailyScheduleEngine', 'Scheduler', 'ObjectParser', 'GoogleCalendarAdapter'];
  if (forbiddenOwners.some(owner => home.includes(owner) || dialProjection.includes(owner) || dialView.includes(owner))) {
    console.error('FAIL: Home/Day Dial reintroduces canonical scheduling/parser/integration business owners in UI');
    return false;
  }

  if (!dialProjection.includes('DAY_DIAL_SHORT_OCCURRENCE_MINUTES = 24') ||
      !dialProjection.includes("duration <= DAY_DIAL_SHORT_OCCURRENCE_MINUTES") ||
      !dialProjection.includes("visual: rawEnd == null") ||
      !dialProjection.includes('item.isAllDay || !item.isTimed') ||
      !dialProjection.includes('resolveTypeSignature') ||
      !dialProjection.includes('object?.frontmatter.color')) {
    console.error('FAIL: Day Dial geometry/color contract is not the canonical 24h marker/arc projection');
    return false;
  }

  if (!homeProjection.includes('Pure presentation projection over the canonical Daily Schedule result') ||
      homeProjection.includes('overdue_policy') ||
      homeProjection.includes('scheduler')) {
    console.error('FAIL: Home projection can independently decide recurrence/overdue/scheduler business semantics');
    return false;
  }

  console.log('PASS: Home and Day Dial share the canonical Daily Schedule and keep Dial work presentation-only');
  return true;
}


function checkCanonicalPlannerProjection() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const plannerPath = path.join(rootDir, 'src/ui/planner/view.ts');
  const adaptivePath = path.join(rootDir, 'src/ui/planner/adaptive-projection.ts');
  const policyPath = path.join(rootDir, 'src/core/occurrence_actions/policy.ts');

  const shell = fs.readFileSync(shellPath, 'utf8');
  const planner = fs.readFileSync(plannerPath, 'utf8');
  const adaptive = fs.readFileSync(adaptivePath, 'utf8');
  const policy = fs.readFileSync(policyPath, 'utf8');

  if (!shell.includes('renderPlannerSurface(container, {') ||
      !shell.includes('this.buildSchedule(date, googleEvents)') ||
      !planner.includes('projectAdaptivePlanner(schedule') ||
      !planner.includes('schedulesByDate') ||
      !adaptive.includes('OccurrenceActionPolicy.isRecoveryEligible') ||
      !policy.includes('static isRecoveryEligible(')) {
    console.error('FAIL: Planner does not project canonical Daily Schedule/Occurrence policy owners');
    return false;
  }

  const forbiddenOwners = ['DailyScheduleEngine', 'Scheduler', 'ObjectParser', 'GoogleCalendarAdapter'];
  if (forbiddenOwners.some(owner => planner.includes(owner) || adaptive.includes(owner))) {
    console.error('FAIL: Planner UI reintroduces canonical scheduler/parser/integration owners');
    return false;
  }

  if (!adaptive.includes('planningState: DailyPlanningState') ||
      !adaptive.includes('planningState.essentialOccurrenceIds') ||
      !adaptive.includes('planningState.parkedOccurrenceIds') ||
      !adaptive.includes('capacityMode: planningState.capacityMode') ||
      !adaptive.includes('capacity: null') ||
      !adaptive.includes('numericCapacityShared: false')) {
    console.error('FAIL: Planner Adaptive does not consume canonical DailyPlanningState IDs/capacity mode with numeric capacity unavailable');
    return false;
  }

  if (adaptive.includes('CompanionCapacityEngine') || adaptive.includes('capacitySummary')) {
    console.error('FAIL: Planner Adaptive can invent numeric capacity locally');
    return false;
  }

  if (!planner.includes('quartzo-planner-week-grid') ||
      !planner.includes('quartzo-planner-month-grid') ||
      !planner.includes('startOfWeek')) {
    console.error('FAIL: Planner Week/Month are not real shared-settings-aware grid surfaces');
    return false;
  }

  console.log('PASS: Planner is a presentation-only projection of canonical Daily Schedule and occurrence policy');
  return true;
}


function checkCanonicalUniversalDetailMutation() {
  const capabilityPath = path.join(rootDir, 'src/core/object-mutation/capabilities.ts');
  const mutationPath = path.join(rootDir, 'src/core/object-mutation/mutation.ts');
  const repositoryPath = path.join(rootDir, 'src/vault/object-mutation.ts');
  const detailPath = path.join(rootDir, 'src/ui/detail/object-detail.ts');
  const editorPath = path.join(rootDir, 'src/ui/detail/object-editor.ts');
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');

  const capability = fs.readFileSync(capabilityPath, 'utf8');
  const mutation = fs.readFileSync(mutationPath, 'utf8');
  const repository = fs.readFileSync(repositoryPath, 'utf8');
  const detail = fs.readFileSync(detailPath, 'utf8');
  const editor = fs.readFileSync(editorPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');

  if (!capability.includes("object_fixtures/coverage.json") ||
      !capability.includes("mutationSupport === 'full'") ||
      !capability.includes("fixtureCoverage === 'concrete_mutation'")) {
    console.error('FAIL: Universal Detail edit capability is not derived from vendored contract coverage');
    return false;
  }

  if (!mutation.includes('ObjectParser.parseMarkdown(currentMarkdown)') ||
      !mutation.includes("PROTECTED_KEYS = new Set(['id', 'type'])") ||
      !mutation.includes('hasFullObjectMutationSupport(expected.type)')) {
    console.error('FAIL: Universal Detail mutation can reconstruct objects or change protected identity');
    return false;
  }

  if (!repository.includes('await this.vault.process(file, current =>') ||
      repository.includes('vault.modify(')) {
    console.error('FAIL: Universal Detail edits bypass the canonical Vault.process repository');
    return false;
  }

  if (!detail.includes('hasFullObjectMutationSupport(object.type)') ||
      !editor.includes('const dirty = new Set<string>()') ||
      !editor.includes('actions.onSave(patch)') ||
      !shell.includes('this.context.plugin.mutateObject(object, patch)')) {
    console.error('FAIL: Universal Detail UI can expose/save edits outside the canonical capability/mutation path');
    return false;
  }

  if (shell.includes('ObjectParser.serializeMarkdown') ||
      shell.includes('vault.process(') ||
      editor.includes('ObjectParser.serializeMarkdown') ||
      editor.includes('vault.process(')) {
    console.error('FAIL: Universal Detail UI owns persistence instead of delegating to the canonical mutation owner');
    return false;
  }

  console.log('PASS: Universal Detail editing is coverage-gated, dirty-tracked and Vault.process-safe');
  return true;
}


function checkCanonicalObjectQueryOwner() {
  const queryPath = path.join(rootDir, 'src/core/object-query/index.ts');
  const enginePath = path.join(rootDir, 'src/vault/index/engine.ts');
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const quickAddPath = path.join(rootDir, 'src/ui/quick-add/modal.ts');

  const query = fs.readFileSync(queryPath, 'utf8');
  const engine = fs.readFileSync(enginePath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const quickAdd = fs.readFileSync(quickAddPath, 'utf8');

  if (!query.includes('index.objects.values()') ||
      query.includes('new Map(') ||
      !query.includes('queryVaultObjects(')) {
    console.error('FAIL: Object query owner is missing or creates a parallel index/cache');
    return false;
  }

  if (!engine.includes('return searchVaultObjects(index, query);') ||
      shell.includes('VaultIndexEngine.searchObjects(') ||
      !shell.includes('queryVaultObjects(this.getIndex()') ||
      !quickAdd.includes("queryVaultObjects(index, { types: ['resource'] })") ||
      !quickAdd.includes("queryVaultObjects(index, { types: ['tracker_definition'] })")) {
    console.error('FAIL: Search/Browse/pickers can diverge from the canonical VaultIndex query owner');
    return false;
  }

  console.log('PASS: Search, Browse and object pickers share one read-only VaultIndex query owner');
  return true;
}


function checkReminderTargetNavigation() {
  const notificationsPath = path.join(rootDir, 'src/platform/notifications.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const notifications = fs.readFileSync(notificationsPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');

  if (!notifications.includes('openQuartzo: (occurrence: ReminderDeliveryOccurrence) => void') ||
      !notifications.includes('this.openQuartzo(occurrence)') ||
      !main.includes('openReminderOccurrence(occurrence)') ||
      !main.includes('leaf.view.openObjectById(occurrence.sourceId)') ||
      !shell.includes('async openObjectById(objectId: string)')) {
    console.error('FAIL: Reminder desktop click can lose its canonical source target');
    return false;
  }

  if (!main.includes('desktopPermission()') ||
      !main.includes('Desktop permission:')) {
    console.error('FAIL: Reminder desktop permission state is not projected in Settings');
    return false;
  }

  console.log('PASS: Reminder delivery click preserves source identity and permission state is visible');
  return true;
}

function checkCalendarExternalNavigation() {
  const adapterPath = path.join(rootDir, 'src/integrations/google/calendar/adapter.ts');
  const mainPath = path.join(rootDir, 'src/main.ts');
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const browserPath = path.join(rootDir, 'src/platform/browser-opener.ts');
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  const main = fs.readFileSync(mainPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const browser = fs.readFileSync(browserPath, 'utf8');

  if (!adapter.includes('htmlLink?: string') ||
      !main.includes('openGoogleCalendarEvent(event: GoogleCalendarProjection)') ||
      !main.includes('await this.browserOpener.open(event.htmlLink)') ||
      !shell.includes("item.origin !== 'externalEvent'") ||
      !shell.includes('openGoogleCalendarEvent(external)')) {
    console.error('FAIL: Google Calendar external events are not opened through the shared read-only projection path');
    return false;
  }

  if (!browser.includes("parsed.protocol !== 'https:'")) {
    console.error('FAIL: External Calendar links can bypass the HTTPS-only platform opener');
    return false;
  }

  const externalCallbacks = shell.match(/canOpenItem: item => this\.canOpenScheduleItem\(item, googleEvents\)/g) || [];
  if (externalCallbacks.length < 3) {
    console.error('FAIL: Home/Planner/daily schedule surfaces do not share external Calendar opening semantics');
    return false;
  }

  console.log('PASS: Calendar external navigation is HTTPS-only, shared and read-only');
  return true;
}

function checkVaultIndexWaitsForWorkspaceReady() {
  const mainPath = path.join(rootDir, 'src/main.ts');
  const viewPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const main = fs.readFileSync(mainPath, 'utf8');
  const view = fs.readFileSync(viewPath, 'utf8');

  const onloadStart = main.indexOf('async onload()');
  const runtimeStart = main.indexOf('private async initializeVaultRuntime()');
  const indexStart = main.indexOf('private async initializeVaultIndex()');
  if (onloadStart < 0 || runtimeStart < 0 || indexStart < 0) {
    console.error('FAIL: Companion vault startup lifecycle owner is missing');
    return false;
  }

  const onload = main.slice(onloadStart, runtimeStart);
  const runtime = main.slice(runtimeStart, indexStart);
  if (!onload.includes('this.app.workspace.onLayoutReady(() => {') ||
      onload.includes('await this.initializeVaultIndex()') ||
      onload.includes('await this.restoreSessionAndStartSync()') ||
      onload.includes('await this.reminderService.start()')) {
    console.error('FAIL: Vault index/sync/reminders may start before Obsidian workspace layout readiness');
    return false;
  }

  const indexPos = runtime.indexOf('await this.initializeVaultIndex()');
  const eventsPos = runtime.indexOf('this.registerVaultEvents()');
  const readyPos = runtime.indexOf('this.vaultRuntimeReady = true');
  const remindersPos = runtime.indexOf('await this.reminderService?.start()');
  const restorePos = runtime.indexOf('await this.restoreSessionAndStartSync()');
  if (indexPos < 0 || eventsPos < indexPos || readyPos < eventsPos ||
      remindersPos < readyPos || restorePos < remindersPos) {
    console.error('FAIL: Vault runtime readiness order is not index → events → ready → reminders → paired sync');
    return false;
  }

  if (!main.includes("getSharedSettingsState(): 'loading' | 'ready' | 'missing'") ||
      !view.includes('Loading Quartzo vault index…') ||
      !view.includes('Shared Quartzo settings are missing (app/quartzo_shared_settings.md)')) {
    console.error('FAIL: Vault readiness/shared-settings diagnostics are not visible in the Quartzo shell');
    return false;
  }

  console.log('PASS: Vault indexing waits for workspace readiness and missing shared settings stay observable');
  return true;
}

function checkSharedSettingsReloadReindexesVault() {
  const mainPath = path.join(rootDir, 'src/main.ts');
  const main = fs.readFileSync(mainPath, 'utf8');
  const methodStart = main.indexOf('private async reloadSharedSettingsAndIndex(): Promise<void>');
  if (methodStart < 0) {
    console.error('FAIL: Shared settings reload owner is missing');
    return false;
  }
  const methodEnd = main.indexOf('\n  showFirstRunDialog()', methodStart);
  const method = main.slice(methodStart, methodEnd > methodStart ? methodEnd : methodStart + 1600);
  const loadPos = method.indexOf('const sharedSettings = await this.sharedSettingsRepository?.load() ?? null');
  const assignPos = method.indexOf('this.sharedSettings = sharedSettings');
  const indexPos = method.indexOf('await this.initializeVaultIndex()');
  const refreshPos = method.indexOf('await this.refreshQuartzoView()');
  if (loadPos < 0 || assignPos < loadPos || indexPos < assignPos || refreshPos < indexPos) {
    console.error('FAIL: Shared settings change must reload settings, rebuild canonical index, then refresh UI');
    return false;
  }

  const directHook = "normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }";
  const renameHook = "normalizeVaultPath(oldPath) === SHARED_SETTINGS_PATH || normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH";
  const createModifyDeleteCount = main.split(directHook).length - 1;
  if (createModifyDeleteCount < 3 || !main.includes(renameHook)) {
    console.error('FAIL: Shared settings create/modify/delete/rename events must route through canonical reindex');
    return false;
  }

  console.log('PASS: Shared settings create/modify/delete/rename reload the canonical settings projection and vault index');
  return true;
}

function checkC2LifecycleRaceHardening() {
  const main = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');
  const shell = fs.readFileSync(path.join(rootDir, 'src/ui/shell/view.ts'), 'utf8');

  if (!main.includes('private unloaded = false') ||
      !main.includes('this.unloaded = false') ||
      !main.includes('this.unloaded = true') ||
      !main.includes('this.oauthClient?.abort();') ||
      !main.includes('if (this.unloaded || !this.vaultIndexEngine) return;') ||
      !main.includes('if (this.unloaded || !this.driveSyncCoordinator) return;') ||
      !main.includes('if (this.unloaded) return [];')) {
    console.error('FAIL: Plugin lifecycle must guard late OAuth, Calendar, Vault and Drive callbacks after unload');
    return false;
  }

  if (!main.includes('private sharedSettingsReloadInFlight = false') ||
      !main.includes('private sharedSettingsReloadRequested = false') ||
      !main.includes('if (this.sharedSettingsReloadInFlight) {') ||
      !main.includes('this.sharedSettingsReloadRequested = true') ||
      !main.includes('} while (this.sharedSettingsReloadRequested && !this.unloaded);')) {
    console.error('FAIL: Shared settings reloads must coalesce into one active reindex plus one requested rerun');
    return false;
  }

  if (!shell.includes('private renderGeneration = 0') ||
      !shell.includes('private isCurrentRender(container: HTMLElement, generation: number): boolean') ||
      !shell.includes('const generation = ++this.renderGeneration') ||
      !shell.includes('await this.renderHome(content, generation)') ||
      !shell.includes('await this.renderPlanner(content, generation)') ||
      !shell.includes('await this.renderJournal(content, generation)') ||
      !shell.includes("await this.renderSync(content, this.action === 'conflicts', generation)") ||
      !shell.includes('if (!this.isCurrentRender(container, generation)) return;') ||
      !shell.includes('if (this.isCurrentRender(container, generation)) {')) {
    console.error('FAIL: Quartzo shell async renders must reject stale Calendar/Sync callbacks before mutating UI');
    return false;
  }

  console.log('PASS: C2 lifecycle/race hardening guards stale async callbacks, unload and shared-settings reindex coalescing');
  return true;
}

function checkProductionAuditGateResilience() {
  const workflowPaths = [
    '.github/workflows/ci.yml',
    '.github/workflows/release-preflight.yml',
    '.github/workflows/release.yml',
  ];
  const workflows = workflowPaths.map(file =>
    fs.readFileSync(path.join(rootDir, file), 'utf8')
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const script = fs.readFileSync(path.join(rootDir, 'scripts/audit-prod.mjs'), 'utf8');

  if (pkg.scripts?.['audit:prod'] !== 'node scripts/audit-prod.mjs') {
    console.error('FAIL: package audit:prod must route through the canonical production audit script');
    return false;
  }

  for (const [index, workflow] of workflows.entries()) {
    if (!workflow.includes('npm ci --audit=false') ||
        !workflow.includes('npm install --global npm@11.19.1') ||
        !workflow.includes('npm run audit:prod') ||
        workflow.includes('npm audit --omit=dev --audit-level=high')) {
      console.error(`FAIL: ${workflowPaths[index]} must install reproducibly, pin the modern audit client, and use the canonical fail-closed audit gate`);
      return false;
    }
  }

  const ci = workflows[0];
  const ciAuditUses = ci.split('npm run audit:prod').length - 1;
  const ciPinnedClientUses = ci.split('npm install --global npm@11.19.1').length - 1;
  if (ciAuditUses < 3 || ciPinnedClientUses < 3) {
    console.error('FAIL: Linux, Windows and macOS CI must all use the canonical production audit gate');
    return false;
  }

  if (!script.includes('MAX_ATTEMPTS = 3') ||
      !script.includes("const isWindows = process.platform === 'win32'") ||
      !script.includes('shell: isWindows') ||
      !script.includes('Audit command execution error:') ||
      !script.includes('high/critical vulnerabilities') ||
      !script.includes('audit infrastructure remained unavailable after bounded retries') ||
      !script.includes('isInfrastructureFailure')) {
    console.error('FAIL: Production audit gate must be cross-platform, retry only bounded infrastructure failures and still fail closed');
    return false;
  }

  console.log('PASS: CI, preflight and release share one fail-closed modern production dependency audit gate');
  return true;
}

function checkMacosCiParity() {
  const ci = fs.readFileSync(path.join(rootDir, '.github/workflows/ci.yml'), 'utf8');
  const jobStart = ci.indexOf('  test-macos:');
  if (jobStart < 0) {
    console.error('FAIL: CI must include a macOS job');
    return false;
  }

  const nextJob = ci.indexOf('\n  test-', jobStart + 1);
  const job = ci.slice(jobStart, nextJob > jobStart ? nextJob : ci.length);
  const required = [
    'runs-on: macos-latest',
    'npm ci --audit=false',
    'npm install --global npm@11.19.1',
    'npm run audit:prod',
    'npm run contracts:verify',
    'GITHUB_TOKEN: ${{ secrets.QUARTZO_UPSTREAM_TOKEN }}',
    'npm run typecheck',
    'npm run lint',
    'npm test',
    'npm run test:contracts',
    'npm run test:sync',
    'npm run architecture:check',
    'npm run build',
    'npm run release:validate',
    'npm run smoke:clean-artifact',
    'npm run release:package',
  ];

  for (const snippet of required) {
    if (!job.includes(snippet)) {
      console.error(`FAIL: macOS CI is missing required gate: ${snippet}`);
      return false;
    }
  }

  console.log('PASS: macOS CI runs the V1 release gate parity set');
  return true;
}

function checkC4ReleaseDocsAndCapabilityMatrix() {
  const matrixPath = path.join(rootDir, 'docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md');
  const bratPath = path.join(rootDir, 'docs/INSTALL_BRAT.md');
  const p0Path = path.join(rootDir, 'contracts/quartzo/P0_COMPLIANCE_MATRIX.md');
  const readmePath = path.join(rootDir, 'README.md');
  const runbookPath = path.join(rootDir, 'docs/BETA_RELEASE_RUNBOOK.md');
  const oauthPath = path.join(rootDir, 'docs/GOOGLE_OAUTH_SETUP.md');

  if (!fs.existsSync(matrixPath)) {
    console.error('FAIL: V1 capability matrix must exist at docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md');
    return false;
  }

  const matrix = fs.readFileSync(matrixPath, 'utf8');
  const requiredMatrixSnippets = [
    'Task | Full',
    '`daily_note` | Read-only/raw',
    'Google Calendar | Read-only',
    'Focus/Pomodoro runtime | Full within V1 boundary',
    'Numeric DayCapacitySummary in Companion | Unsupported',
    'BRAT clean install',
    'Release Preflight',
  ];
  for (const snippet of requiredMatrixSnippets) {
    if (!matrix.includes(snippet)) {
      console.error(`FAIL: V1 capability matrix missing required coverage: ${snippet}`);
      return false;
    }
  }

  const brat = fs.readFileSync(bratPath, 'utf8');
  if (brat.includes('0.1.0-beta.1') || brat.includes('feature/companion-v1-beta')) {
    console.error('FAIL: BRAT install docs must not pin stale beta version or feature branch');
    return false;
  }
  if (!brat.includes('latest validated GitHub prerelease') || !brat.includes('manifest.json')) {
    console.error('FAIL: BRAT install docs must point to the validated prerelease/version metadata flow');
    return false;
  }

  const p0 = fs.readFileSync(p0Path, 'utf8');
  if (p0.includes('](../../../.agents/AGENTS.md)')) {
    console.error('FAIL: vendored P0 compliance matrix must not link to a Companion-local .agents/AGENTS.md path');
    return false;
  }

  const docs = [
    fs.readFileSync(readmePath, 'utf8'),
    fs.readFileSync(runbookPath, 'utf8'),
    fs.readFileSync(oauthPath, 'utf8'),
  ].join('\n');
  if (!docs.includes('COMPANION_V1_CAPABILITY_MATRIX.md') || !docs.includes('não configura, envia nem empacota Client Secret')) {
    console.error('FAIL: release docs must link the V1 capability matrix and document the no-secret OAuth boundary');
    return false;
  }

  console.log('PASS: C4 release docs and V1 capability matrix are present and not stale');
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
  if (!checkReminderRuntimeBoundaries()) allPassed = false;
  if (!checkConflictResolutionIsExplicit()) allPassed = false;
  if (!checkDeviceLocalSettingsBoundaries()) allPassed = false;
  if (!checkObsidianSecretStorageIds()) allPassed = false;
  if (!checkOAuthDesktopPlatformBoundary()) allPassed = false;
  if (!checkReleasePipelineHardening()) allPassed = false;
  if (!checkProductionAuditGateResilience()) allPassed = false;
  if (!checkMacosCiParity()) allPassed = false;
  if (!checkC4ReleaseDocsAndCapabilityMatrix()) allPassed = false;
  if (!checkPairingDuplicateCleanupIsReversible()) allPassed = false;
  if (!checkPostPairingDuplicateRecovery()) allPassed = false;
  if (!checkDriveQuotaResilience()) allPassed = false;
  if (!checkDriveTimeoutsAndSyncProgress()) allPassed = false;
  if (!checkManualStartupStateHydration()) allPassed = false;
  if (!checkVaultIndexWaitsForWorkspaceReady()) allPassed = false;
  if (!checkSharedSettingsReloadReindexesVault()) allPassed = false;
  if (!checkC2LifecycleRaceHardening()) allPassed = false;
  if (!checkCanonicalOccurrenceActions()) allPassed = false;
  if (!checkCanonicalManualExecution()) allPassed = false;
  if (!checkCanonicalFocusRuntime()) allPassed = false;
  if (!checkCanonicalOccurrenceReschedule()) allPassed = false;
  if (!checkCanonicalHomeAndDayDial()) allPassed = false;
  if (!checkCanonicalPlannerProjection()) allPassed = false;
  if (!checkCanonicalUniversalDetailMutation()) allPassed = false;
  if (!checkCanonicalObjectQueryOwner()) allPassed = false;
  if (!checkReminderTargetNavigation()) allPassed = false;
  if (!checkCalendarExternalNavigation()) allPassed = false;
  if (!checkFirstPairingApplyProgress()) allPassed = false;

  console.log('\n' + (allPassed ? 'All architecture checks passed' : 'Some architecture checks failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
