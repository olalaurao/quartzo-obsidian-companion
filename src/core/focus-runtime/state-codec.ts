import {
  DEFAULT_FOCUS_PRESET,
  type FocusPhase,
  type FocusPresetSnapshot,
  type FocusRuntimeMode,
  type FocusRuntimeState,
} from './types';

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function intValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function modeValue(value: unknown, currentType: unknown): FocusRuntimeMode {
  return value === 'stopwatch' || currentType === 'stopwatch'
    ? 'stopwatch'
    : 'pomodoro';
}

function phaseValue(value: unknown): FocusPhase {
  return ['work', 'shortBreak', 'longBreak', 'custom', 'stopwatch'].includes(String(value))
    ? String(value) as FocusPhase
    : 'work';
}

export function parseFocusPresetSnapshot(value: unknown): FocusPresetSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_FOCUS_PRESET };
  }
  const raw = value as Record<string, unknown>;
  return {
    ...(optionalText(raw.preset_id) ? { presetId: optionalText(raw.preset_id) } : {}),
    name: optionalText(raw.name) ?? DEFAULT_FOCUS_PRESET.name,
    workMinutes: intValue(raw.work_minutes, DEFAULT_FOCUS_PRESET.workMinutes),
    shortBreakMinutes: intValue(raw.short_break_minutes, DEFAULT_FOCUS_PRESET.shortBreakMinutes),
    longBreakMinutes: intValue(raw.long_break_minutes, DEFAULT_FOCUS_PRESET.longBreakMinutes),
    longBreakEvery: Math.max(1, intValue(raw.long_break_every, DEFAULT_FOCUS_PRESET.longBreakEvery)),
  };
}

export function createIdleFocusRuntimeState(
  preset: FocusPresetSnapshot = DEFAULT_FOCUS_PRESET,
): FocusRuntimeState {
  return {
    isRunning: false,
    runtimeMode: 'pomodoro',
    currentType: 'work',
    selectedPresetId: preset.presetId,
    presetSnapshot: { ...preset },
    completedSessions: 0,
    pausedRemainingSeconds: preset.workMinutes * 60,
    stopwatchElapsedBeforeCurrentRun: 0,
    actualWorkSeconds: 0,
    actualBreakSeconds: 0,
    phaseSequence: 0,
    showOverrunPrompt: false,
  };
}

export function parseFocusRuntimeFrontmatter(
  frontmatter: Record<string, unknown>,
): FocusRuntimeState | null {
  if (frontmatter.type !== 'pomodoro_state') return null;
  const preset = parseFocusPresetSnapshot(frontmatter.preset_snapshot);
  const currentType = phaseValue(frontmatter.currentType);
  const state: FocusRuntimeState = {
    isRunning: boolValue(frontmatter.isRunning, false),
    runtimeMode: modeValue(frontmatter.runtimeMode, currentType),
    currentType,
    selectedPresetId: optionalText(frontmatter.selectedPresetId) ?? preset.presetId,
    presetSnapshot: preset,
    currentItemId: optionalText(frontmatter.currentItemId),
    currentItemTitle: optionalText(frontmatter.currentItemTitle),
    linkedObjectRef:
      frontmatter.linkedObjectRef && typeof frontmatter.linkedObjectRef === 'object'
        && !Array.isArray(frontmatter.linkedObjectRef)
        ? { ...(frontmatter.linkedObjectRef as Record<string, unknown>) }
        : undefined,
    completedSessions: Math.max(0, intValue(frontmatter.completedSessions, 0)),
    currentSessionId: optionalText(frontmatter.currentSessionId),
    focusControllerId: optionalText(frontmatter.focusControllerId),
    plannedPomodoroId: optionalText(frontmatter.plannedPomodoroId),
    sourceEventId:
      optionalText(frontmatter.sourceEventId)
      ?? optionalText(frontmatter.plannedPomodoroId),
    plannedWorkIntervals: frontmatter.plannedWorkIntervals == null
      ? undefined
      : Math.max(0, intValue(frontmatter.plannedWorkIntervals, 0)),
    phaseStartedAt: optionalText(frontmatter.phaseStartedAt),
    phaseEndsAt: optionalText(frontmatter.phaseEndsAt),
    phaseDurationSeconds: frontmatter.phaseDurationSeconds == null
      ? undefined
      : Math.max(0, intValue(frontmatter.phaseDurationSeconds, 0)),
    pausedAt: optionalText(frontmatter.pausedAt),
    pausedRemainingSeconds: frontmatter.pausedRemainingSeconds == null
      ? frontmatter.remainingSeconds == null
        ? undefined
        : Math.max(0, intValue(frontmatter.remainingSeconds, 0))
      : Math.max(0, intValue(frontmatter.pausedRemainingSeconds, 0)),
    stopwatchStartedAt: optionalText(frontmatter.stopwatchStartedAt),
    stopwatchElapsedBeforeCurrentRun: Math.max(
      0,
      intValue(
        frontmatter.stopwatchElapsedBeforeCurrentRun,
        intValue(frontmatter.elapsedSeconds, 0),
      ),
    ),
    actualStartedAt: optionalText(frontmatter.actualStartedAt),
    actualWorkSeconds: Math.max(0, intValue(frontmatter.actualWorkSeconds, 0)),
    actualBreakSeconds: Math.max(0, intValue(frontmatter.actualBreakSeconds, 0)),
    phaseSequence: Math.max(0, intValue(frontmatter.phaseSequence, 0)),
    lastProcessedPhaseCompletionToken:
      optionalText(frontmatter.lastProcessedPhaseCompletionToken)
      ?? optionalText(frontmatter.lastCompletedPhaseKey),
    showOverrunPrompt: boolValue(frontmatter.showOverrunPrompt, false),
    lastUpdate: optionalText(frontmatter.lastUpdate),
  };
  return state;
}

