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
    parseInstant(executedAt, 'persisted executed_at');

    const finishedAt = item.finished_at == null
      ? undefined
      : String(item.finished_at).trim() || undefined;
    if (finishedAt) parseInstant(finishedAt, 'persisted finished_at');

    const occurrenceId = item.occurrence_id == null
      ? undefined
      : String(item.occurrence_id).trim() || undefined;
    const scheduledFor = item.scheduled_for == null
      ? undefined
      : String(item.scheduled_for).trim() || undefined;
    if ((occurrenceId == null) !== (scheduledFor == null)) {
      throw new Error(
        'System scheduled occurrence evidence requires occurrence_id and scheduled_for together.',
      );
    }
    if (scheduledFor) parseInstant(scheduledFor, 'persisted scheduled_for');

    return {
      executed_at: executedAt,
      ...(finishedAt ? { finished_at: finishedAt } : {}),
      ...(occurrenceId ? { occurrence_id: occurrenceId, scheduled_for: scheduledFor } : {}),
      step_completions: parsePersistedStepCompletions(item.step_completions),
      ...(item.notes == null ? {} : { notes: String(item.notes) }),
    };
  });
}

function validateScheduledOccurrenceContext(
  systemId: string,
  occurrenceId?: string,
  scheduledFor?: string,
): void {
  if ((occurrenceId == null) !== (scheduledFor == null)) {
    throw new Error(
      'System scheduled occurrence context requires occurrenceId and scheduledFor together.',
    );
  }
  if (!occurrenceId || !scheduledFor) return;

  parseInstant(scheduledFor, 'scheduledFor');
  const prefix = `system:${systemId}@`;
  if (!occurrenceId.startsWith(prefix)) {
    throw new Error(
      `System run scheduled occurrence identity mismatch: expected prefix ${prefix}, got ${occurrenceId}`,
    );
  }
  const identityDate = occurrenceId.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(identityDate)) {
    throw new Error(`System run scheduled occurrence identity has an invalid date: ${occurrenceId}`);
  }
  const parsedDay = new Date(`${identityDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDay.getTime())
    || parsedDay.toISOString().slice(0, 10) !== identityDate
  ) {
    throw new Error(`System run scheduled occurrence identity has an invalid date: ${occurrenceId}`);
  }
}

function sameScheduledOccurrenceContext(
  existing: SystemExecutionEvidence,
  occurrenceId?: string,
  scheduledFor?: string,
): boolean {
  if (existing.occurrence_id !== occurrenceId) return false;
  if (existing.scheduled_for == null || scheduledFor == null) {
    return existing.scheduled_for === scheduledFor;
  }
  return parseInstant(existing.scheduled_for, 'persisted scheduled_for').getTime()
    === parseInstant(scheduledFor, 'scheduledFor').getTime();
}

export function isScheduledSystemOccurrenceCompleted(
  source: Readonly<Record<string, unknown>>,
  occurrenceId: string,
): boolean {
  const systemId = String(source.id ?? '').trim();
  if (!systemId || String(source.type ?? '') !== 'system') {
    throw new Error('System scheduled occurrence source identity is invalid.');
  }
  const prefix = `system:${systemId}@`;
  if (!occurrenceId.startsWith(prefix)) return false;
  return persistedExecutions(source.execution_history).some(
    execution => execution.finished_at != null && execution.occurrence_id === occurrenceId,
  );
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
    occurrenceId?: string;
    scheduledFor?: string;
  },
): SystemRunFinalization {
  const systemId = String(source.id ?? '').trim();
  const title = String(source.title ?? '').trim();
  if (!systemId || String(source.type ?? '') !== 'system') {
    throw new Error('System run source identity is invalid.');
  }
  if (!title) throw new Error('System title is required.');

  validateScheduledOccurrenceContext(systemId, input.occurrenceId, input.scheduledFor);

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
    if (!sameScheduledOccurrenceContext(existing, input.occurrenceId, input.scheduledFor)) {
      throw new Error(
        `System run retry collides with different scheduled occurrence context: ${systemId}@${input.startedAt}`,
      );
    }
    canonicalFinishedAt = existing.finished_at ?? input.finishedAt;
  } else {
    history.push({
      executed_at: input.startedAt,
      finished_at: input.finishedAt,
      ...(input.occurrenceId
        ? { occurrence_id: input.occurrenceId, scheduled_for: input.scheduledFor }
        : {}),
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
