import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import {
  OccurrenceActionPolicy,
  companionOccurrenceDomainMode,
  type CanonicalOccurrenceAction,
  type CanonicalOccurrenceActionResult,
} from '../../core/occurrence_actions';
import type { NormalizedItem } from '../../core/daily_schedule/types';
import type { ManualExecutionRunCapability } from '../../core/manual-execution';
import { actionReportCopyText, renderActionReport, type ActionReport } from '../action-report';
import { promptAlreadyDid, promptReschedule, promptSnoozeMinutes } from './action-input-modal';

export interface OccurrenceActionControlsOptions {
  app: App;
  item: NormalizedItem;
  perform(
    action: CanonicalOccurrenceAction,
    options?: { completedAt?: Date; snoozeMinutes?: number },
  ): Promise<CanonicalOccurrenceActionResult>;
  reschedule?(start: Date, end: Date): Promise<void>;
  manualExecutionCapability?: ManualExecutionRunCapability;
  startManualExecution?(): Promise<void>;
  onActionReport?(report: ActionReport | null): void;
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
  const reportHost = document.createElement('div');
  reportHost.className = 'quartzo-occurrence-action-report';

  const setActionReport = (report: ActionReport | null): void => {
    reportHost.empty();
    options.onActionReport?.(report);
    if (!report) return;
    renderActionReport(reportHost, report, {
      maxMessages: 4,
      onDismiss: () => setActionReport(null),
    });
  };

  const blockedReport = (kind: string, title: string, error: unknown): ActionReport => {
    const message = error instanceof Error ? error.message : String(error);
    const report: ActionReport = {
      kind,
      title,
      summary: message,
      status: 'error',
      attempted: 1,
      applied: 0,
      failed: 1,
      messages: [message],
    };
    return { ...report, copyText: actionReportCopyText(report) };
  };

  const disableButtons = (): HTMLButtonElement[] => {
    const buttons = Array.from(actionRow.querySelectorAll('button'));
    for (const button of buttons) button.disabled = true;
    return buttons;
  };

  const enableButtons = (buttons: HTMLButtonElement[]): void => {
    for (const button of buttons) button.disabled = false;
  };

  const runAction = async (
    action: CanonicalOccurrenceAction,
    actionOptions: { completedAt?: Date; snoozeMinutes?: number } = {},
  ): Promise<void> => {
    setActionReport(null);
    const buttons = disableButtons();
    try {
      await options.perform(action, actionOptions);
    } catch (error) {
      enableButtons(buttons);
      setActionReport(blockedReport(
        'occurrence.action_blocked',
        'Occurrence action blocked',
        error,
      ));
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

  if (
    item.outcome === 'pending' &&
    capabilities.canStart &&
    options.manualExecutionCapability === 'supported' &&
    options.startManualExecution
  ) {
    addAction(capabilities.startLabel ?? 'Run', () => {
      void (async () => {
        setActionReport(null);
        const buttons = disableButtons();
        try {
          await options.startManualExecution!();
        } catch (error) {
          enableButtons(buttons);
          setActionReport(blockedReport(
            'occurrence.execution_blocked',
            'Execution blocked',
            error,
          ));
          new Notice(`Execution blocked: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
  }

  if (
    item.outcome === 'pending' &&
    capabilities.canStart &&
    options.manualExecutionCapability === 'requiresFocusRuntime'
  ) {
    const status = document.createElement('small');
    status.className = 'quartzo-occurrence-status';
    status.textContent = 'Requires Focus runtime';
    actionRow.appendChild(status);
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

        setActionReport(null);
        const buttons = disableButtons();
        try {
          await reschedule(next.start, next.end);
        } catch (error) {
          enableButtons(buttons);
          setActionReport(blockedReport(
            'occurrence.reschedule_blocked',
            'Reschedule blocked',
            error,
          ));
          new Notice(`Reschedule blocked: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
  }

  if (actionRow.childElementCount === 0) return null;
  container.appendChild(actionRow);
  container.appendChild(reportHost);
  return actionRow;
}
