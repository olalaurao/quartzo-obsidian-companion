import { describe, expect, it } from 'vitest';
import { ObjectCreationRepository } from '../../src/vault/object-creation';
import { ACTIVITY_HISTORY_ROOT } from '../../src/vault/activity-history';

interface FakeFile {
  path: string;
  extension: string;
}

function fakeVault() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  return {
    files,
    folders,
    vault: {
      getAbstractFileByPath: (filePath: string) => {
        if (folders.has(filePath)) return { path: filePath, extension: '' };
        if (!files.has(filePath)) return null;
        const extension = filePath.split('.').pop() ?? '';
        return { path: filePath, extension };
      },
      createFolder: async (folderPath: string) => {
        folders.add(folderPath);
      },
      create: async (filePath: string, content: string) => {
        files.set(filePath, content);
      },
      process: async (file: FakeFile, mutator: (content: string) => string) => {
        files.set(file.path, mutator(files.get(file.path) ?? ''));
      },
    },
  };
}

describe('Object creation Activity History emission', () => {
  it('records tracker Quick Add as tracking_record_created instead of generic object_created', async () => {
    const fake = fakeVault();
    const repository = new ObjectCreationRepository(fake.vault as never);

    await repository.create('tracker_record', {
      path: 'tracking-records/Energy.md',
      content: `---
id: record-1
type: tracker_record
title: Energy 2026-10-06
tracker_id: energy
date: 2026-10-06T09:00:00.000
field_values:
  score: 4
---
`,
    });

    const activityPath = [...fake.files.keys()].find(path => path.startsWith(ACTIVITY_HISTORY_ROOT));
    expect(activityPath).toBeDefined();
    const activity = JSON.parse(fake.files.get(activityPath!)!.trim()) as Record<string, unknown>;
    expect(activity).toMatchObject({
      eventType: 'tracking_record_created',
      sourceId: 'record-1',
      sourceType: 'tracker_record',
      sourcePath: 'tracking-records/Energy.md',
      titleSnapshot: 'Energy 2026-10-06',
    });
  });
});