export function focusPresetToFrontmatter(
  preset: FocusPresetSnapshot,
): Record<string, unknown> {
  return {
    ...(preset.presetId ? { preset_id: preset.presetId } : {}),
    name: preset.name,
    work_minutes: preset.workMinutes,
    short_break_minutes: preset.shortBreakMinutes,
    long_break_minutes: preset.longBreakMinutes,
    long_break_every: preset.longBreakEvery,
  };
}

export function focusRuntimeToFrontmatter(
  state: FocusRuntimeState,
  existing: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...existing,
    type: 'pomodoro_state',
    isRunning: state.isRunning,
    runtimeMode: state.runtimeMode,
    currentType: state.currentType,
    selectedPresetId: state.selectedPresetId ?? null,
    preset_snapshot: {
      ...(existing.preset_snapshot
        && typeof existing.preset_snapshot === 'object'
        && !Array.isArray(existing.preset_snapshot)
        ? existing.preset_snapshot as Record<string, unknown>
        : {}),
      ...focusPresetToFrontmatter(state.presetSnapshot),
    },
    currentItemId: state.currentItemId ?? null,
    currentItemTitle: state.currentItemTitle ?? null,
    linkedObjectRef: state.linkedObjectRef ?? null,
    completedSessions: state.completedSessions,
    currentSessionId: state.currentSessionId ?? null,
    focusControllerId: state.currentSessionId == null
      ? null
      : state.focusControllerId ?? null,
    plannedPomodoroId: state.plannedPomodoroId ?? null,
    sourceEventId: state.sourceEventId ?? null,
    plannedWorkIntervals: state.plannedWorkIntervals ?? null,
    phaseStartedAt: state.phaseStartedAt ?? null,
    phaseEndsAt: state.phaseEndsAt ?? null,
    phaseDurationSeconds: state.phaseDurationSeconds ?? null,
    pausedAt: state.pausedAt ?? null,
    pausedRemainingSeconds: state.pausedRemainingSeconds ?? null,
    stopwatchStartedAt: state.stopwatchStartedAt ?? null,
    stopwatchElapsedBeforeCurrentRun: state.stopwatchElapsedBeforeCurrentRun,
    actualStartedAt: state.actualStartedAt ?? null,
    actualWorkSeconds: state.actualWorkSeconds,
    actualBreakSeconds: state.actualBreakSeconds,
    phaseSequence: state.phaseSequence,
    lastProcessedPhaseCompletionToken:
      state.lastProcessedPhaseCompletionToken ?? null,
    showOverrunPrompt: state.showOverrunPrompt,
    lastUpdate: state.lastUpdate ?? null,
  };
}
