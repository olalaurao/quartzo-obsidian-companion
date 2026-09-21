import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  allowsBackgroundAutoRun,
  finalizeRoutineOccurrence,
  finalizeSystemRun,
  manualRoutineOccurrenceId,
  mutateRoutineOccurrence,
  resolveManualExecutionRunCapability,
  resolveManualExecutionStepCapability,
  resolveEffectiveLinkedSteps,
  resolveManualExecutionReferences,
  type ManualExecutionStep,
} from '../../src/core/manual-execution';

type Vector = Record<string, unknown> & { id: string; case: string };

function vectorStep(raw: Record<string, unknown>): ManualExecutionStep {
  return {
    id: String(raw.id ?? 'step'),
    title: String(raw.title ?? raw.id ?? 'step'),
    kind: String(raw.kind ?? raw.step_kind ?? 'plain'),
    required: raw.required !== false,
    linkedObjectSlug: raw.linked_object_slug == null ? undefined : String(raw.linked_object_slug),
    trackerFieldId: raw.tracker_field_id == null ? undefined : String(raw.tracker_field_id),
  };
}

describe('System/Routine manual execution contract vectors', () => {
  const vectorsPath = path.join(
    process.cwd(),
    'contracts',
    'quartzo',
    'system_routine_execution',
    'vectors.json',
  );
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8')) as Vector[];

  for (const vector of vectors) {
    it(`passes vector ${vector.id}`, () => {
      switch (vector.case) {
        case 'step_capability': {
          const step = vectorStep(vector);
          expect(resolveManualExecutionStepCapability(step))
            .toBe(vector.expected_capability);
          return;
        }
        case 'run_capability': {
          const steps = (vector.steps as Record<string, unknown>[]).map(vectorStep);
          const delegated = new Set((vector.available_delegated_kinds as string[]) ?? []);
          expect(resolveManualExecutionRunCapability(
            String(vector.source_type),
            steps,
            {
              focusRuntimeAvailable: vector.focus_runtime_available === true,
              availableDelegatedKinds: delegated,
            },
          )).toBe(vector.expected_capability);
          return;
        }
        case 'background_auto_run':
          expect(allowsBackgroundAutoRun(String(vector.source_type)))
            .toBe(vector.expected_allowed);
          return;
        case 'system_finish': {
          const steps = (vector.steps as Record<string, unknown>[]).map(vectorStep);
          let source: Record<string, unknown> = {
            id: vector.system_id,
            type: 'system',
            title: vector.title,
            steps: steps.map(step => ({
              id: step.id,
              title: step.title,
              kind: step.kind,
              required: step.required,
            })),
          };
          const repeat = Number(vector.repeat_finalize ?? 1);
          let result = finalizeSystemRun(source, {
            startedAt: String(vector.started_at),
            finishedAt: String(vector.finished_at),
            stepCompletions: vector.step_completions as Record<string, boolean>,
          });
          source = result.frontmatter;
          for (let index = 1; index < repeat; index += 1) {
            result = finalizeSystemRun(source, {
              startedAt: String(vector.started_at),
              finishedAt: String(vector.retry_finished_at ?? vector.finished_at),
              stepCompletions: vector.step_completions as Record<string, boolean>,
            });
            source = result.frontmatter;
          }
          const expected = vector.expected as Record<string, unknown>;
          const history = source.execution_history as Array<Record<string, unknown>>;
          expect(history).toHaveLength(Number(expected.execution_count));
          expect(history[0]?.step_completions).toEqual(expected.step_completions);
          expect(history[0]?.finished_at).toBe(expected.finished_at);
          expect(result.summaryTask.id).toBe(expected.summary_task_id);
          expect(result.summaryTask.duration).toBe(expected.duration_minutes);
          expect(result.summaryTask.stage).toBe(expected.summary_task_stage);
          expect(result.summaryTask.linked_system).toBe(expected.linked_system);
          if (repeat > 1) expect(result.executionAlreadyRecorded).toBe(true);
          return;
        }
        case 'system_retry_conflict': {
          const steps = (vector.steps as Record<string, unknown>[]).map(vectorStep);
          const source: Record<string, unknown> = {
            id: vector.system_id,
            type: 'system',
            title: vector.title,
            steps: steps.map(step => ({
              id: step.id,
              title: step.title,
              kind: step.kind,
              required: step.required,
            })),
          };
          const first = finalizeSystemRun(source, {
            startedAt: String(vector.started_at),
            finishedAt: String(vector.finished_at),
            stepCompletions: vector.first_step_completions as Record<string, boolean>,
          });
          expect(() => finalizeSystemRun(first.frontmatter, {
            startedAt: String(vector.started_at),
            finishedAt: String(vector.retry_finished_at),
            stepCompletions: vector.retry_step_completions as Record<string, boolean>,
          })).toThrow(/collides with different step completions/i);
          return;
        }
        case 'routine_manual_identity':
          expect(manualRoutineOccurrenceId(
            String(vector.routine_id),
            String(vector.started_at),
          )).toBe(vector.expected_occurrence_id);
          return;
        case 'routine_complete': {
          const linkedCompleted = vector.linked_task_completed === true;
          const source: Record<string, unknown> = {
            id: vector.routine_id,
            type: 'routine',
            title: 'Mixed routine',
            steps: [
              { id: 'plain', title: 'Plain', kind: 'plain', required: true },
              {
                id: 'linked',
                title: 'Linked task',
                kind: 'task',
                required: true,
                linked_object_slug: 'linked-task',
              },
            ],
          };
          const result = finalizeRoutineOccurrence(source, {
            occurrenceId: String(vector.occurrence_id),
            scheduledFor: String(vector.scheduled_for),
            startedAt: String(vector.scheduled_for),
            now: '2026-09-21T10:00:00.000',
            effectiveLinkedCompletions: { linked: linkedCompleted },
          });
          const expected = vector.expected as Record<string, unknown>;
          const byId = Object.fromEntries(result.execution.steps.map(step => [step.step_id, step.completed]));
          expect(byId.plain).toBe(expected.plain_completed);
          expect(byId.linked).toBe(expected.linked_completed);
          expect(result.isCompleted).toBe(expected.routine_completed);
          return;
        }
        default:
          throw new Error(`Unhandled contract case: ${vector.case}`);
      }
    });
  }

  it('routine plain progress can be persisted without fabricating linked completion', () => {
    const source = {
      id: 'routine',
      type: 'routine',
      title: 'Routine',
      steps: [
        { id: 'plain', title: 'Plain', kind: 'plain', required: true },
        { id: 'task', title: 'Task', kind: 'task', required: true, linked_object_slug: 'task' },
      ],
    };
    const result = mutateRoutineOccurrence(source, {
      occurrenceId: 'manual:routine:routine@2026-09-21T09:00:00.000',
      scheduledFor: '2026-09-21T09:00:00.000',
      startedAt: '2026-09-21T09:00:00.000',
      now: '2026-09-21T09:01:00.000',
      plainStepUpdates: { plain: true },
      effectiveLinkedCompletions: { task: false },
    });
    expect(result.execution.steps.find(step => step.step_id === 'plain')?.completed).toBe(true);
    expect(result.execution.steps.find(step => step.step_id === 'task')?.completed).toBe(false);
    expect(result.isCompleted).toBe(false);
  });

  it('routine Pomodoro step closes only from completed checklist evidence', () => {
    const steps: ManualExecutionStep[] = [{
      id: 'deep-work',
      title: 'Deep work',
      kind: 'pomodoro',
      required: true,
    }];
    const references = resolveManualExecutionReferences(steps, []);
    const completedObjects = [{
      id: '2026-09-21',
      type: 'daily_note',
      title: '',
      frontmatter: {
        type: 'daily_note',
        date: '2026-09-21',
        pomodoro_sessions: [{
          id: 'pomo-checklist',
          linked_item: 'checklist:routine-morning:deep-work',
          state: 'completed',
          occurred_at: '2026-09-21T08:30:00.000',
          completed_at: '2026-09-21T08:55:00.000',
        }],
      },
      body: '',
    }];
    const effective = resolveEffectiveLinkedSteps(
      steps,
      '2026-09-21T09:00:00.000',
      references,
      completedObjects,
      {},
      { parentObjectId: 'routine-morning' },
    );
    expect(effective.completions['deep-work']).toBe(true);

    const source = {
      id: 'routine-morning',
      type: 'routine',
      title: 'Morning',
      steps: [{
        id: 'deep-work',
        title: 'Deep work',
        kind: 'pomodoro',
        required: true,
      }],
    };
    const result = finalizeRoutineOccurrence(source, {
      occurrenceId: 'routine:routine-morning@2026-09-21T09:00:00.000',
      scheduledFor: '2026-09-21T09:00:00.000',
      startedAt: '2026-09-21T09:00:00.000',
      now: '2026-09-21T09:01:00.000',
      effectiveLinkedCompletions: effective.completions,
      effectiveLinkedCompletedAt: effective.completedAt,
    });
    expect(result.isCompleted).toBe(true);
    expect(result.execution.steps[0]?.completed).toBe(true);
    expect(result.execution.steps[0]?.completed_at)
      .toBe('2026-09-21T08:55:00.000');
  });

  it('routine Pomodoro step stays pending for partial evidence', () => {
    const steps: ManualExecutionStep[] = [{
      id: 'deep-work',
      title: 'Deep work',
      kind: 'pomodoro',
      required: true,
    }];
    const references = resolveManualExecutionReferences(steps, []);
    const effective = resolveEffectiveLinkedSteps(
      steps,
      '2026-09-21T09:00:00.000',
      references,
      [{
        id: '2026-09-21',
        type: 'daily_note',
        title: '',
        frontmatter: {
          pomodoro_sessions: [{
            id: 'pomo-partial',
            linked_item: 'checklist:routine-morning:deep-work',
            state: 'partial',
            occurred_at: '2026-09-21T08:30:00.000',
            completed_at: '2026-09-21T08:40:00.000',
          }],
        },
      }],
      {},
      { parentObjectId: 'routine-morning' },
    );
    expect(effective.completions['deep-work']).toBe(false);
  });

});
