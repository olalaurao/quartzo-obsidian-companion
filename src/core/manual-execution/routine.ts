import {
  parseManualExecutionSteps,
  type ManualExecutionStep,
  type RoutineExecutionEvidence,
  type RoutineExecutionStepEvidence,
} from './types';

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function parseExecutionStep(value: unknown): RoutineExecutionStepEvidence {
  const raw = record(value, 'Routine execution step');
  const stepId = String(raw.step_id ?? '').trim();
  if (!stepId) throw new Error('Routine execution step_id is required.');
  return {
    step_id: stepId,
    title_snapshot: String(raw.title_snapshot ?? stepId),
    kind_snapshot: String(raw.kind_snapshot ?? 'plain'),
    required_snapshot: raw.required_snapshot !== false,
    completed: raw.completed === true,
    ...(optionalText(raw.completed_at) ? { completed_at: optionalText(raw.completed_at)! } : {}),
  };
}

function parseExecutions(value: unknown): RoutineExecutionEvidence[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('routine_executions must be a list.');
  return value.map(rawValue => {
    const raw = record(rawValue, 'Routine execution');
    const occurrenceId = String(raw.occurrence_id ?? '').trim();
    const scheduledFor = String(raw.scheduled_for ?? '').trim();
    const startedAt = String(raw.started_at ?? raw.executed_at ?? '').trim();
    const updatedAt = String(raw.updated_at ?? raw.executed_at ?? startedAt).trim();
    if (!occurrenceId || !scheduledFor || !startedAt || !updatedAt) {
      throw new Error('Routine V2 execution identity/timestamps are incomplete.');
    }
    const steps = Array.isArray(raw.steps) ? raw.steps.map(parseExecutionStep) : [];
    return {
      occurrence_id: occurrenceId,
      scheduled_for: scheduledFor,
      started_at: startedAt,
      updated_at: updatedAt,
      ...(optionalText(raw.completed_at) ? { completed_at: optionalText(raw.completed_at)! } : {}),
      steps,
      ...(raw.notes == null ? {} : { notes: String(raw.notes) }),
      ...(raw.mood_before == null ? {} : { mood_before: String(raw.mood_before) }),
      ...(raw.mood_after == null ? {} : { mood_after: String(raw.mood_after) }),
      ...(raw.legacy_summary && typeof raw.legacy_summary === 'object' && !Array.isArray(raw.legacy_summary)
        ? { legacy_summary: { ...(raw.legacy_summary as Record<string, unknown>) } }
        : {}),
    };
  });
}

export function manualRoutineOccurrenceId(routineId: string, startedAt: string): string {
  const id = routineId.trim();
  if (!id) throw new Error('Routine id is required.');
  return `manual:routine:${id}@${startedAt}`;
}

export function routineExecutionForOccurrence(
  source: Readonly<Record<string, unknown>>,
  occurrenceId: string,
): RoutineExecutionEvidence | undefined {
  return parseExecutions(source.routine_executions)
    .find(execution => execution.occurrence_id === occurrenceId);
}

export function routinePlainCompletions(
  source: Readonly<Record<string, unknown>>,
  occurrenceId: string,
): Record<string, boolean> {
  const execution = routineExecutionForOccurrence(source, occurrenceId);
  if (!execution) return {};
  return Object.fromEntries(
    execution.steps
      .filter(step => step.kind_snapshot === 'plain')
      .map(step => [step.step_id, step.completed]),
  );
}

function initialStepEvidence(
  step: ManualExecutionStep,
  completed: boolean,
  completedAt?: string,
): RoutineExecutionStepEvidence {
  return {
    step_id: step.id,
    title_snapshot: step.title,
    kind_snapshot: step.kind,
    required_snapshot: step.required,
    completed,
    ...(completed && completedAt ? { completed_at: completedAt } : {}),
  };
}

function upsertExecution(
  executions: readonly RoutineExecutionEvidence[],
  next: RoutineExecutionEvidence,
): RoutineExecutionEvidence[] {
  let replaced = false;
  const result: RoutineExecutionEvidence[] = [];
  for (const current of executions) {
    if (current.occurrence_id === next.occurrence_id) {
      if (!replaced) {
        result.push(next);
        replaced = true;
      }
    } else {
      result.push(current);
    }
  }
  if (!replaced) result.push(next);
  return result;
}

export interface RoutineOccurrenceMutationInput {
  occurrenceId: string;
  scheduledFor: string;
  startedAt: string;
  now: string;
  plainStepUpdates?: Readonly<Record<string, boolean>>;
  completePlainSteps?: boolean;
  effectiveLinkedCompletions?: Readonly<Record<string, boolean>>;
  effectiveLinkedCompletedAt?: Readonly<Record<string, string | undefined>>;
}

export interface RoutineOccurrenceMutationResult {
  frontmatter: Record<string, unknown>;
  execution: RoutineExecutionEvidence;
  isCompleted: boolean;
}

export function mutateRoutineOccurrence(
  source: Readonly<Record<string, unknown>>,
  input: RoutineOccurrenceMutationInput,
): RoutineOccurrenceMutationResult {
  const routineId = String(source.id ?? '').trim();
  if (!routineId || String(source.type ?? '') !== 'routine') {
    throw new Error('Routine run source identity is invalid.');
  }
  const steps = parseManualExecutionSteps(source.steps);
  const executions = parseExecutions(source.routine_executions);
  const existing = executions.find(item => item.occurrence_id === input.occurrenceId);
  const existingById = new Map((existing?.steps ?? []).map(step => [step.step_id, step]));

  const stepStates: RoutineExecutionStepEvidence[] = steps.map(step => {
    const prior = existingById.get(step.id);
    if (step.kind === 'plain') {
      const explicit = input.plainStepUpdates?.[step.id];
      const completed = explicit ?? (input.completePlainSteps ? true : prior?.completed === true);
      const becameCompleted = completed && prior?.completed !== true;
      return initialStepEvidence(
        step,
        completed,
        completed
          ? (prior?.completed_at ?? (becameCompleted ? input.now : undefined))
          : undefined,
      );
    }

    const completed = input.effectiveLinkedCompletions?.[step.id] ?? prior?.completed === true;
    return initialStepEvidence(
      step,
      completed,
      completed
        ? (input.effectiveLinkedCompletedAt?.[step.id] ?? prior?.completed_at ?? input.now)
        : undefined,
    );
  });

  const required = stepStates.filter(step => step.required_snapshot);
  const isCompleted = required.length > 0 && required.every(step => step.completed);
  const next: RoutineExecutionEvidence = {
    occurrence_id: input.occurrenceId,
    scheduled_for: input.scheduledFor,
    started_at: existing?.started_at ?? input.startedAt,
    updated_at: input.now,
    ...(isCompleted
      ? { completed_at: existing?.completed_at ?? input.now }
      : {}),
    steps: stepStates,
    ...(existing?.notes == null ? {} : { notes: existing.notes }),
    ...(existing?.mood_before == null ? {} : { mood_before: existing.mood_before }),
    ...(existing?.mood_after == null ? {} : { mood_after: existing.mood_after }),
  };

  return {
    frontmatter: {
      ...source,
      routine_executions_version: 2,
      routine_executions: upsertExecution(executions, next),
    },
    execution: next,
    isCompleted,
  };
}

export function finalizeRoutineOccurrence(
  source: Readonly<Record<string, unknown>>,
  input: Omit<RoutineOccurrenceMutationInput, 'completePlainSteps'>,
): RoutineOccurrenceMutationResult {
  return mutateRoutineOccurrence(source, { ...input, completePlainSteps: true });
}
