export type ManualExecutionStepKind =
  | 'plain'
  | 'habit'
  | 'task'
  | 'tracker_entry'
  | 'pomodoro'
  | string;

export interface ChecklistStepData {
  id: string;
  title: string;
  kind: ManualExecutionStepKind;
  linkedObjectSlug?: string;
  trackerFieldId?: string;
  required: boolean;
}

export type ManualExecutionStepCapability =
  | 'supported'
  | 'delegated'
  | 'requiresFocusRuntime'
  | 'unsupported';

export type ManualExecutionRunCapability =
  | 'supported'
  | 'requiresFocusRuntime'
  | 'unsupported';

export interface SystemRunFinalization {
  frontmatter: Record<string, unknown>;
  summaryTask: Record<string, unknown>;
  executionAlreadyRecorded: boolean;
  canonicalFinishedAt: string;
}

export interface RoutineExecutionProjection {
  occurrenceId: string;
  scheduledFor: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  stepCompletions: Record<string, boolean>;
}

export interface RoutineFinalization {
  frontmatter: Record<string, unknown>;
  execution: RoutineExecutionProjection;
  completed: boolean;
}
