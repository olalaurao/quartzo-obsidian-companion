import { describe, expect, it } from 'vitest';
import {
  ActivityHistoryRepository,
  ActivityHistoryWriter,
  activityPartitionMonthsForRange,
  activityPartitionPath,
  isActivityHistoryPath,
  parseActivityHistoryFiles,
} from '../../src/vault/activity-history';
import type { ActivityEvent } from '../../src/core/activity-history';

interface FakeFile {
  path: string;
  extension: string;
}

function activityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    eventId: overrides.eventId ?? 'event-1',
    occurredAt: overrides.occurredAt ?? '2026-10-06T12:00:00.000Z',
    eventType: overrides.eventType ?? 'object_edited',
    sourceId: overrides.sourceId ?? 'note-1',
    sourceType: overrides.sourceType ?? 'note',
    sourcePath: overrides.sourcePath ?? 'Projects/Plan.md',
    originClient: overrides.originClient ?? 'obsidian_companion',
    originKind: overrides.originKind ?? 'companion',
    titleSnapshot: overrides.titleSnapshot ?? 'Plan',
    summary: overrides.summary,
    excerpt: overrides.excerpt,
    previousPath: overrides.previousPath,
    changedFieldCount: overrides.changedFieldCount,
    operationId: overrides.operationId,
    occurrenceId: overrides.occurrenceId,
    scheduledFor: overrides.scheduledFor,
    folder: overrides.folder,
    provenance: overrides.provenance,
    metadata: overrides.metadata,
  };
}

describe('Activity History vault adapter', () => {
  it('recognizes only canonical append-only Activity History partitions', () => {
    expect(isActivityHistoryPath('sessions/activity_history_v1/2026/10/activity_events_2026_10.jsonl')).toBe(true);
    expect(isActivityHistoryPath('sessions/activity_history_v1/2026/10/activity_events_2026_10.md')).toBe(false);
    expect(isActivityHistoryPath('sessions/activity_history_v1/2026/10/activity_events_2026_11.jsonl')).toBe(false);
    expect(isActivityHistoryPath('activity_events_2026_10.jsonl')).toBe(false);
    expect(activityPartitionPath('2026-10-06T12:00:00.000Z')).toBe('sessions/activity_history_v1/2026/10/activity_events_2026_10.jsonl');
  });

  it('computes monthly partitions for visible ranges without scanning unrelated history', async () => {
    expect([...activityPartitionMonthsForRange('2026-10-31', '2026-11-02')]).toEqual(['2026-10', '2026-11']);

    const files: FakeFile[] = [
      { path: 'sessions/activity_history_v1/2026/09/activity_events_2026_09.jsonl', extension: 'jsonl' },
      { path: 'sessions/activity_history_v1/2026/10/activity_events_2026_10.jsonl', extension: 'jsonl' },
      { path: 'sessions/activity_history_v1/2026/11/activity_events_2026_11.jsonl', extension: 'jsonl' },
      { path: 'sessions/activity_history_v1/2027/01/activity_events_2027_01.jsonl', extension: 'jsonl' },
    ];
    const content = new Map([
      [files[0]!.path, `${JSON.stringify(activityEvent({ eventId: 'sept', occurredAt: '2026-09-01T12:00:00.000Z' }))}\n`],
      [files[1]!.path, `${JSON.stringify(activityEvent({ eventId: 'oct', occurredAt: '2026-10-31T12:00:00.000Z' }))}\n`],
      [files[2]!.path, `${JSON.stringify(activityEvent({ eventId: 'nov', occurredAt: '2026-11-01T12:00:00.000Z' }))}\n`],
      [files[3]!.path, `${JSON.stringify(activityEvent({ eventId: 'jan', occurredAt: '2027-01-01T12:00:00.000Z' }))}\n`],
    ]);
    const reads: string[] = [];
    const vault = {
      getFiles: () => files,
      read: async (file: FakeFile) => {
        reads.push(file.path);
        return content.get(file.path) ?? '';
      },
    };

    const result = await new ActivityHistoryRepository(vault as never).loadRange('2026-10-31', '2026-11-02');

    expect(reads).toEqual([
      'sessions/activity_history_v1/2026/10/activity_events_2026_10.jsonl',
      'sessions/activity_history_v1/2026/11/activity_events_2026_11.jsonl',
    ]);
    expect(result.events.map(event => event.eventId)).toEqual(['nov', 'oct']);
  });

  it('appends through the canonical monthly partition idempotently', async () => {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const vault = {
      getAbstractFileByPath: (filePath: string) => {
        if (folders.has(filePath)) return { path: filePath, extension: '' };
        if (!files.has(filePath)) return null;
        return { path: filePath, extension: 'jsonl' };
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
    };
    const writer = new ActivityHistoryWriter(vault as never);
    const event = activityEvent({ eventId: 'stable-operation-id', operationId: 'operation-1' });

    await writer.append(event);
    await writer.append(event);

    const path = activityPartitionPath(event.occurredAt);
    const lines = (files.get(path) ?? '').trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!) as ActivityEvent).toMatchObject({ eventId: 'stable-operation-id' });
    expect(folders.has('sessions/activity_history_v1/2026/10')).toBe(true);
  });

  it('parses JSONL events, deduplicates eventId and keeps diagnostics for bad lines', () => {
    const good = activityEvent({
      sourcePath: 'Wiki/calm.md',
      titleSnapshot: 'Calm software',
      excerpt: 'Short safe preview',
    });
    const result = parseActivityHistoryFiles([
      {
        path: 'sessions/activity_history_v1/2026/10/activity_events_2026_10.jsonl',
        content: `${JSON.stringify(good)}\n${JSON.stringify(good)}\n{"eventId":""}\n`,
      },
    ]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventId).toBe('event-1');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(3);
  });

  it('fails closed on unsupported event types instead of guessing', () => {
    const result = parseActivityHistoryFiles([
      {
        path: 'sessions/activity_history_v1/2026/10/activity_events_2026_10.jsonl',
        content: JSON.stringify({
          eventId: 'event-2',
          occurredAt: '2026-10-06T12:00:00.000Z',
          eventType: 'canvas_updated',
          sourceId: 'canvas-1',
          sourceType: 'canvas',
          originClient: 'obsidian_companion',
          originKind: 'companion',
          titleSnapshot: 'Canvas',
        }),
      },
    ]);

    expect(result.events).toHaveLength(0);
    expect(result.diagnostics[0]?.message).toContain('eventType is not supported');
  });
});
