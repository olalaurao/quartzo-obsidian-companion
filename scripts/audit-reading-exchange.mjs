import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Actual local owners, synthetic remote byte transport. Never opens an account,
// device or production vault. This optional workspace check needs both checkouts.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const diagnostics = path.join(workspace, '_diagnostics');
mkdirSync(diagnostics, {recursive: true});
const reportRoot = mkdtempSync(path.join(diagnostics, 'reading-sync-exchange-'));
const exchange = path.join(reportRoot, 'bytes.json');
const sourcePaths = {
  quartzo: ['test/sync_stability_audit_test.dart', 'lib/models/reading_activity_event.dart',
    'lib/services/reading_activity_local_store.dart', 'lib/services/reading_activity_shards.dart',
    'lib/services/obsidian_service.dart', 'lib/services/sync_manager.dart', 'lib/services/sync_queue_service.dart',
    'lib/services/google_drive_sync_service.dart', 'lib/services/sync_conflict_resolution_service.dart'],
  companion: ['tests/sync/runtime.test.ts', 'scripts/audit-reading-exchange.mjs', 'package.json',
    'src/core/sync/engine.ts', 'src/integrations/google/drive/adapter.ts',
    'src/sync/coordinator/index.ts', 'src/sync/coordinator/types.ts'],
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function sources() {
  return Object.fromEntries(Object.entries(sourcePaths).map(([client, files]) => {
    const cwd = path.join(workspace, client);
    return [client, {
      head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim(),
      trackedDiffSha256: sha(execFileSync('git', ['diff', '--binary', 'HEAD'], {cwd, stdio: ['ignore', 'pipe', 'ignore']})),
      files: Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(cwd, file)))])),
    }];
  }));
}
const before = sources();
const observations = [];
const stages = [['quartzo', 'quartzo-seed'], ['companion', 'companion-middle'],
  ['quartzo', 'quartzo-return'], ['companion', 'companion-finish']];
for (const [client, stage] of stages) {
  const cwd = path.join(workspace, client);
  const env = {...process.env, READING_SYNC_EXCHANGE: exchange, READING_SYNC_STAGE: stage};
  const options = {cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024};
  const result = client === 'companion'
    ? spawnSync(process.execPath, [path.join(cwd, 'node_modules/vitest/vitest.mjs'), 'run',
      'tests/sync/runtime.test.ts', '-t', 'audit: reading_cross_client_exchange', '--maxWorkers=1', '--minWorkers=1'], options)
    : process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
        'flutter test --no-test-assets --no-pub test/sync_stability_audit_test.dart --plain-name=reading_cross_client_exchange'], options)
      : spawnSync('flutter', ['test', '--no-test-assets', '--no-pub',
        'test/sync_stability_audit_test.dart', '--plain-name', 'reading_cross_client_exchange'], options);
  writeFileSync(path.join(reportRoot, `${stage}.log`), `${result.stdout || ''}\n${result.stderr || ''}\n${result.error || ''}`);
  observations.push({client, stage, pass: result.status === 0});
  console.log(`${client} ${stage}: ${result.status === 0 ? 'PASS' : 'FAIL'}`);
  if (result.status !== 0) break;
}
const after = sources();
const unchangedSources = JSON.stringify(before) === JSON.stringify(after);
const passed = unchangedSources && observations.length === stages.length && observations.every(item => item.pass);
writeFileSync(path.join(reportRoot, 'report.json'), JSON.stringify({
  version: 1, observedAtUtc: new Date().toISOString(), passed, observations, unchangedSources, sources: before,
  finalStage: existsSync(exchange) ? JSON.parse(readFileSync(exchange, 'utf8')).stage : null,
  proof: {actualLocalOwners: true, syntheticRemoteBytes: true,
    realDrive: false, realObsidian: false, directoryPowerLoss: false, canonicalAck: false},
}, null, 2) + '\n');
console.log(`Report: ${reportRoot}`);
if (!passed) process.exitCode = 1;
