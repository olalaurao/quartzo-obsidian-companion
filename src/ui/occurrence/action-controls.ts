import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import {
  OccurrenceActionPolicy,
  companionOccurrenceDomainMode,
  type CanonicalOccurrenceAction,
  type CanonicalOccurrenceActionResult,
} from '../../core/occurrence_actions';
import type { NormalizedItem } from '../../core/daily_schedule/types';
import { promptAlreadyDid, promptReschedule, promptSnoozeMinutes } from './action-input-modal';

export interface OccurrenceActionControlsOptions {
  app: App;
  item: NormalizedItem;
  perform(
    action: CanonicalOccurrenceAction,
    options?: { completedAt?: Date; snoozeMinutes?: number },
  ): Promise<CanonicalOccurrenceActionResult>;
  reschedule?(start: Date, end: Date): Promise<void>;
}

export function renderOccurrenceActionControls(
  container: HTMLElement,
  options: OccurrenceActionControlsOptions,
): HTMLElement | null {
  const { item } = options;
  const capabilities = OccurrenceActionPolicy.resolve({
    sourceType: item.sourceType,
    outcome: item.outcome,
    completable: item.isCompletable,
    playable: item.isPlayable,
    editable: item.editable,
    reminderId: item.reminderId,
    restrictionMetadata: item.restrictionMetadata,
    completed: item.isCompleted,
  });

  const actionRow = document.createElement('span');
  actionRow.className = 'quartzo-occurrence-actions';

  const runAction = async (
    action: CanonicalOccurrenceAction,
    actionOptions: { completedAt?: Date; snoozeMinutes?: number } = {},
  ): Promise<void> => {
    const buttons = Array.from(actionRow.querySelectorAll('button'));
    for (const button of buttons) button.disabled = true;
    try {
      await options.perform(action, actionOptions);
    } catch (error) {
      for (const button of buttons) button.disabled = false;
      new Notice(`Occurrence action blocked: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const addAction = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    actionRow.appendChild(button);
  };

  const domainMode = companionOccurrenceDomainMode(item.sourceType);
  if (item.outcome !== 'pending') {
    const status = document.createElement('small');
    status.className = 'quartzo-occurrence-status';
    status.textContent = capabilities.statusLabel ?? (item.outcome === 'done' ? 'Done' : 'Skipped');
    actionRow.appendChild(status);

    if (
      capabilities.clearOutcomeLabel &&
      (domainMode !== 'unsupported' || item.outcome === 'skipped')
    ) {
      addAction(capabilities.clearOutcomeLabel, () => { void runAction('clear'); });
    }
  } else {
    if (capabilities.canReportDone && domainMode !== 'unsupported') {
      addAction(capabilities.doneLabel ?? 'Done', () => { void runAction('done'); });
    }
    if (capabilities.canAlreadyDid && domainMode !== 'unsupported') {
      addAction('Already did', () => {
        void (async () => {
          const completedAt = await promptAlreadyDid(options.app);
          if (completedAt) await runAction('already_did', { completedAt });
        })();
      });
    }
    if (capabilities.canSkip) {
      addAction(capabilities.skipLabel ?? 'Skip', () => { void runAction('skip'); });
    }
    if (capabilities.canSnooze) {
      addAction('Snooze', () => {
        void (async () => {
          const snoozeMinutes = await promptSnoozeMinutes(options.app);
          if (snoozeMinutes != null) await runAction('snooze', { snoozeMinutes });
        })();
      });
    }
  }

  const reschedule = options.reschedule;
  if (capabilities.canReplan && reschedule) {
    addAction('Reschedule', () => {
      void (async () => {
        const initialStart = new Date(`${item.date}T${item.start ?? '09:00'}:00`);
        const initialEnd = item.end
          ? new Date(`${item.date}T${item.end}:00`)
          : new Date(initialStart.getTime() + 60 * 60_000);
        const next = await promptReschedule(options.app, initialStart, initialEnd);
        if (!next) return;

        const buttons = Array.from(actionRow.querySelectorAll('button'));
        for (const button of buttons) button.disabled = true;
        try {
          await reschedule(next.start, next.end);
        } catch (error) {
          for (const button of buttons) button.disabled = false;
          new Notice(`Reschedule blocked: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
  }

  if (actionRow.childElementCount === 0) return null;
  container.appendChild(actionRow);
  return actionRow;
}
