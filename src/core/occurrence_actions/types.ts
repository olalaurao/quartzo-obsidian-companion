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
