import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DailyScheduleEngine, type DailyScheduleInput } from '../../src/core/daily_schedule';

interface Vector {
  id: string;
  kind: string;
  input: {
    date: string;
    today?: string;
    objects?: Array<Record<string, unknown>>;
    googleEvents?: Array<Record<string, unknown>>;
  };
  expectedNormalized: {
    kind: string;
    count: number;
    items: Array<Record<string, unknown>>;
  };
}

describe('Daily Schedule Contract Vectors', () => {
  const vectorsPath = path.join(__dirname, '../../contracts/quartzo/daily_schedule/vectors.json');
  const vectors: Vector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

  for (const vector of vectors) {
    it(`should pass vector ${vector.id} (${vector.kind})`, () => {
      const result = DailyScheduleEngine.normalize(vector.input as DailyScheduleInput);
      
      expect(result.kind).toBe(vector.expectedNormalized.kind);
      expect(result.count).toBe(vector.expectedNormalized.count);
      
      // Check items match
      expect(result.items.length).toBe(vector.expectedNormalized.items.length);
      
      for (let i = 0; i < result.items.length; i++) {
        const actualItem = result.items[i];
        const expectedItem = vector.expectedNormalized.items[i];
        
        for (const [key, expectedValue] of Object.entries(expectedItem)) {
          const actualValue = (actualItem as unknown as Record<string, unknown>)[key];
          expect(actualValue).toEqual(expectedValue);
        }
      }
    });
  }
  it('does not carry an overdue Reminder into today as a normal Daily Schedule item', () => {
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-06',
      today: '2026-09-06',
      objects: [{
        type: 'reminder',
        id: 'reminder-overdue',
        title: 'Call clinic',
        scheduled_date: '2026-09-05',
        time: '09:30',
        reminder_id: 'reminder-overdue-primary',
      }],
    });

    expect(result.items).toEqual([]);
  });

  it('keeps same-day Reminder occurrences on the Daily Schedule', () => {
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-06',
      today: '2026-09-06',
      objects: [{
        type: 'reminder',
        id: 'reminder-today',
        title: 'Call clinic',
        scheduled_date: '2026-09-06',
        time: '09:30',
        reminder_id: 'reminder-today-primary',
      }],
    });

    expect(result.items.map(item => item.id)).toEqual(['reminder:reminder-today']);
  });
  it('manual same-day System execution and legacy Done do not close scheduled occurrence', () => {
    const occurrenceId = 'system:system-morning@2026-09-21';
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-21',
      objects: [{
        type: 'system',
        id: 'system-morning',
        title: 'Morning reset',
        time: '08:00',
        completed: true,
        is_completed: true,
        execution_history: [{
          executed_at: '2026-09-21T08:03:00.000',
          finished_at: '2026-09-21T08:27:00.000',
          step_completions: { water: true },
        }],
      }],
      occurrenceResponses: {
        [occurrenceId]: {
          occurrenceId,
          completedAt: '2026-09-21T08:27:00.000',
          ignoredCount: 0,
          processedActionIds: [],
        },
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.occurrenceId).toBe(occurrenceId);
    expect(result.items[0]?.isCompleted).toBe(false);
    expect(result.items[0]?.outcome).toBe('pending');
  });

  it('exact linked finished System execution closes only its occurrence', () => {
    const occurrenceId = 'system:system-morning@2026-09-21';
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-21',
      objects: [{
        type: 'system',
        id: 'system-morning',
        title: 'Morning reset',
        time: '08:00',
        execution_history: [{
          executed_at: '2026-09-21T08:03:00.000',
          finished_at: '2026-09-21T08:27:00.000',
          occurrence_id: occurrenceId,
          scheduled_for: '2026-09-21T08:00:00.000',
          step_completions: { water: true },
        }],
      }],
    });
    expect(result.items[0]?.occurrenceId).toBe(occurrenceId);
    expect(result.items[0]?.isCompleted).toBe(true);
    expect(result.items[0]?.outcome).toBe('done');
  });

  it('System Skip remains occurrence response state without becoming positive Finish evidence', () => {
    const occurrenceId = 'system:system-morning@2026-09-21';
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-21',
      objects: [{
        type: 'system',
        id: 'system-morning',
        title: 'Morning reset',
        time: '08:00',
      }],
      occurrenceResponses: {
        [occurrenceId]: {
          occurrenceId,
          skippedAt: '2026-09-21T08:15:00.000',
          ignoredCount: 0,
          processedActionIds: [],
        },
      },
    });
    expect(result.items[0]?.isCompleted).toBe(false);
    expect(result.items[0]?.isSkipped).toBe(true);
    expect(result.items[0]?.outcome).toBe('skipped');
  });

  it('rescheduled System keeps original occurrence identity without closing the normal new-day occurrence', () => {
    const movedId = 'system:system-morning@2026-09-21';
    const normalId = 'system:system-morning@2026-09-22';
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-22',
      objects: [{
        type: 'system',
        id: 'system-morning',
        title: 'Morning reset',
        time: '08:00',
        execution_history: [{
          executed_at: '2026-09-22T09:03:00.000',
          finished_at: '2026-09-22T09:20:00.000',
          occurrence_id: movedId,
          scheduled_for: '2026-09-22T09:00:00.000',
          step_completions: { water: true },
        }],
      }],
      occurrenceOverrides: {
        [movedId]: {
          occurrenceId: movedId,
          sourceId: 'system-morning',
          scope: 'single',
          startAtOverride: '2026-09-22T09:00:00.000',
          endAtOverride: '2026-09-22T09:30:00.000',
          updatedAt: '2026-09-21T12:00:00.000',
        },
      },
    });
    const moved = result.items.find(item => item.occurrenceId === movedId);
    const normal = result.items.find(item => item.occurrenceId === normalId);
    expect(moved?.date).toBe('2026-09-22');
    expect(moved?.start).toBe('09:00');
    expect(moved?.isCompleted).toBe(true);
    expect(normal?.isCompleted).toBe(false);
  });
});
