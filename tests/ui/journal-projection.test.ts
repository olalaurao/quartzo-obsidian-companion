import { describe, expect, it } from 'vitest';
import { projectJournalDay } from '../../src/ui/journal/journal-projection';
import type { IndexedObject, VaultIndex } from '../../src/vault/index/types';

function object(id: string, type: string, frontmatter: Record<string, unknown>): IndexedObject {
  return { id, type, path: `${type}/${id}.md`, frontmatter: { id, type, ...frontmatter }, body: '' };
}

describe('Journal day projection', () => {
  it('groups Daily Note, Entries and Tracking Records by persisted date and counts mood_entries', () => {
    const objects = [
      object('daily', 'daily_note', { date: '2026-09-17', mood_entries: [{ value: 3 }, { value: 4 }] }),
      object('entry', 'entry', { date: '2026-09-17T10:30:00.000' }),
      object('record', 'tracker_record', { date: '2026-09-17T08:00:00.000' }),
      object('other', 'entry', { date: '2026-09-18' }),
    ];
    const index: VaultIndex = {
      files: new Map(),
      objects: new Map(objects.map(item => [item.id, item])),
      lastModified: 0,
    };

    const projected = projectJournalDay(index, '2026-09-17');
    expect(projected.dailyNotes.map(item => item.id)).toEqual(['daily']);
    expect(projected.entries.map(item => item.id)).toEqual(['entry']);
    expect(projected.trackingRecords.map(item => item.id)).toEqual(['record']);
    expect(projected.moodEntryCount).toBe(2);
  });
});
