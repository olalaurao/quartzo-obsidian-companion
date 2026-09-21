import {
  normalizeChecklistSteps,
} from './policy';
import type {
  ChecklistStepData,
  RoutineExecutionProjection,
  RoutineFinalization,
  SystemRunFinalization,
} from './types';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function quartzoLocalDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid execution date.');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function routineManualOccurrenceId(routineId: string, startedAt: Date): string {
  const id = routineId.trim();
  if (!id) throw new Error('Routine id is required.');
  return `manual:routine:${id}@${quartzoLocalDateTime(startedAt)}`;
}

function parseLocalDateTime(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid execution timestamp: ${value}`);
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boolMap(value: unknown): Record<string, boolean> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (raw === true || raw === false) out[key] = raw;
    else {
      const normalized = String(raw).trim().toLowerCase();
      if (['true', 'done', 'completed', '1'].includes(normalized)) out[key] = true;
      else if (['false', '0'].includes(normalized)) out[key] = false;
      else throw new Error(`Invalid persisted step completion: ${key}=${String(raw)}`);
    }
  }
  return out;
}

function sameBoolMap(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => right[key] === left[key]);
}

function systemSteps(frontmatter: Record<string, unknown>): ChecklistStepData[] {
  const steps = normalizeChecklistSteps(frontmatter.steps);
  if (steps.length === 0) throw new Error('System has no executable steps.');
  return steps;
}

export function finalizeSystemRunFrontmatter(
  frontmatter: Record<string, unknown>,
  startedAt: Date,
  finishedAt: Date,
  stepCompletions: Record<string, boolean>,
): SystemRunFinalization {
  if (String(frontmatter.type) !== 'system') throw new Error('System execution requires a System object.');
  if (finishedAt.getTime() < startedAt.getTime()) throw new Error('System run cannot finish before it starts.');

  const steps = systemSteps(frontmatter);
  const known = new Set(steps.map(step => step.id));
  const unknown = Object.keys(stepCompletions).filter(id => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`System run contains unknown step ids: ${unknown.join(', ')}`);
  }
  const normalized = Object.fromEntries(steps.map(step => [step.id, stepCompletions[step.id] === true]));
  const started = quartzoLocalDateTime(startedAt);
  const requestedFinished = quartzoLocalDateTime(finishedAt);

  const rawHistory = frontmatter.execution_history;
  if (rawHistory != null && !Array.isArray(rawHistory)) {
    throw new Error('Invalid System execution_history: expected a list.');
  }
  const history = (Array.isArray(rawHistory) ? rawHistory : []).map(entry => {
    const record = asRecord(entry);
    if (!record) throw new Error('Invalid System execution entry.');
    return { ...record };
  });

  const existing = history.find(entry => String(entry.executed_at ?? '') === started);
  let canonicalFinished = requestedFinished;
  let alreadyRecorded = false;
  if (existing) {
    alreadyRecorded = true;
    if (!sameBoolMap(boolMap(existing.step_completions), normalized)) {
      throw new Error(`System run retry collides with different step completions: ${String(frontmatter.id)}@${started}`);
    }
    if (existing.finished_at != null) canonicalFinished = String(existing.finished_at);
  } else {
    history.push({
      executed_at: started,
      finished_at: requestedFinished,
      step_completions: normalized,
    });
  }

  const canonicalFinishedDate = parseLocalDateTime(canonicalFinished);
  if (canonicalFinishedDate.getTime() < startedAt.getTime()) {
    throw new Error('Persisted System run finishes before it starts.');
  }
  const duration = Math.floor((canonicalFinishedDate.getTime() - startedAt.getTime()) / 60_000);
  const systemId = String(frontmatter.id ?? '').trim();
  if (!systemId) throw new Error('System id is required.');
  const title = String(frontmatter.title ?? 'Untitled');

  return {
    frontmatter: { ...frontmatter, execution_history: history },
    summaryTask: {
      id: `system-run:${systemId}@${started}`,
      type: 'task',
      title,
      stage: 'finalized',
      created_at: started,
      updated_at: canonicalFinished,
      duration,
      linked_system: systemId,
    },
    executionAlreadyRecorded: alreadyRecorded,
    canonicalFinishedAt: canonicalFinished,
  };
}

function routineExecutions(frontmatter: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = frontmatter.routine_executions;
  if (raw != null && !Array.isArray(raw)) {
    throw new Error('Invalid Routine routine_executions: expected a list.');
  }
  return (Array.isArray(raw) ? raw : []).map(value => {
    const record = asRecord(value);
    if (!record) throw new Error('Invalid Routine execution entry.');
    return { ...record };
  });
}

function routineSteps(frontmatter: Record<string, unknown>): ChecklistStepData[] {
  const steps = normalizeChecklistSteps(frontmatter.steps);
  if (steps.length === 0) throw new Error('Routine has no executable steps.');
  return steps;
}

function executionStepStates(
  steps: ChecklistStepData[],
  raw: unknown,
): Array<Record<string, unknown>> {
  const existing = Array.isArray(raw)
    ? raw.map(value => asRecord(value)).filter((value): value is Record<string, unknown> => value != null)
    : [];
  const byId = new Map(existing.map(value => [String(value.step_id ?? ''), value]));
  return steps.map(step => {
    const current = byId.get(step.id);
    return {
      step_id: step.id,
      title_snapshot: step.title,
      kind_snapshot: step.kind,
      required_snapshot: step.required,
      completed: current?.completed === true,
      ...(current?.completed_at ? { completed_at: String(current.completed_at) } : {}),
    };
  });
}

function upsertRoutineExecution(
  frontmatter: Record<string, unknown>,
  occurrenceId: string,
  scheduledFor: Date,
  startedAt: Date,
  now: Date,
  update: (steps: ChecklistStepData[], execution: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  if (String(frontmatter.type) !== 'routine') throw new Error('Routine execution requires a Routine object.');
  const steps = routineSteps(frontmatter);
  const executions = routineExecutions(frontmatter);
  const scheduled = quartzoLocalDateTime(scheduledFor);
  const started = quartzoLocalDateTime(startedAt);
  const updated = quartzoLocalDateTime(now);
  const index = executions.findIndex(value => String(value.occurrence_id ?? '') === occurrenceId);
  const current: Record<string, unknown> = index >= 0 ? executions[index] : {
    occurrence_id: occurrenceId,
    scheduled_for: scheduled,
    started_at: started,
    updated_at: updated,
    steps: [],
  };
  const reconciled = {
    ...current,
    occurrence_id: occurrenceId,
    scheduled_for: String(current.scheduled_for ?? scheduled),
    started_at: String(current.started_at ?? started),
    updated_at: updated,
    steps: executionStepStates(steps, current.steps),
  };
  const next = update(steps, reconciled);
  if (index >= 0) executions[index] = next;
  else executions.push(next);
  return {
    ...frontmatter,
    routine_executions_version: 2,
    routine_executions: executions,
  };
}

export function setRoutinePlainStepFrontmatter(
  frontmatter: Record<string, unknown>,
  occurrenceId: string,
  scheduledFor: Date,
  startedAt: Date,
  stepId: string,
  completed: boolean,
  now: Date,
): Record<string, unknown> {
  return upsertRoutineExecution(frontmatter, occurrenceId, scheduledFor, startedAt, now, (steps, execution) => {
    const definition = steps.find(step => step.id === stepId);
    if (!definition || definition.kind !== 'plain') {
      throw new Error('Only plain Routine steps can be changed directly by the execution owner.');
    }
    const timestamp = quartzoLocalDateTime(now);
    const states = (execution.steps as Array<Record<string, unknown>>).map(state =>
      String(state.step_id) === stepId
        ? {
            ...state,
            completed,
            ...(completed ? { completed_at: timestamp } : { completed_at: undefined }),
          }
        : state
    ).map(state => {
      if (state.completed_at !== undefined) return state;
      const copy = { ...state };
      delete copy.completed_at;
      return copy;
    });
    return { ...execution, steps: states, updated_at: timestamp };
  });
}

export function finalizeRoutineFrontmatter(
  frontmatter: Record<string, unknown>,
  occurrenceId: string,
  scheduledFor: Date,
  startedAt: Date,
  linkedCompletions: Record<string, boolean>,
  now: Date,
): RoutineFinalization {
  let projection: RoutineExecutionProjection | null = null;
  const next = upsertRoutineExecution(frontmatter, occurrenceId, scheduledFor, startedAt, now, (steps, execution) => {
    const timestamp = quartzoLocalDateTime(now);
    const currentStates = execution.steps as Array<Record<string, unknown>>;
    const states = currentStates.map(state => {
      const stepId = String(state.step_id ?? '');
      const definition = steps.find(step => step.id === stepId);
      if (!definition) return state;
      const completed = definition.kind === 'plain'
        ? true
        : linkedCompletions[stepId] === true;
      const previousCompletedAt = state.completed_at == null ? undefined : String(state.completed_at);
      return {
        ...state,
        completed,
        ...(completed ? { completed_at: previousCompletedAt ?? timestamp } : {}),
      };
    }).map(state => {
      if (state.completed === true) return state;
      const copy = { ...state };
      delete copy.completed_at;
      return copy;
    });
    const requiredStates = states.filter(state => state.required_snapshot !== false);
    const completed = requiredStates.length > 0 && requiredStates.every(state => state.completed === true);
    const result: Record<string, unknown> = {
      ...execution,
      updated_at: timestamp,
      steps: states,
    };
    if (completed) result.completed_at = String(execution.completed_at ?? timestamp);
    else delete result.completed_at;

    projection = {
      occurrenceId,
      scheduledFor: String(result.scheduled_for),
      startedAt: String(result.started_at),
      updatedAt: String(result.updated_at),
      ...(result.completed_at ? { completedAt: String(result.completed_at) } : {}),
      stepCompletions: Object.fromEntries(states.map(state => [String(state.step_id), state.completed === true])),
    };
    return result;
  });
  if (!projection) throw new Error('Routine execution could not be finalized.');
  return { frontmatter: next, execution: projection, completed: projection.completedAt != null };
}

export function projectRoutineExecution(
  frontmatter: Record<string, unknown>,
  occurrenceId: string,
): RoutineExecutionProjection | null {
  const execution = routineExecutions(frontmatter)
    .find(value => String(value.occurrence_id ?? '') === occurrenceId);
  if (!execution) return null;
  const states = Array.isArray(execution.steps) ? execution.steps : [];
  return {
    occurrenceId,
    scheduledFor: String(execution.scheduled_for ?? ''),
    startedAt: String(execution.started_at ?? ''),
    updatedAt: String(execution.updated_at ?? ''),
    ...(execution.completed_at ? { completedAt: String(execution.completed_at) } : {}),
    stepCompletions: Object.fromEntries(states.map(value => {
      const record = asRecord(value) ?? {};
      return [String(record.step_id ?? ''), record.completed === true];
    }).filter(([id]) => Boolean(id))),
  };
}
