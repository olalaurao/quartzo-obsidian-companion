import { describe, expect, it } from 'vitest';
import { DailyScheduleEngine } from '../../src/core/daily_schedule';
import {
  parseOccurrenceTimeOverrides,
  planOccurrenceReschedule,
  upsertOccurrenceTimeOverrideInMarkdown,
} from '../../src/core/occurrence_reschedule';

describe('occurrence reschedule core', () => {
  it('routes one-off Task through canonical source fields', () => {
    const plan = planOccurrenceReschedule({
      occurrenceId: 'task:task-one-off@2026-09-21',
      sourceId: 'task-one-off',
      sourceType: 'task',
      editable: true,
      outcome: 'pending',
      isCompletable: true,
      isPlayable: false,
    }, new Date(2026, 8, 21, 14, 30), new Date(2026, 8, 21, 15, 15));

    expect(plan).toEqual({
      storage: 'source_task',
      patch: {
        set: {
          start_date: '2026-09-21T00:00:00.000',
          scheduled_time: '14:30',
          duration: 45,
        },
      },
    });
  });

  it('routes recurring Task instance and time block through a single planning override', () => {
    const recurring = planOccurrenceReschedule({
      occurrenceId: 'task:task-recurring@2026-09-21',
      sourceId: 'task-recurring',
      sourceType: 'task',
      editable: true,
      seriesId: 'task-recurring',
      outcome: 'pending',
      isCompletable: true,
      isPlayable: false,
    }, new Date(2026, 8, 21, 16), new Date(2026, 8, 21, 17), new Date(2026, 8, 21, 12));

    expect(recurring.storage).toBe('shared_planning_override');
    if (recurring.storage !== 'shared_planning_override') throw new Error('Expected planning override');
    expect(recurring.override).toMatchObject({
      occurrenceId: 'task:task-recurring@2026-09-21',
      sourceId: 'task-recurring',
      scope: 'single',
      startAtOverride: '2026-09-21T16:00:00.000',
      endAtOverride: '2026-09-21T17:00:00.000',
    });

    const block = planOccurrenceReschedule({
      occurrenceId: 'time_block:block-1:r1@2026-09-21',
      sourceId: 'block-1',
      sourceType: 'time_block',
      editable: true,
      outcome: 'pending',
      isCompletable: true,
      isPlayable: false,
    }, new Date(2026, 8, 21, 13), new Date(2026, 8, 21, 14));
    expect(block.storage).toBe('shared_planning_override');
  });

  it('fails closed for non-editable and external occurrences', () => {
    expect(() => planOccurrenceReschedule({
      occurrenceId: 'google_calendar:event@2026-09-21',
      sourceId: 'event',
      sourceType: 'google_calendar',
      editable: false,
      outcome: 'pending',
      isCompletable: false,
      isPlayable: false,
    }, new Date(2026, 8, 21, 15), new Date(2026, 8, 21, 16))).toThrow(/cannot be rescheduled/i);
  });

  it('preserves unrelated planning fields and unknown override fields', () => {
    const original = `---
type: shared_planning_state
schema_version: 1
daily_planning_states:
  2026-09-21:
    capacity_mode: low
overrides:
  task:task-recurring@2026-09-21:
    occurrence_id: task:task-recurring@2026-09-21
    source_id: task-recurring
    scope: single
    is_deferred: true
    activity_type_override: flow
    updated_at: 2026-09-21T09:00:00.000
---
# Shared Planning State V1`;

    const updated = upsertOccurrenceTimeOverrideInMarkdown(original, {
      occurrenceId: 'task:task-recurring@2026-09-21',
      sourceId: 'task-recurring',
      scope: 'single',
      startAtOverride: '2026-09-21T16:00:00.000',
      endAtOverride: '2026-09-21T17:00:00.000',
      updatedAt: '2026-09-21T12:00:00.000',
    });

    expect(updated).toContain('daily_planning_states:');
    expect(updated).toContain('is_deferred: true');
    expect(updated).toContain('activity_type_override: flow');
    const parsed = parseOccurrenceTimeOverrides(updated);
    expect(parsed['task:task-recurring@2026-09-21']).toMatchObject({
      sourceId: 'task-recurring',
      scope: 'single',
      startAtOverride: '2026-09-21T16:00:00.000',
      endAtOverride: '2026-09-21T17:00:00.000',
      unknownFields: {
        is_deferred: true,
        activity_type_override: 'flow',
      },
    });
  });
  it('projects canonical Task schedule fields and editable capability', () => {
    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-21',
      objects: [{
        id: 'task-one-off',
        type: 'task',
        title: 'Task',
        start_date: '2026-09-21T00:00:00.000',
        scheduled_time: '14:30',
        duration: 45,
      }],
    });

    expect(schedule.items).toHaveLength(1);
    expect(schedule.items[0]).toMatchObject({
      id: 'task:task-one-off',
      start: '14:30',
      end: '15:15',
      editable: true,
      actionOccurrenceId: 'task:task-one-off@2026-09-21',
    });
  });

  it('moves a single planning override across dates without changing occurrence identity', () => {
    const overrides = {
      'goalDeadline:goal-1@2026-09-21': {
        occurrenceId: 'goalDeadline:goal-1@2026-09-21',
        sourceId: 'goal-1',
        scope: 'single' as const,
        startAtOverride: '2026-09-22T09:00:00.000',
        endAtOverride: '2026-09-22T09:30:00.000',
        updatedAt: '2026-09-21T12:00:00.000',
      },
    };
    const objects = [{
      id: 'goal-1',
      type: 'goal',
      title: 'Goal',
      deadline: '2026-09-21T00:00:00.000',
    }];

    const oldDay = DailyScheduleEngine.normalize({
      date: '2026-09-21',
      objects,
      occurrenceOverrides: overrides,
    });
    expect(oldDay.items).toHaveLength(0);

    const newDay = DailyScheduleEngine.normalize({
      date: '2026-09-22',
      objects,
      occurrenceOverrides: overrides,
    });
    expect(newDay.items).toHaveLength(1);
    expect(newDay.items[0]).toMatchObject({
      sourceId: 'goal-1',
      sourceType: 'goalDeadline',
      occurrenceId: 'goalDeadline:goal-1@2026-09-21',
      actionOccurrenceId: 'goalDeadline:goal-1@2026-09-21',
      date: '2026-09-22',
      start: '09:00',
      end: '09:30',
      editable: true,
    });
  });

});
