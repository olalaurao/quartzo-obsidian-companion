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

  it('keeps current release metadata aligned before tagging', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8')) as {
      version: string;
      minAppVersion: string;
    };
    const versions = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'versions.json'), 'utf8')) as Record<string, string>;

    expect(manifest.version).toBe(pkg.version);
    expect(versions[pkg.version]).toBe(manifest.minAppVersion);
  });

  it('requires a successful preflight for the exact resolved tag commit before publishing', () => {
    const release = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    for (const required of [
      'actions: read',
      'Resolve and verify release tag commit',
      'git rev-list -n 1 "$RELEASE_TAG"',
      'RELEASE_SHA=$release_sha',
      'Require successful Release Preflight for tag commit',
      'actions/workflows/release-preflight.yml/runs',
      '.head_sha == env.RELEASE_SHA',
      '.conclusion == "success"',
      'Run Release Preflight on this exact main commit before publishing ${RELEASE_TAG}.',
      'Revalidate tag before publication',
    ]) {
      expect(release).toContain(required);
    }
  });

  it('provides one canonical atomic release metadata preparation command', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const prepareScript = path.join(process.cwd(), 'scripts/prepare-release.mjs');

    expect(pkg.scripts?.['release:prepare']).toBe('node scripts/prepare-release.mjs');
    expect(fs.existsSync(prepareScript)).toBe(true);

    const source = fs.readFileSync(prepareScript, 'utf8');
    for (const required of ['package.json', 'manifest.json', 'versions.json', 'package-lock.json']) {
      expect(source).toContain(required);
    }
  });
});
