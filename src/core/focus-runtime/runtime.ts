import { localIsoDateTime } from '../local-date';
import {
  canMutateFocusRuntime,
  completeFocusPhase,
  durationForFocusPhase,
  focusRemainingSeconds,
  focusStopwatchElapsedSeconds,
  isFocusPhase,
  resolveFocusRuntimeControl,
} from './contract';
import { createIdleFocusRuntimeState, focusPresetToFrontmatter } from './state-codec';
import type {
  FocusPhase,
  FocusPresetSnapshot,
  FocusRuntimeMode,
  FocusRuntimeState,
  FocusSessionDisposition,
  FocusSessionEvidence,
} from './types';

export class FocusRuntimeControlConflict extends Error {
  constructor(
    readonly activeRuntimeSessionId: string | undefined,
    readonly controllerId: string | undefined,
  ) {
    super('Focus is active on another device.');
    this.name = 'FocusRuntimeControlConflict';
  }
}

export function focusTotalSeconds(state: FocusRuntimeState): number {
  return state.phaseDurationSeconds
    ?? durationForFocusPhase(state.currentType, state.presetSnapshot) * 60;
}

export function focusElapsedSeconds(
  state: FocusRuntimeState,
  now: Date,
): number {
  if (state.runtimeMode === 'stopwatch') {
    return focusStopwatchElapsedSeconds({
      isRunning: state.isRunning,
      elapsedBeforeCurrentRun: state.stopwatchElapsedBeforeCurrentRun,
      now,
      stopwatchStartedAt: state.stopwatchStartedAt,
    });
  }
  const total = focusTotalSeconds(state);
  const remaining = focusRemainingSeconds({
    isRunning: state.isRunning,
    totalSeconds: total,
    now,
    phaseEndsAt: state.phaseEndsAt,
    pausedRemainingSeconds: state.pausedRemainingSeconds,
  });
  return Math.max(0, Math.min(total, total - remaining));
}

export function assertCompanionFocusControl(
  state: FocusRuntimeState,
  localControllerId: string,
): void {
  const capability = resolveFocusRuntimeControl({
    clientKind: 'companion',
    currentSessionId: state.currentSessionId,
    persistedControllerId: state.focusControllerId,
    localControllerId,
  });
  if (!canMutateFocusRuntime(capability)) {
    throw new FocusRuntimeControlConflict(
      state.currentSessionId,
      state.focusControllerId,
    );
  }
}

export function startFocusRuntime(
  state: FocusRuntimeState,
  input: {
    localControllerId: string;
    sessionId: string;
    now: Date;
    mode?: FocusRuntimeMode;
    phase?: FocusPhase;
    preset?: FocusPresetSnapshot;
    currentItemId?: string;
    currentItemTitle?: string;
    linkedObjectRef?: Record<string, unknown>;
  },
): FocusRuntimeState {
  if (state.currentSessionId) {
    assertCompanionFocusControl(state, input.localControllerId);
    if (state.isRunning) return state;
  }

  const nowIso = localIsoDateTime(input.now);
  const preset = input.preset ?? state.presetSnapshot;
  const startingNew = !state.currentSessionId;
  const mode = startingNew ? (input.mode ?? state.runtimeMode) : state.runtimeMode;
  const phase = startingNew
    ? (input.phase ?? (mode === 'stopwatch' ? 'stopwatch' : state.currentType))
    : state.currentType;

  let next: FocusRuntimeState = {
    ...state,
    ...(startingNew ? {
      runtimeMode: mode,
      currentType: phase,
      presetSnapshot: preset,
      selectedPresetId: preset.presetId ?? state.selectedPresetId,
      currentItemId: input.currentItemId ?? state.currentItemId,
      currentItemTitle: input.currentItemTitle ?? state.currentItemTitle,
      linkedObjectRef: input.linkedObjectRef ?? state.linkedObjectRef,
      currentSessionId: input.sessionId,
      focusControllerId: input.localControllerId,
      actualStartedAt: nowIso,
      completedSessions: 0,
      phaseSequence: 0,
      lastProcessedPhaseCompletionToken: undefined,
      actualWorkSeconds: 0,
      actualBreakSeconds: 0,
    } : {}),
    lastUpdate: nowIso,
  };

  if (mode === 'stopwatch') {
    next = {
      ...next,
      runtimeMode: 'stopwatch',
      currentType: 'stopwatch',
      isRunning: true,
      phaseStartedAt: undefined,
      phaseEndsAt: undefined,
      phaseDurationSeconds: undefined,
      pausedAt: undefined,
      pausedRemainingSeconds: undefined,
      stopwatchStartedAt: nowIso,
      stopwatchElapsedBeforeCurrentRun: startingNew
        ? 0
        : state.stopwatchElapsedBeforeCurrentRun,
    };
    return next;
  }

  const total = next.phaseDurationSeconds
    ?? durationForFocusPhase(next.currentType, next.presetSnapshot) * 60;
  const remaining = Math.max(
    0,
    Math.min(total, next.pausedRemainingSeconds ?? total),
  );
  return {
    ...next,
    runtimeMode: 'pomodoro',
    isRunning: true,
    phaseStartedAt: next.phaseStartedAt ?? nowIso,
    phaseEndsAt: localIsoDateTime(
      new Date(input.now.getTime() + remaining * 1000),
    ),
    phaseDurationSeconds: total,
    pausedAt: undefined,
    pausedRemainingSeconds: remaining,
    stopwatchStartedAt: undefined,
  };
}

