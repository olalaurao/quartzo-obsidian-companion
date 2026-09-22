import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('CI workflow contract', () => {
  it('runs the V1 release gate parity set on macOS', () => {
    const ci = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const jobStart = ci.indexOf('  test-macos:');
    expect(jobStart).toBeGreaterThanOrEqual(0);

    const nextJob = ci.indexOf('\n  test-', jobStart + 1);
    const job = ci.slice(jobStart, nextJob > jobStart ? nextJob : ci.length);

    for (const required of [
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
    ]) {
      expect(job).toContain(required);
    }
  });
});
