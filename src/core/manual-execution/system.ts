import {
  normalizeStepCompletions,
  parseManualExecutionSteps,
  parsePersistedStepCompletions,
  sameStepCompletions,
  type SystemExecutionEvidence,
  type SystemRunSummaryTask,
} from './types';

export interface SystemRunFinalization {
  frontmatter: Record<string, unknown>;
  summaryTask: SystemRunSummaryTask;
  executionAlreadyRecorded: boolean;
  canonicalFinishedAt: string;
}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid.`);
  return parsed;
}

function persistedExecutions(value: unknown): SystemExecutionEvidence[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('System execution_history must be a list.');
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`System execution ${index + 1} must be an object.`);
    }
    const item = raw as Record<string, unknown>;
    const executedAt = String(item.executed_at ?? '').trim();
    if (!executedAt) throw new Error('System execution executed_at is required.');
    const finishedAt = item.finished_at == null
      ? undefined
      : String(item.finished_at).trim() || undefined;
    return {
      executed_at: executedAt,
      ...(finishedAt ? { finished_at: finishedAt } : {}),
      step_completions: parsePersistedStepCompletions(item.step_completions),
      ...(item.notes == null ? {} : { notes: String(item.notes) }),
    };
  });
}

export function systemSummaryTaskId(systemId: string, startedAt: string): string {
  return `system-run:${systemId}@${startedAt}`;
}

export function finalizeSystemRun(
  source: Readonly<Record<string, unknown>>,
  input: {
    startedAt: string;
    finishedAt: string;
    stepCompletions: Readonly<Record<string, boolean>>;
  },
): SystemRunFinalization {
  const systemId = String(source.id ?? '').trim();
  const title = String(source.title ?? '').trim();
  if (!systemId || String(source.type ?? '') !== 'system') {
    throw new Error('System run source identity is invalid.');
  }
  if (!title) throw new Error('System title is required.');

  const started = parseInstant(input.startedAt, 'startedAt');
  const requestedFinished = parseInstant(input.finishedAt, 'finishedAt');
  if (requestedFinished.getTime() < started.getTime()) {
    throw new Error('finishedAt must not be before startedAt.');
  }

  const steps = parseManualExecutionSteps(source.steps);
  const normalized = normalizeStepCompletions(steps, input.stepCompletions);
  const history = persistedExecutions(source.execution_history);
  const existing = history.find(execution => execution.executed_at === input.startedAt);
  let canonicalFinishedAt = input.finishedAt;

  if (existing) {
    if (!sameStepCompletions(existing.step_completions, normalized)) {
      throw new Error(
        `System run retry collides with different step completions: ${systemId}@${input.startedAt}`,
      );
    }
    canonicalFinishedAt = existing.finished_at ?? input.finishedAt;
  } else {
    history.push({
      executed_at: input.startedAt,
      finished_at: input.finishedAt,
      step_completions: normalized,
    });
  }

  const finished = parseInstant(canonicalFinishedAt, 'persisted finished_at');
  if (finished.getTime() < started.getTime()) {
    throw new Error('Persisted System run finishes before it starts.');
  }
  const duration = Math.floor((finished.getTime() - started.getTime()) / 60_000);

  return {
    frontmatter: {
      ...source,
      execution_history: history,
    },
    summaryTask: {
      id: systemSummaryTaskId(systemId, input.startedAt),
      type: 'task',
      title,
      stage: 'finalized',
      created_at: input.startedAt,
      updated_at: canonicalFinishedAt,
      duration,
      linked_system: systemId,
    },
    executionAlreadyRecorded: Boolean(existing),
    canonicalFinishedAt,
  };
}
