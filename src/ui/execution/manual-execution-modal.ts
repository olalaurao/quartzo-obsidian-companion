import { Modal, Notice } from 'obsidian';
import type {
  ManualExecutionStep,
  ManualExecutionStepState,
} from '../../core/manual-execution';
import type { IndexedObject } from '../../vault/index/types';

export interface ManualExecutionModalSnapshot {
  plainCompletions: Record<string, boolean>;
  linkedStates: Record<string, ManualExecutionStepState>;
}

export interface ManualExecutionModalFinishResult {
  completed: boolean;
  message: string;
}

export interface ManualExecutionModalOptions {
  source: IndexedObject;
  steps: ManualExecutionStep[];
  startedAt: string;
  scheduledFor: string;
  occurrenceId?: string;
  snapshot: ManualExecutionModalSnapshot;
  onPlainChange(step: ManualExecutionStep, completed: boolean): Promise<void>;
  onLinkedAction(step: ManualExecutionStep): Promise<void>;
  refresh(): Promise<ManualExecutionModalSnapshot>;
  finish(plainCompletions: Readonly<Record<string, boolean>>): Promise<ManualExecutionModalFinishResult>;
}

export class ManualExecutionModal extends Modal {
  private busy = false;
  private plainCompletions: Record<string, boolean>;
  private linkedStates: Record<string, ManualExecutionStepState>;

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly options: ManualExecutionModalOptions,
  ) {
    super(app);
    this.plainCompletions = { ...options.snapshot.plainCompletions };
    this.linkedStates = { ...options.snapshot.linkedStates };
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const heading = document.createElement('h2');
    heading.textContent = String(this.options.source.frontmatter.title ?? this.options.source.id);
    contentEl.appendChild(heading);

    const context = document.createElement('p');
    context.className = 'quartzo-manual-execution-context';
    context.textContent = this.options.source.type === 'routine'
      ? 'Routine execution · progress is scoped to this occurrence.'
      : 'System run · plain checklist progress stays local until Finish.';
    contentEl.appendChild(context);

    const list = document.createElement('div');
    list.className = 'quartzo-manual-execution-steps';

    for (const step of this.options.steps) {
      const row = document.createElement('div');
      row.className = 'quartzo-manual-execution-step';
      const main = document.createElement('div');
      main.className = 'quartzo-manual-execution-step-main';

      if (step.kind === 'plain') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.plainCompletions[step.id] === true;
        checkbox.disabled = this.busy;
        checkbox.setAttribute('aria-label', step.title);
        checkbox.addEventListener('change', () => {
          const completed = checkbox.checked;
          this.plainCompletions[step.id] = completed;
          void this.runBusy(async () => {
            await this.options.onPlainChange(step, completed);
          }, false);
        });
        main.appendChild(checkbox);
      } else {
        const state = this.linkedStates[step.id] ?? { completed: false };
        const status = document.createElement('span');
        status.className = 'quartzo-manual-execution-step-status';
        status.textContent = state.completed ? '✓' : '○';
        status.setAttribute('aria-label', state.completed ? 'Completed' : 'Pending');
        main.appendChild(status);
      }

      const label = document.createElement('span');
      label.textContent = step.title;
      main.appendChild(label);
      if (!step.required) {
        const optional = document.createElement('small');
        optional.textContent = 'Optional';
        main.appendChild(optional);
      }
      row.appendChild(main);

      if (step.kind !== 'plain') {
        const state = this.linkedStates[step.id] ?? { completed: false };
        if (!state.completed) {
          const action = document.createElement('button');
          action.type = 'button';
          action.disabled = this.busy;
          action.textContent = step.kind === 'tracker_entry' ? 'Log' : 'Complete';
          action.addEventListener('click', () => {
            void this.runBusy(async () => {
              await this.options.onLinkedAction(step);
              const snapshot = await this.options.refresh();
              this.plainCompletions = { ...snapshot.plainCompletions };
              this.linkedStates = { ...snapshot.linkedStates };
            });
          });
          row.appendChild(action);
        }
      }
      list.appendChild(row);
    }
    contentEl.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'quartzo-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.disabled = this.busy;
    cancel.addEventListener('click', () => this.close());

    const finish = document.createElement('button');
    finish.type = 'button';
    finish.className = 'mod-cta';
    finish.textContent = this.options.source.type === 'routine' ? 'Complete Routine' : 'Finish';
    finish.disabled = this.busy;
    finish.addEventListener('click', () => {
      void this.runBusy(async () => {
        const result = await this.options.finish(this.plainCompletions);
        new Notice(result.message);
        if (result.completed) this.close();
      });
    });

    actions.append(cancel, finish);
    contentEl.appendChild(actions);
  }

  private async runBusy(operation: () => Promise<void>, rerender = true): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await operation();
    } catch (error) {
      new Notice(`Execution blocked: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      if (rerender) this.render();
      else this.render();
    }
  }
}
