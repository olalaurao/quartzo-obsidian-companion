import { spawnSync } from 'child_process';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runAudit() {
  return spawnSync(
    npmCommand,
    ['audit', '--omit=dev', '--audit-level=high', '--json'],
    { encoding: 'utf8' },
  );
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return null;
  }
}

function hasHighSeverityVulnerability(payload) {
  const counts = payload?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') return false;
  return Number(counts.high || 0) > 0 || Number(counts.critical || 0) > 0;
}

function isInfrastructureFailure(payload, stderr) {
  if (payload?.error) return true;
  const text = String(stderr || '').toLowerCase();
  return text.includes('audit endpoint returned an error')
    || text.includes('bad request')
    || text.includes('invalid package tree')
    || text.includes('econnreset')
    || text.includes('etimedout')
    || text.includes('eai_again')
    || text.includes('socket hang up');
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = runAudit();
  const payload = parseJson(result.stdout);

  if (result.status === 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(0);
  }

  if (hasHighSeverityVulnerability(payload)) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    console.error('Production dependency audit found high/critical vulnerabilities.');
    process.exit(result.status || 1);
  }

  if (!isInfrastructureFailure(payload, result.stderr)) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    console.error('Production dependency audit failed for a non-retryable reason.');
    process.exit(result.status || 1);
  }

  process.stderr.write(result.stderr || '');
  console.error(`Production dependency audit infrastructure failure (attempt ${attempt}/${MAX_ATTEMPTS}).`);
  if (attempt < MAX_ATTEMPTS) sleep(RETRY_DELAY_MS * attempt);
}

console.error('Production dependency audit infrastructure remained unavailable after bounded retries.');
process.exit(1);
