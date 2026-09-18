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
  if (!platform.includes("from 'obsidian'") || !platform.includes('requestDesktopPermission()')) {
    console.error('FAIL: Reminder platform delivery owner is incomplete');
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
  if (ids.length < 2 || ids.some(id => !/^[a-z0-9-]{1,64}$/.test(id))) {
    console.error(`FAIL: Obsidian SecretStorage IDs must match ^[a-z0-9-]{1,64}$; found: ${ids.join(', ') || '(none)'}`);
    return false;
  }
  if (main.includes('quartzo_companion/') || loopback.includes('quartzo_companion/')) {
    console.error('FAIL: Legacy invalid Obsidian SecretStorage IDs remain in runtime OAuth paths');
    return false;
  }
  if (!main.includes('GOOGLE_OAUTH_CLIENT_SECRET_ID') || !loopback.includes('GOOGLE_REFRESH_TOKEN_SECRET_ID')) {
    console.error('FAIL: Runtime OAuth paths bypass the canonical SecretStorage ID owner');
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
  const secretParams = loopback.match(/params\.append\('client_secret'/g) || [];
  if (secretParams.length < 2) {
    console.error('FAIL: OAuth desktop token exchange/refresh does not send the configured client credential');
    return false;
  }
  console.log('PASS: OAuth desktop browser launch stays inside Obsidian/Electron with loopback PKCE and client credential token exchange');
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
  if (!release.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET') || !preflight.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET') || !validate.includes('QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET')) {
    console.error('FAIL: Release/preflight/validator do not require the Google Desktop OAuth client credential');
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
  if (!adapter.includes('async trashFile(') || !adapter.includes('requestBody: { trashed: true }')) {
    console.error('FAIL: Google Drive adapter does not implement reversible trash semantics for pairing cleanup');
    return false;
  }
  if (!main.includes('Move safe duplicates to Drive trash?') || !main.includes('Nothing is permanently deleted')) {
    console.error('FAIL: Pairing duplicate cleanup lacks explicit reversible user confirmation');
    return false;
  }
  console.log('PASS: Pairing duplicate cleanup is explicit, content-proven and reversible through Drive trash');
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
  if (!coordinator.includes('pairingRemoteHashCache') ||
      !coordinator.includes('cached.modifiedTime === modifiedTime') ||
      !coordinator.includes('resolvePairingRemoteHash')) {
    console.error('FAIL: Pairing rescans do not reuse proven legacy hashes by remote ID + modifiedTime');
    return false;
  }
  console.log('PASS: Drive quota handling backs off per request and pairing rescans reuse proven hashes');
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
      !coordinator.includes('onProgress?: (progress: PairingApplyProgress) => void')) {
    console.error('FAIL: First-pairing mutation stage does not expose canonical apply progress');
    return false;
  }
  if (!main.includes("question.textContent = 'Pairing is in progress.'") ||
      !main.includes('confirmButton.disabled = true') ||
      !main.includes('Keep Obsidian open') ||
      !main.includes('await this.refreshQuartzoView()')) {
    console.error('FAIL: Pairing UI can become visually idle/stale while first-pairing mutations are running');
    return false;
  }
  console.log('PASS: First-pairing apply stage remains visibly in progress and refreshes UI on completion');
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
  if (!checkPairingDuplicateCleanupIsReversible()) allPassed = false;
  if (!checkDriveQuotaResilience()) allPassed = false;
  if (!checkFirstPairingApplyProgress()) allPassed = false;

  console.log('\n' + (allPassed ? 'All architecture checks passed' : 'Some architecture checks failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
