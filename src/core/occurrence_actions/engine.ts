import { OccurrenceActionInput, OccurrenceActionResult } from './types';

export class OccurrenceActionsEngine {
  static process(input: OccurrenceActionInput): OccurrenceActionResult {
    const { action, occurrenceId, date, target, duplicateActionId, existingProcessedActions = [] } = input;

    // Check for duplicate action replay (idempotent)
    if (duplicateActionId && existingProcessedActions.includes(`${action}:${occurrenceId}`)) {
      return { outcome: 'idempotent_noop', processedActionIds: existingProcessedActions };
    }

    const processedActionIds = [...existingProcessedActions, `${action}:${occurrenceId}`];

    switch (action) {
      case 'done':
        return {
          outcome: 'completed_once',
          processedActionIds
        };

      case 'already_did':
        return {
          outcome: 'completed_with_recorded_at',
          recordedAt: `${date}T12:00:00.000`,
          processedActionIds
        };

      case 'skip':
        return {
          outcome: 'skipped_once',
          processedActionIds
        };

      case 'clear':
        return {
          outcome: 'outcome_cleared',
          processedActionIds
        };

      case 'snooze':
        return {
          outcome: 'snoozed_until_set',
          snoozedUntil: `${date}T14:00:00.000`,
          processedActionIds
        };

      case 'dismiss':
        return {
          outcome: 'dismissed_once',
          dismissedAt: `${date}T12:00:00.000`,
          processedActionIds
        };

      default:
        return {
          outcome: 'unknown',
          processedActionIds
        };
    }
  }

  static processWithTarget(input: OccurrenceActionInput): OccurrenceActionResult {
    const { action, occurrenceId, target } = input;

    // Handle target-specific identity preservation
    if (target === 'habit_slot') {
      return {
        outcome: 'slot_identity_preserved',
        processedActionIds: [`${action}:${occurrenceId}`]
      };
    }

    if (target === 'reminder') {
      return {
        outcome: 'reminder_identity_preserved',
        processedActionIds: [`${action}:${occurrenceId}`]
      };
    }

    // Fall back to regular processing
    return this.process(input);
  }
}
