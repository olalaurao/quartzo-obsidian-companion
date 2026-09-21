import type {
  FocusEvidenceObject,
  FocusPhase,
  FocusPhaseTransition,
  FocusPresetSnapshot,
  FocusRuntimeClientKind,
  FocusRuntimeControlCapability,
} from './types';

function localDateKey(value: unknown): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? null;
}

export function resolveFocusRuntimeControl(input: {
  clientKind: FocusRuntimeClientKind;
  currentSessionId?: string | null;
  persistedControllerId?: string | null;
  localControllerId: string;
}): FocusRuntimeControlCapability {
  if (!input.currentSessionId?.trim()) return 'available';
  const controller = input.persistedControllerId?.trim();
  if (!controller) {
    return input.clientKind === 'quartzo' ? 'migrationClaim' : 'readOnlyLegacy';
  }
  return controller === input.localControllerId
    ? 'controller'
    : 'readOnlyForeign';
}

export function canMutateFocusRuntime(
  capability: FocusRuntimeControlCapability,
): boolean {
  return capability === 'available'
    || capability === 'controller'
    || capability === 'migrationClaim';
}

export function focusRemainingSeconds(input: {
  isRunning: boolean;
  totalSeconds: number;
  now: Date;
  phaseEndsAt?: string | null;
  pausedRemainingSeconds?: number | null;
}): number {
  const total = Math.max(0, Math.trunc(input.totalSeconds));
  if (!input.isRunning || !input.phaseEndsAt) {
    return Math.max(
      0,
      Math.min(total, Math.trunc(input.pausedRemainingSeconds ?? total)),
    );
  }
  const end = Date.parse(input.phaseEndsAt);
  if (!Number.isFinite(end)) {
    return Math.max(
      0,
      Math.min(total, Math.trunc(input.pausedRemainingSeconds ?? total)),
    );
  }
  return Math.max(0, Math.min(total, Math.floor((end - input.now.getTime()) / 1000)));
}

export function focusStopwatchElapsedSeconds(input: {
  isRunning: boolean;
  elapsedBeforeCurrentRun: number;
  now: Date;
  stopwatchStartedAt?: string | null;
}): number {
  const maxSeconds = 2 ** 31;
  const previous = Math.max(
    0,
    Math.min(maxSeconds, Math.trunc(input.elapsedBeforeCurrentRun)),
  );
  if (!input.isRunning || !input.stopwatchStartedAt) return previous;
  const started = Date.parse(input.stopwatchStartedAt);
  if (!Number.isFinite(started)) return previous;
  const deltaSeconds = Math.trunc((input.now.getTime() - started) / 1000);
  return Math.max(0, Math.min(maxSeconds, previous + deltaSeconds));
}

export function isFocusPhase(phase: FocusPhase): boolean {
  return phase === 'work' || phase === 'custom';
}

export function completeFocusPhase(input: {
  phase: FocusPhase;
  completedWorkIntervals: number;
  preset: FocusPresetSnapshot;
}): FocusPhaseTransition {
  if (isFocusPhase(input.phase)) {
    const nextCompleted = input.completedWorkIntervals + 1;
    const longBreakEvery = Math.max(1, Math.trunc(input.preset.longBreakEvery));
    const longBreak = nextCompleted % longBreakEvery === 0;
    return {
      nextPhase: longBreak ? 'longBreak' : 'shortBreak',
      nextDurationMinutes: longBreak
        ? input.preset.longBreakMinutes
        : input.preset.shortBreakMinutes,
      completedWorkIntervals: nextCompleted,
    };
  }
  return {
    nextPhase: 'work',
    nextDurationMinutes: input.preset.workMinutes,
    completedWorkIntervals: input.completedWorkIntervals,
  };
}

export function durationForFocusPhase(
  phase: FocusPhase,
  preset: FocusPresetSnapshot,
): number {
  switch (phase) {
    case 'work':
    case 'custom':
      return preset.workMinutes;
    case 'shortBreak':
      return preset.shortBreakMinutes;
    case 'longBreak':
      return preset.longBreakMinutes;
    case 'stopwatch':
      return 0;
  }
}

export function focusChecklistLinkId(
  parentObjectId: string,
  stepId: string,
): string {
  return `checklist:${parentObjectId}:${stepId}`;
}

function evidenceState(raw: Record<string, unknown>): string {
  return String(raw.session_state ?? raw.state ?? '').trim();
}

function evidenceLink(raw: Record<string, unknown>): string {
  return String(raw.linked_item_slug ?? raw.linked_item ?? '').trim();
}

function evidenceDate(raw: Record<string, unknown>): string | null {
  return localDateKey(raw.occurred_at ?? raw.date);
}

export function isChecklistPomodoroEvidence(input: {
  parentObjectId: string;
  stepId: string;
  evaluationDate: string;
  session: Record<string, unknown>;
}): boolean {
  return evidenceState(input.session) === 'completed'
    && evidenceLink(input.session)
      === focusChecklistLinkId(input.parentObjectId, input.stepId)
    && evidenceDate(input.session) === localDateKey(input.evaluationDate);
}

export function findChecklistPomodoroEvidence(input: {
  parentObjectId: string;
  stepId: string;
  evaluationDate: string;
  objects: Iterable<FocusEvidenceObject>;
}): { completed: boolean; completedAt?: string } {
  for (const object of input.objects) {
    const candidates: Record<string, unknown>[] = [];
    if (object.type === 'pomodoro_session') {
      candidates.push(object.frontmatter);
    }
    const embedded = object.frontmatter.pomodoro_sessions;
    if (Array.isArray(embedded)) {
      for (const item of embedded) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          candidates.push(item as Record<string, unknown>);
        }
      }
    }
    for (const session of candidates) {
      if (!isChecklistPomodoroEvidence({
        parentObjectId: input.parentObjectId,
        stepId: input.stepId,
        evaluationDate: input.evaluationDate,
        session,
      })) continue;
      const completedAt = session.completed_at == null
        ? undefined
        : String(session.completed_at);
      return { completed: true, ...(completedAt ? { completedAt } : {}) };
    }
  }
  return { completed: false };
}
