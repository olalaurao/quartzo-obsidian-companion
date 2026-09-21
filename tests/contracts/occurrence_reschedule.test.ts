import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { OccurrenceActionPolicy } from '../../src/core/occurrence_actions';
import { planOccurrenceReschedule } from '../../src/core/occurrence_reschedule';

interface RescheduleVector {
  id: string;
  source_type: string;
  source_id: string;
  occurrence_id: string;
  editable: boolean;
  series_id: string | null;
  original_start: string;
  original_end: string;
  new_start: string;
  new_end: string;
  expected: {
    can_replan: boolean;
    storage: 'source_task' | 'shared_planning_override' | 'blocked';
    start_date?: string;
    scheduled_time?: string;
    duration_minutes?: number;
    shared_file?: string;
    scope?: string;
  };
}

describe('Occurrence Reschedule Contract Vectors', () => {
  const vectorsPath = path.join(
    process.cwd(),
    'contracts',
    'quartzo',
    'occurrence_reschedule',
    'vectors.json',
  );
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8')) as RescheduleVector[];

  for (const vector of vectors) {
    it(`passes vector ${vector.id}`, () => {
      const policy = OccurrenceActionPolicy.resolve({
        sourceType: vector.source_type,
        outcome: 'pending',
        completable: true,
        playable: false,
        editable: vector.editable,
      });
      expect(policy.canReplan).toBe(vector.expected.can_replan);

      const run = () => planOccurrenceReschedule({
        occurrenceId: vector.occurrence_id,
        sourceId: vector.source_id,
        sourceType: vector.source_type,
        editable: vector.editable,
        seriesId: vector.series_id ?? undefined,
        outcome: 'pending',
        isCompletable: true,
        isPlayable: false,
      }, new Date(vector.new_start), new Date(vector.new_end), new Date('2026-09-21T12:00:00.000'));

      if (vector.expected.storage === 'blocked') {
        expect(run).toThrow(/cannot be rescheduled safely/i);
        return;
      }

      const plan = run();
      expect(plan.storage).toBe(vector.expected.storage);

      if (plan.storage === 'source_task') {
        expect(vector.expected.storage).toBe('source_task');
        expect(plan.patch.set.start_date.slice(0, 10)).toBe(vector.expected.start_date);
        expect(plan.patch.set.scheduled_time).toBe(vector.expected.scheduled_time);
        expect(plan.patch.set.duration).toBe(vector.expected.duration_minutes);
        return;
      }

      expect(vector.expected.storage).toBe('shared_planning_override');
      expect(vector.expected.shared_file).toBe('sessions/shared_planning_state_v1.md');
      expect(plan.override).toMatchObject({
        occurrenceId: vector.occurrence_id,
        sourceId: vector.source_id,
        scope: vector.expected.scope,
        startAtOverride: vector.new_start,
        endAtOverride: vector.new_end,
      });
    });
  }
});
