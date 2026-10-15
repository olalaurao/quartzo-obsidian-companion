import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VaultSyncFilePolicy } from '../../src/sync/coordinator/file-policy';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../contracts/quartzo/sync/file_policy.json'), 'utf8')) as { cases: Array<{ path: string; include: boolean }> };
describe('shared protocol 1.2 content scope', () => {
  for (const sample of fixture.cases) it(sample.path, () => {
    expect(VaultSyncFilePolicy.shouldSyncFile(sample.path)).toBe(sample.include);
  });
});
