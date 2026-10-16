import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The peer checkout is the sibling Quartzo repository. All exchanged data is
// synthetic; each test creates and removes its own temporary vault/database.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const diagnostics = path.join(workspace, '_diagnostics');
mkdirSync(diagnostics, { recursive: true });
const exchange = path.join(diagnostics, 'sync-audit-exchange.json');
for (const [client, stage] of [['companion', 'seed'], ['quartzo', 'middle'], ['companion', 'return'], ['quartzo', 'finish']]) {
  const cwd = path.join(workspace, client);
  const env = { ...process.env, SYNC_AUDIT_EXCHANGE: exchange, SYNC_AUDIT_STAGE: stage };
  const options = { cwd, env, encoding: 'utf8' };
  let result;
  if (client === 'companion') {
    result = spawnSync(process.execPath, [path.join(cwd, 'node_modules/vitest/vitest.mjs'), 'run',
      'tests/sync/runtime.test.ts', '-t', 'audit: cross-client exchange', '--maxWorkers=1', '--minWorkers=1'], options);
  } else if (process.platform === 'win32') {
    result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
      'flutter test --no-pub test/sync_stability_audit_test.dart --plain-name=cross-client'], options);
  } else {
    result = spawnSync('flutter', ['test', '--no-pub', 'test/sync_stability_audit_test.dart', '--plain-name=cross-client'], options);
  }
  writeFileSync(path.join(diagnostics, `sync-audit-exchange-${stage}.log`),
    `${result.stdout || ''}\n${result.stderr || ''}\n${result.error || ''}`);
  console.log(`${client} ${stage}: ${result.status === 0 ? 'PASS' : 'FAIL'}`);
  if (result.status !== 0) process.exit(1);
}
