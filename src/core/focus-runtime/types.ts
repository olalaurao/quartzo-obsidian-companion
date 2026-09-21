export type FocusRuntimeClientKind = 'quartzo' | 'companion';

export type FocusRuntimeControlCapability =
  | 'available'
  | 'controller'
  | 'migrationClaim'
  | 'readOnlyForeign'
  | 'readOnlyLegacy';

export type FocusRuntimeMode = 'pomodoro' | 'stopwatch';

export type FocusPhase =
  | 'work'
  | 'shortBreak'
  | 'longBreak'
  | 'custom'
  | 'stopwatch';

export type FocusSessionDisposition = 'finish' | 'savePartial' | 'discard';

export interface FocusPresetSnapshot {
  presetId?: string;
  name: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
}

export interface FocusRuntimeState {
  isRunning: boolean;
  runtimeMode: FocusRuntimeMode;
  currentType: FocusPhase;
  selectedPresetId?: string;
  presetSnapshot: FocusPresetSnapshot;
  currentItemId?: string;
  currentItemTitle?: string;
  linkedObjectRef?: Record<string, unknown>;
  completedSessions: number;
  currentSessionId?: string;
  focusControllerId?: string;
  plannedPomodoroId?: string;
  sourceEventId?: string;
  plannedWorkIntervals?: number;
  phaseStartedAt?: string;
  phaseEndsAt?: string;
  phaseDurationSeconds?: number;
  pausedAt?: string;
  pausedRemainingSeconds?: number;
  stopwatchStartedAt?: string;
  stopwatchElapsedBeforeCurrentRun: number;
  actualStartedAt?: string;
  actualWorkSeconds: number;
  actualBreakSeconds: number;
  phaseSequence: number;
  lastProcessedPhaseCompletionToken?: string;
  showOverrunPrompt: boolean;
  lastUpdate?: string;
}

export interface FocusPhaseTransition {
  nextPhase: FocusPhase;
  nextDurationMinutes: number;
  completedWorkIntervals: number;
}

export interface FocusEvidenceObject {
  type: string;
  frontmatter: Record<string, unknown>;
}

export interface FocusSessionEvidence {
  id: string;
  time: string;
  title: string;
  date: string;
  occurred_at: string;
  linked_item?: string;
  linked_object_ref?: Record<string, unknown>;
  work_duration: number;
  short_break_duration: number;
  long_break_duration: number;
  long_break_after_blocks: number;
  blocks: number;
  worked: number;
  break: number;
  runtime_mode: FocusRuntimeMode;
  preset_id?: string;
  preset_snapshot: Record<string, unknown>;
  actual_started_at?: string;
  completed_at: string;
  current_phase: FocusPhase;
  phase_started_at?: string;
  phase_ends_at?: string;
  metrics_applied: boolean;
  state: 'completed' | 'partial';
}

export const DEFAULT_FOCUS_PRESET: FocusPresetSnapshot = {
  presetId: 'default-25-5',
  name: '25/5',
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  longBreakEvery: 4,
};
