export type ActionReportStatus = 'success' | 'warning' | 'error' | 'info';

export interface ActionReportAction {
  label: string;
  onClick: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export interface ActionReport {
  kind: string;
  title: string;
  summary: string;
  status: ActionReportStatus;
  attempted?: number;
  applied?: number;
  skipped?: number;
  failed?: number;
  messages?: string[];
  nextAction?: ActionReportAction;
  copyText?: string;
}

export interface ActionReportRenderOptions {
  maxMessages?: number;
  actions?: ActionReportAction[];
  onDismiss?: () => void;
}

export function renderActionReport(
  container: HTMLElement,
  report: ActionReport,
  options: ActionReportRenderOptions = {},
): HTMLElement {
  const maxMessages = options.maxMessages ?? 8;
  const section = container.createEl('section', {
    cls: `quartzo-action-report is-${report.status}`,
  });
  section.setAttribute('role', report.status === 'error' ? 'alert' : 'status');
  section.setAttribute('aria-live', 'polite');
  section.setAttribute('data-report-kind', report.kind);

  const header = section.createEl('div', { cls: 'quartzo-action-report-header' });
  header.createEl('span', {
    cls: `qz-badge ${badgeClass(report.status)}`,
    text: statusLabel(report.status),
  });
  header.createEl('strong', { text: report.title });

  section.createEl('p', {
    cls: 'quartzo-action-report-summary',
    text: report.summary,
  });

  const counts = [
    report.attempted == null ? null : `attempted ${report.attempted}`,
    report.applied == null ? null : `applied ${report.applied}`,
    report.skipped == null ? null : `skipped ${report.skipped}`,
    report.failed == null ? null : `failed ${report.failed}`,
  ].filter((item): item is string => item != null);
  if (counts.length > 0) {
    section.createEl('small', {
      cls: 'qz-text-muted quartzo-action-report-counts',
      text: counts.join(' · '),
    });
  }

  const messages = report.messages ?? [];
  if (messages.length > 0) {
    const details = section.createEl('details', { cls: 'quartzo-action-report-details' });
    details.open = messages.length <= maxMessages;
    details.createEl('summary', {
      text: messages.length > maxMessages
        ? `Show ${messages.length} diagnostic messages`
        : 'Diagnostics',
    });
    const list = details.createEl('ul');
    for (const message of messages.slice(0, maxMessages)) {
      list.createEl('li', { text: message });
    }
    if (messages.length > maxMessages) {
      list.createEl('li', {
        cls: 'qz-text-muted',
        text: `...and ${messages.length - maxMessages} more. Use copy diagnostics for the full report.`,
      });
    }
  }

  const actions = [report.nextAction, ...(options.actions ?? [])]
    .filter((action): action is ActionReportAction => action != null);
  if (report.copyText || actions.length > 0 || options.onDismiss) {
    const actionRow = section.createEl('div', { cls: 'quartzo-action-report-actions' });
    for (const action of actions) {
      const button = actionRow.createEl('button', {
        text: action.label,
        cls: buttonClass(action.variant ?? 'secondary'),
      });
      button.addEventListener('click', () => { void action.onClick(); });
    }
    if (report.copyText) {
      const copy = actionRow.createEl('button', {
        text: 'Copy diagnostics',
        cls: 'qz-btn qz-btn-ghost qz-btn-sm',
      });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(report.copyText ?? '');
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
      });
    }
    if (options.onDismiss) {
      const dismiss = actionRow.createEl('button', {
        text: 'Dismiss',
        cls: 'qz-btn qz-btn-ghost qz-btn-sm',
      });
      dismiss.addEventListener('click', options.onDismiss);
    }
  }

  return section;
}

export function actionReportCopyText(report: ActionReport): string {
  const lines = [
    report.title,
    report.summary,
    report.attempted == null ? null : `Attempted: ${report.attempted}`,
    report.applied == null ? null : `Applied: ${report.applied}`,
    report.skipped == null ? null : `Skipped: ${report.skipped}`,
    report.failed == null ? null : `Failed: ${report.failed}`,
    ...(report.messages ?? []),
  ].filter((line): line is string => line != null && line.length > 0);
  return lines.join('\n');
}

function statusLabel(status: ActionReportStatus): string {
  if (status === 'success') return 'Success';
  if (status === 'warning') return 'Needs review';
  if (status === 'error') return 'Error';
  return 'Info';
}

function badgeClass(status: ActionReportStatus): string {
  if (status === 'success') return 'qz-badge-success';
  if (status === 'warning') return 'qz-badge-warning';
  if (status === 'error') return 'qz-badge-error';
  return 'qz-badge-info';
}

function buttonClass(variant: ActionReportAction['variant']): string {
  if (variant === 'primary') return 'qz-btn qz-btn-primary qz-btn-sm';
  if (variant === 'danger') return 'qz-btn qz-btn-sm mod-warning';
  if (variant === 'ghost') return 'qz-btn qz-btn-ghost qz-btn-sm';
  return 'qz-btn qz-btn-secondary qz-btn-sm';
}