export function pauseFocusRuntime(
  state: FocusRuntimeState,
  localControllerId: string,
  now: Date,
): FocusRuntimeState {
  if (!state.isRunning) return state;
  assertCompanionFocusControl(state, localControllerId);
  const nowIso = localIsoDateTime(now);
  if (state.runtimeMode === 'stopwatch') {
    return {
      ...state,
      isRunning: false,
      pausedAt: nowIso,
      stopwatchElapsedBeforeCurrentRun: focusElapsedSeconds(state, now),
      stopwatchStartedAt: undefined,
      lastUpdate: nowIso,
    };
  }
  return {
    ...state,
    isRunning: false,
    pausedAt: nowIso,
    pausedRemainingSeconds: focusRemainingSeconds({
      isRunning: state.isRunning,
      totalSeconds: focusTotalSeconds(state),
      now,
      phaseEndsAt: state.phaseEndsAt,
      pausedRemainingSeconds: state.pausedRemainingSeconds,
    }),
    phaseEndsAt: undefined,
    lastUpdate: nowIso,
  };
}

export function focusPhaseIsDue(
  state: FocusRuntimeState,
  now: Date,
): boolean {
  return state.isRunning
    && state.runtimeMode !== 'stopwatch'
    && focusRemainingSeconds({
      isRunning: true,
      totalSeconds: focusTotalSeconds(state),
      now,
      phaseEndsAt: state.phaseEndsAt,
      pausedRemainingSeconds: state.pausedRemainingSeconds,
    }) <= 0;
}

export function advanceFocusPhase(
  state: FocusRuntimeState,
  input: {
    localControllerId: string;
    now: Date;
    skipped?: boolean;
  },
): FocusRuntimeState {
  assertCompanionFocusControl(state, input.localControllerId);
  if (state.runtimeMode === 'stopwatch') return state;

  const total = focusTotalSeconds(state);
  const elapsed = focusElapsedSeconds(state, input.now);
  const focus = isFocusPhase(state.currentType);
  const skipped = input.skipped === true;
  const transition = skipped
    ? {
        nextPhase: (focus ? 'shortBreak' : 'work') as FocusPhase,
        nextDurationMinutes: focus
          ? state.presetSnapshot.shortBreakMinutes
          : state.presetSnapshot.workMinutes,
        completedWorkIntervals: state.completedSessions,
      }
    : completeFocusPhase({
        phase: state.currentType,
        completedWorkIntervals: state.completedSessions,
        preset: state.presetSnapshot,
      });
  const nextSeconds = transition.nextDurationMinutes * 60;
  const phaseKey = [
    state.currentSessionId ?? '',
    state.phaseSequence,
    state.currentType,
    state.phaseStartedAt ?? '',
  ].join(':');

  return {
    ...state,
    isRunning: false,
    currentType: transition.nextPhase,
    completedSessions: transition.completedWorkIntervals,
    actualWorkSeconds: state.actualWorkSeconds
      + (!skipped && focus ? Math.min(total, elapsed) : 0),
    actualBreakSeconds: state.actualBreakSeconds
      + (!skipped && !focus ? Math.min(total, elapsed) : 0),
    phaseSequence: state.phaseSequence + 1,
    lastProcessedPhaseCompletionToken: phaseKey,
    phaseStartedAt: undefined,
    phaseEndsAt: undefined,
    phaseDurationSeconds: nextSeconds,
    pausedAt: undefined,
    pausedRemainingSeconds: nextSeconds,
    showOverrunPrompt: false,
    lastUpdate: localIsoDateTime(input.now),
  };
}

