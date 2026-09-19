export interface OccurrenceActionResult {
  outcome: string;
  recordedAt?: string;
  snoozedUntil?: string;
  dismissedAt?: string;
  processedActionIds?: string[];
}

export interface OccurrenceActionInput {
  action: string;
  occurrenceId: string;
  date: string;
  target?: 'habit_slot' | 'reminder';
  duplicateActionId?: boolean;
  existingProcessedActions?: string[];
  objectPath?: string;
}

export type CanonicalOccurrenceAction =
  | 'done'
  | 'already_did'
  | 'skip'
  | 'clear'
  | 'snooze'
  | 'dismiss';

export type OccurrenceOutcome = 'pending' | 'done' | 'skipped';

export interface OccurrenceResponseState {
  occurrenceId: string;
  sourceId?: string;
  reminderId?: string;
  slotIndex?: number;
  dueAt?: string;
  completedAt?: string;
  skippedAt?: string;
  recordedAt?: string;
  snoozedUntil?: string;
  dismissedAt?: string;
  ignoredCount: number;
  processedActionIds: string[];
  /** Unknown persisted fields are retained for forward-compatible roundtrips. */
  unknownFields?: Record<string, unknown>;
}

export interface OccurrenceActionTarget {
  occurrenceId: string;
  sourceId: string;
  sourceType: string;
  reminderId?: string;
  slotIndex?: number;
  dueAt: string;
}

export interface CanonicalOccurrenceActionResult {
  action: CanonicalOccurrenceAction;
  occurrenceId: string;
  applied: boolean;
  idempotentReplay: boolean;
  responseState: OccurrenceResponseState;
}

export interface OccurrenceResponseStore {
  loadResponses(): Promise<Record<string, OccurrenceResponseState>>;
  replaceResponses(responses: Record<string, OccurrenceResponseState>): Promise<void>;
}

export type OccurrenceDomainCompletion = (
  target: OccurrenceActionTarget,
  completedAt: Date,
  recordedAt: Date,
  actionId: string,
) => Promise<void>;

export type OccurrenceDomainClear = (target: OccurrenceActionTarget) => Promise<void>;

