import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

describe('documentation integrity', () => {
  it('preserves all original agent rules and current authority boundaries', () => {
    const result = spawnSync(process.execPath, ['scripts/check-docs.mjs'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('PASS: Companion documentation integrity');
  });
});


describe('three Companion agent discovery route probes', () => {
  it('resolves Drive pairing to the canonical coordinator and upstream lock', () => {
    const spec = fs.readFileSync('docs/specs/drive-sync-operational.md', 'utf8');
    const coord = fs.readFileSync('src/sync/coordinator/index.ts', 'utf8');
    const lock = JSON.parse(fs.readFileSync('contracts/UPSTREAM.lock.json', 'utf8'));
    expect(spec).toContain('DriveSyncCoordinator');
    expect(coord).toContain('class DriveSyncCoordinator');
    expect(lock.repository).toBe('olalaurao/aplicativo');
    expect(lock.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('resolves Organization to the existing repository and pure planner', () => {
    expect(fs.readFileSync('docs/specs/object-organization.md', 'utf8'))
      .toContain('Object Organization');
    expect(fs.readFileSync('src/vault/object-organization.ts', 'utf8'))
      .toContain('ObjectOrganizationRepository');
    expect(fs.readFileSync('src/core/object-organization/merge.ts', 'utf8'))
      .toContain('Merge');
  });

  it('resolves release to existing exact-SHA preflight and tag gate', () => {
    expect(fs.readFileSync('docs/BETA_RELEASE_RUNBOOK.md', 'utf8'))
      .toContain('Release Preflight');
    expect(fs.readFileSync('.github/workflows/release-preflight.yml', 'utf8'))
      .toContain('name: Release Preflight');
    expect(fs.readFileSync('.github/workflows/release.yml', 'utf8'))
      .toContain('Require successful Release Preflight');
  });
});


describe('current Companion guideline owner trails', () => {
  it('maps every current Companion guideline group to concrete owners', () => {
    const owners: Record<string, string[]> = {
      'Foundations and interoperability': [
        'src/vault/index/engine.ts',
        'contracts/UPSTREAM.lock.json',
      ],
      'Sync modes and transport': [
        'src/sync/coordinator/index.ts',
        'src/sync/coordinator/file-policy.ts',
      ],
      'Daily Schedule, occurrence, Focus and interfaces': [
        'src/core/daily_schedule/engine.ts',
        'src/core/occurrence_actions/service.ts',
        'src/core/focus-runtime/runtime.ts',
      ],
      'Journal, Link Capture and Resources': [
        'src/ui/journal/journal-projection.ts',
        'src/core/link-capture/policy.ts',
        'src/core/resource-capture/policy.ts',
      ],
      'Object Identification and Organization': [
        'src/core/object-identification-migration.ts',
        'src/vault/object-organization.ts',
      ],
    };

    const source = fs.readFileSync('guidelines.md', 'utf8');
    const headings = new Set(
      [...source.matchAll(/^## (.+)$/gm)].map(match => match[1].trim()),
    );
    expect(new Set(Object.keys(owners))).toEqual(headings);
    for (const [heading, paths] of Object.entries(owners)) {
      expect(paths.length, heading).toBeGreaterThan(0);
      for (const ownerPath of paths) {
        expect(fs.existsSync(ownerPath), `${heading} -> ${ownerPath}`).toBe(true);
      }
    }
  });
});
