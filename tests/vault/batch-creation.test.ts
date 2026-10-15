import { describe, expect, it } from 'vitest';
import { ObjectOrganizationRepository } from '../../src/vault/object-organization';
import { planBatchCreate } from '../../src/core/object-organization/batch-workbench';
import type { QuartzoSharedSettings } from '../../src/core/shared-settings';

function fixture(failPath: string) {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  let failed = false;
  const vault = {
    getAbstractFileByPath: (path: string) => files.has(path) ? { path, extension: path.split('.').pop() } : folders.has(path) ? { path } : null,
    createFolder: async (path: string) => { folders.add(path); },
    create: async (path: string, content: string) => {
      if (path.includes(failPath) && !failed) { failed = true; throw new Error('Disk unavailable'); }
      if (files.has(path)) throw new Error('Already exists');
      files.set(path, content);
    },
    process: async (file: { path: string }, fn: (content: string) => string) => { files.set(file.path, fn(files.get(file.path)!)); },
  };
  const repository = new ObjectOrganizationRepository(vault as never, {} as never);
  const settings = { folderPaths: { resource: 'resources' }, typeSignatures: {} } as unknown as QuartzoSharedSettings;
  const plan = planBatchCreate({ settings, drafts: ['First', 'Second', 'Third'].map(title => ({ title, type: 'resource', mediaType: 'Movie' })), existingPaths: new Set(), createId: (_, i) => `movie-${i}` });
  return { files, repository, plan };
}

describe('batch creation persistence', () => {
  it('returns the committed prefix and retries only remaining rows', async () => {
    const { files, repository, plan } = fixture('Second.md');
    const first = await repository.applyBatchCreate(plan);
    expect(first).toMatchObject({ applied: 1, failed: 1, skipped: 1 });
    expect(files.has('resources/First.md')).toBe(true);
    expect(files.has('resources/Second.md')).toBe(false);
    const retry = await repository.applyBatchCreate({ ...plan, actions: plan.actions.slice(first.applied) });
    expect(retry).toMatchObject({ applied: 2, failed: 0 });
    expect([...files.keys()].filter(path => path.startsWith('resources/'))).toHaveLength(3);
  });
  it('reports activity failure as a warning after the object is committed', async () => {
    const { files, repository, plan } = fixture('activity_events');
    const report = await repository.applyBatchCreate(plan);
    expect(report).toMatchObject({ applied: 3, failed: 0 });
    expect(report.messages.join(' ')).toContain('activity update failed');
    expect([...files.keys()].filter(path => path.startsWith('resources/'))).toHaveLength(3);
  });
});
