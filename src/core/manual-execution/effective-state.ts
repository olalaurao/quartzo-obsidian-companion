import { findChecklistPomodoroEvidence } from '../focus-runtime';
import { occurrenceResponseIdForDailyItem, type OccurrenceResponseState } from '../occurrence_actions';
import type { ManualExecutionObject, ManualExecutionReferenceResolution } from './references';
import type { ManualExecutionStep } from './types';

export interface ManualExecutionStepState {
  completed: boolean;
  completedAt?: string;
}

function localDateKey(value: unknown): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? null;
}

function habitCompletedOn(body: string | undefined, date: string): boolean {
  if (!body) return false;
  const escaped = date.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  const successful = new RegExp('^- \\[x\\] ' + escaped + ' \\((\\d+)\\/(\\d+)\\)', 'im');
  if (successful.test(body)) return true;
  const partial = new RegExp('^- \\[[ ~]\\] ' + escaped + ' \\((\\d+)\\/(\\d+)\\)(.*)$', 'im').exec(body);
  if (!partial) return false;
  const completions = Number(partial[1]);
  const goal = Number(partial[2]);
  const skipped = /(?:^|\s)skipped:true(?:\s|$)/.test(partial[3] ?? '');
  return !skipped && Number.isFinite(completions) && Number.isFinite(goal) && goal > 0 && completions >= goal;
}

function trackerFieldCompleted(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function responseFor(
  sourceType: string,
  sourceId: string,
  date: string,
  responses: Readonly<Record<string, OccurrenceResponseState>>,
): OccurrenceResponseState | undefined {
  const id = occurrenceResponseIdForDailyItem(sourceType + ':' + sourceId, date);
  return responses[id];
}

export function resolveManualExecutionStepState(
  step: ManualExecutionStep,
  scheduledFor: string,
  references: ManualExecutionReferenceResolution,
  allObjects: Iterable<ManualExecutionObject>,
  responses: Readonly<Record<string, OccurrenceResponseState>>,
  options: { parentObjectId?: string } = {},
): ManualExecutionStepState {
  if (step.kind === 'plain') return { completed: false };
  const date = localDateKey(scheduledFor);
  if (!date) throw new Error('Manual execution scheduledFor must include a local date.');

  if (step.kind === 'pomodoro') {
    const parentObjectId = options.parentObjectId?.trim();
    if (!parentObjectId) return { completed: false };
    return findChecklistPomodoroEvidence({
      parentObjectId,
      stepId: step.id,
      evaluationDate: scheduledFor,
      objects: allObjects,
    });
  }

  const linked = references.byStepId.get(step.id);
  if (!linked) return { completed: false };

  if (step.kind === 'habit') {
    const response = responseFor('habit', linked.id, date, responses);
    if (response?.completedAt) return { completed: true, completedAt: response.completedAt };
    const completed = habitCompletedOn(linked.body, date);
    return {
      completed,
      ...(completed && linked.frontmatter.updated_at
        ? { completedAt: String(linked.frontmatter.updated_at) }
        : {}),
    };
  }

  if (step.kind === 'task') {
    const response = responseFor('task', linked.id, date, responses);
    if (response?.completedAt) {
      return { completed: true, completedAt: response.completedAt };
    }
    if (linked.frontmatter.scheduler == null) {
      const completed = ['done', 'completed', 'finalized'].includes(
        String(linked.frontmatter.stage ?? ''),
      );
      return {
        completed,
        ...(completed && linked.frontmatter.updated_at
          ? { completedAt: String(linked.frontmatter.updated_at) }
          : {}),
      };
    }
    return { completed: false };
  }

  if (step.kind === 'tracker_entry') {
    const linkedSlug = step.linkedObjectSlug?.trim() ?? '';
    const fieldId = step.trackerFieldId?.trim() ?? '';
    for (const object of allObjects) {
      if (object.type !== 'tracker_record') continue;
      const trackerId = String(object.frontmatter.tracker_id ?? '').trim();
      const belongs = trackerId === linkedSlug
        || trackerId === linked.id
        || trackerId === linked.title;
      if (!belongs || localDateKey(object.frontmatter.date) !== date) continue;
      const values = object.frontmatter.field_values;
      if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
      const value = (values as Record<string, unknown>)[fieldId];
      if (!trackerFieldCompleted(value)) continue;
      return {
        completed: true,
        ...(object.frontmatter.updated_at
          ? { completedAt: String(object.frontmatter.updated_at) }
          : { completedAt: String(object.frontmatter.date) }),
      };
    }
    return { completed: false };
  }

  return { completed: false };
}

export function resolveEffectiveLinkedSteps(
  steps: readonly ManualExecutionStep[],
  scheduledFor: string,
  references: ManualExecutionReferenceResolution,
  allObjects: Iterable<ManualExecutionObject>,
  responses: Readonly<Record<string, OccurrenceResponseState>>,
  options: { parentObjectId?: string } = {},
): {
  completions: Record<string, boolean>;
  completedAt: Record<string, string | undefined>;
} {
  const objects = [...allObjects];
  const completions: Record<string, boolean> = {};
  const completedAt: Record<string, string | undefined> = {};
  for (const step of steps) {
    if (step.kind === 'plain') continue;
    const state = resolveManualExecutionStepState(
      step,
      scheduledFor,
      references,
      objects,
      responses,
      options,
    );
    completions[step.id] = state.completed;
    completedAt[step.id] = state.completedAt;
  }
  return { completions, completedAt };
}