function refSlug(ref: Record<string, unknown> | undefined): string | undefined {
  if (!ref) return undefined;
  const value = ref.object_slug ?? ref.objectSlug ?? ref.link;
  if (value == null) return undefined;
  const text = String(value).replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
  const slash = text.lastIndexOf('/');
  return slash >= 0 ? text.slice(slash + 1) : text;
}

function timeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function finishFocusRuntime(
  state: FocusRuntimeState,
  input: {
    localControllerId: string;
    now: Date;
    disposition: FocusSessionDisposition;
  },
): { state: FocusRuntimeState; evidence?: FocusSessionEvidence } {
  if (state.currentSessionId) {
    assertCompanionFocusControl(state, input.localControllerId);
  }

  const elapsed = focusElapsedSeconds(state, input.now);
  const focus = isFocusPhase(state.currentType);
  const currentWorkSeconds =
    (focus || state.runtimeMode === 'stopwatch') ? elapsed : 0;
  const currentBreakSeconds =
    !focus && state.runtimeMode !== 'stopwatch' ? elapsed : 0;
  const totalWorkSeconds = state.runtimeMode === 'stopwatch'
    ? elapsed
    : state.actualWorkSeconds + currentWorkSeconds;
  const totalBreakSeconds = state.actualBreakSeconds + currentBreakSeconds;
  const worked = Math.floor(totalWorkSeconds / 60);
  const breakMinutes = Math.floor(totalBreakSeconds / 60);
  const shouldSave = input.disposition !== 'discard'
    && (worked > 0 || breakMinutes > 0);

  let evidence: FocusSessionEvidence | undefined;
  if (shouldSave) {
    const sessionStart = state.actualStartedAt
      ? new Date(state.actualStartedAt)
      : new Date(input.now.getTime() - elapsed * 1000);
    const sessionId = state.currentSessionId
      ?? `pomo_${input.now.getTime()}`;
    const linked = refSlug(state.linkedObjectRef) ?? state.currentItemId;
    evidence = {
      id: sessionId,
      time: timeOfDay(sessionStart),
      title: state.currentItemTitle ?? 'Focus Session',
      date: localIsoDateTime(sessionStart),
      occurred_at: localIsoDateTime(sessionStart),
      ...(linked ? { linked_item: linked } : {}),
      ...(state.linkedObjectRef
        ? { linked_object_ref: { ...state.linkedObjectRef } }
        : {}),
      work_duration: state.presetSnapshot.workMinutes,
      short_break_duration: state.presetSnapshot.shortBreakMinutes,
      long_break_duration: state.presetSnapshot.longBreakMinutes,
      long_break_after_blocks: state.presetSnapshot.longBreakEvery,
      blocks: state.completedSessions,
      worked,
      break: breakMinutes,
      runtime_mode: state.runtimeMode,
      ...(state.selectedPresetId
        ? { preset_id: state.selectedPresetId }
        : {}),
      preset_snapshot: focusPresetToFrontmatter(state.presetSnapshot),
      ...(state.actualStartedAt
        ? { actual_started_at: state.actualStartedAt }
        : {}),
      completed_at: localIsoDateTime(input.now),
      current_phase: state.currentType,
      ...(state.phaseStartedAt
        ? { phase_started_at: state.phaseStartedAt }
        : {}),
      ...(state.phaseEndsAt
        ? { phase_ends_at: state.phaseEndsAt }
        : {}),
      metrics_applied: false,
      state: input.disposition === 'savePartial' ? 'partial' : 'completed',
    };
  }

  const idle = createIdleFocusRuntimeState(state.presetSnapshot);
  return {
    state: {
      ...idle,
      selectedPresetId: state.selectedPresetId,
      currentItemId: state.currentItemId,
      currentItemTitle: state.currentItemTitle,
      linkedObjectRef: state.linkedObjectRef,
      lastUpdate: localIsoDateTime(input.now),
    },
    ...(evidence ? { evidence } : {}),
  };
}
