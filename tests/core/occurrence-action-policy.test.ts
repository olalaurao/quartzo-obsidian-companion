import { describe, expect, it } from 'vitest';
import { OccurrenceActionPolicy } from '../../src/core/occurrence_actions';

describe('OccurrenceActionPolicy', () => {
  it('matches task, habit and reminder canonical capabilities', () => {
    const task = OccurrenceActionPolicy.resolve({
      sourceType: 'task',
      outcome: 'pending',
      completable: true,
    });
    expect(task.role).toBe('taskWork');
    expect(task.canReportDone).toBe(true);
    expect(task.canAlreadyDid).toBe(true);
    expect(task.canSkip).toBe(true);
    expect(task.canSnooze).toBe(false);
    expect(task.doneLabel).toBe('Done');

    const habit = OccurrenceActionPolicy.resolve({
      sourceType: 'habit',
      outcome: 'pending',
      completable: true,
      restrictionMetadata: { linked_tracker_id: 'tracker-1' },
    });
    expect(habit.role).toBe('habitSlot');
    expect(habit.quickOutcomeControl).toBe('checkbox');
    expect(habit.canLogLinkedTracker).toBe(true);

    const reminder = OccurrenceActionPolicy.resolve({
      sourceType: 'reminder',
      outcome: 'pending',
      completable: true,
    });
    expect(reminder.canSnooze).toBe(true);
  });

  it('terminal outcomes expose status and Undo instead of Start', () => {
    const done = OccurrenceActionPolicy.resolve({
      sourceType: 'time_block',
      outcome: 'done',
      completable: true,
      playable: true,
      temporalKind: 'interval',
      durationMinutes: 60,
    });
    expect(done.canStart).toBe(false);
    expect(done.statusLabel).toBe('Block done');
    expect(done.clearOutcomeLabel).toBe('Undo');
  });

  it('historical evidence is never exposed as actionable debt', () => {
    const record = OccurrenceActionPolicy.resolve({
      sourceType: 'tracking_record',
      outcome: 'pending',
      completable: false,
    });
    expect(record.isEvidence).toBe(true);
    expect(record.canReportDone).toBe(false);
    expect(record.canSkip).toBe(false);
    expect(record.statusLabel).toBe('Logged');
  });
  it('scheduled System exposes Run + Skip but no generic Done owner', () => {
    const system = OccurrenceActionPolicy.resolve({
      sourceType: 'system',
      outcome: 'pending',
      completable: true,
      playable: true,
    });
    expect(system.role).toBe('systemRun');
    expect(system.canReportDone).toBe(false);
    expect(system.canAlreadyDid).toBe(false);
    expect(system.canSkip).toBe(true);
    expect(system.canStart).toBe(true);
    expect(system.startAction).toBe('runSystem');
  });
});
