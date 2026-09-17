import type { IndexedObject, VaultIndex } from '../../vault/index/types';

export interface JournalDayProjection {
  dailyNotes: IndexedObject[];
  entries: IndexedObject[];
  trackingRecords: IndexedObject[];
  moodEntryCount: number;
}

function isOnDate(object: IndexedObject, date: string): boolean {
  return String(object.frontmatter.date ?? '').startsWith(date);
}

export function projectJournalDay(index: VaultIndex | null, date: string): JournalDayProjection {
  const objects = index ? Array.from(index.objects.values()) : [];
  const dailyNotes = objects.filter(object => object.type === 'daily_note' && isOnDate(object, date));
  const entries = objects.filter(object => object.type === 'entry' && isOnDate(object, date));
  const trackingRecords = objects.filter(object => object.type === 'tracker_record' && isOnDate(object, date));
  const moodEntryCount = dailyNotes.reduce((sum, note) => {
    const entries = note.frontmatter.mood_entries;
    return sum + (Array.isArray(entries) ? entries.length : 0);
  }, 0);
  return { dailyNotes, entries, trackingRecords, moodEntryCount };
}
