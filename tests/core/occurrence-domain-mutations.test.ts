import { describe, expect, it } from 'vitest';
import {
  clearOccurrenceDomainMarkdown,
  completeOccurrenceDomainMarkdown,
  occurrenceResponseIdForDailyItem,
  type OccurrenceActionTarget,
} from '../../src/core/occurrence_actions';
import { ObjectParser } from '../../src/core/objects';

function target(overrides: Partial<OccurrenceActionTarget> = {}): OccurrenceActionTarget {
  return {
    occurrenceId: 'task:task-1@2026-09-19',
    sourceId: 'task-1',
    sourceType: 'task',
    dueAt: '2026-09-19T09:00:00.000',
    ...overrides,
  };
}

describe('Companion occurrence domain mutations', () => {
  it('mirrors canonical dated occurrence identity while leaving already-dated ids untouched', () => {
    expect(occurrenceResponseIdForDailyItem('task:task-1', '2026-09-19'))
      .toBe('task:task-1@2026-09-19');
    expect(occurrenceResponseIdForDailyItem('routine:r1@2026-09-19', '2026-09-19'))
      .toBe('routine:r1@2026-09-19');
  });

  it('completes and reopens a non-recurring task without losing unknown fields or body', () => {
    const original = `---
id: task-1
type: task
title: Ship
stage: todo
future_field:
  keep: true
---
Body with [[links]].
`;
    const completed = completeOccurrenceDomainMarkdown(
      original,
      target(),
      new Date(2026, 8, 19, 10, 0),
      new Date(2026, 8, 19, 10, 0),
      'action-1',
    );
    const parsed = ObjectParser.parseMarkdown(completed);
    expect(parsed.frontmatter.stage).toBe('finalized');
    expect(parsed.frontmatter.reflection).toBe('Completed from occurrence action.');
    expect(parsed.frontmatter.future_field).toEqual({ keep: true });
    expect(parsed.body).toBe('Body with [[links]].');

    const reopened = ObjectParser.parseMarkdown(clearOccurrenceDomainMarkdown(completed, target()));
    expect(reopened.frontmatter.stage).toBe('todo');
    expect(reopened.frontmatter.future_field).toEqual({ keep: true });
  });

  it('does not finalize a recurring task source object', () => {
    const original = `---
id: task-1
type: task
title: Daily
stage: todo
scheduler:
  start_date: 2026-09-19
  rules: []
---
Body
`;
    const completed = ObjectParser.parseMarkdown(completeOccurrenceDomainMarkdown(
      original,
      target(),
      new Date(2026, 8, 19, 10),
      new Date(2026, 8, 19, 10),
      'a',
    ));
    expect(completed.frontmatter.stage).toBe('todo');
  });

  it('records Habit history events with slot identity and preserves existing body', () => {
    const habitTarget = target({
      occurrenceId: 'legacyTime:habit:water:slot:1@2026-09-19',
      sourceId: 'water',
      sourceType: 'habit',
      slotIndex: 1,
    });
    const original = `---
id: water
type: habit
title: Water
daily_goal: 2
custom: keep
---
Notes before history.

## History
`;
    const completed = completeOccurrenceDomainMarkdown(
      original,
      habitTarget,
      new Date(2026, 8, 19, 9, 5),
      new Date(2026, 8, 19, 9, 6),
      'companion-action',
    );
    expect(completed).toContain('Notes before history.');
    expect(completed).toContain('2026-09-19 (1/2)');
    expect(completed).toContain('planner|1|companion-action');

    const twice = completeOccurrenceDomainMarkdown(
      completed,
      habitTarget,
      new Date(2026, 8, 19, 9, 5),
      new Date(2026, 8, 19, 9, 6),
      'companion-action',
    );
    expect(twice).toBe(completed);

    const cleared = clearOccurrenceDomainMarkdown(completed, habitTarget);
    expect(cleared).toContain('2026-09-19 (0/2)');
    expect(cleared).toContain('events:');
    expect(ObjectParser.parseMarkdown(cleared).frontmatter.custom).toBe('keep');
  });

  it('mirrors simple canonical source side effects for Reminder, Event, Person and goal deadline', () => {
    const now = new Date(2026, 8, 19, 10, 30);
    const cases = [
      {
        sourceType: 'reminder',
        occurrenceId: 'reminder:r1@2026-09-19',
        id: 'r1',
        before: {},
        completedKey: 'is_completed',
        completedValue: true,
      },
      {
        sourceType: 'event',
        occurrenceId: 'event:e1@2026-09-19',
        id: 'e1',
        before: { state: 'scheduled' },
        completedKey: 'state',
        completedValue: 'completed',
      },
      {
        sourceType: 'person',
        occurrenceId: 'person_contact:p1@2026-09-19',
        id: 'p1',
        before: {},
        completedKey: 'last_contact_date',
        completedValue: '2026-09-19T10:30:00.000',
      },
      {
        sourceType: 'goal',
        occurrenceId: 'goalDeadline:g1@2026-09-19',
        id: 'g1',
        before: { state: 'active' },
        completedKey: 'state',
        completedValue: 'completed',
      },
    ] as const;

    for (const item of cases) {
      const markdown = ObjectParser.serializeMarkdown({
        id: item.id,
        type: item.sourceType,
        title: item.id,
        ...item.before,
        future: 'keep',
      }, 'Body');
      const result = ObjectParser.parseMarkdown(completeOccurrenceDomainMarkdown(
        markdown,
        target({
          occurrenceId: item.occurrenceId,
          sourceId: item.id,
          sourceType: item.sourceType,
        }),
        now,
        now,
        'a',
      ));
      expect(result.frontmatter[item.completedKey]).toBe(item.completedValue);
      expect(result.frontmatter.future).toBe('keep');
      expect(result.body).toBe('Body');
    }
  });

  it('fails closed for System and Routine completion until execution-evidence parity exists', () => {
    for (const sourceType of ['system', 'routine']) {
      const markdown = ObjectParser.serializeMarkdown({
        id: 'x',
        type: sourceType,
        title: 'X',
      }, 'Body');
      expect(() => completeOccurrenceDomainMarkdown(
        markdown,
        target({ sourceId: 'x', sourceType }),
        new Date(2026, 8, 19, 10),
        new Date(2026, 8, 19, 10),
        'a',
      )).toThrow('does not yet support');
    }
  });
});
