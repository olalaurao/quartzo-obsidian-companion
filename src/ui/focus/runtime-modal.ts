import { App, Modal } from 'obsidian';
import type {
  FocusRuntimeControlCapability,
  FocusRuntimeState,
  FocusSessionDisposition,
} from '../../core/focus-runtime';

export interface FocusRuntimeViewState {
  runtime: FocusRuntimeState;
  capability: FocusRuntimeControlCapability;
  canControl: boolean;
  remainingSeconds: number;
  elapsedSeconds: number;
}

export interface FocusRuntimeUiController {
  getFocusRuntimeViewState(now?: Date): FocusRuntimeViewState;
  startPomodoro(): Promise<void>;
  startStopwatch(): Promise<void>;
  pauseFocus(): Promise<void>;
  resumeFocus(): Promise<void>;
  skipFocusPhase(): Promise<void>;
  finishFocus(disposition: FocusSessionDisposition): Promise<void>;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function phaseLabel(value: string): string {
  switch (value) {
    case 'shortBreak':
      return 'Short break';
    case 'longBreak':
      return 'Long break';
    case 'stopwatch':
      return 'Stopwatch';
    case 'custom':
      return 'Custom focus';
    default:
      return 'Focus';
  }
}

export class FocusRuntimeModal extends Modal {
  private timer: number | null = null;
  private busy = false;

  constructor(
    app: App,
    private readonly controller: FocusRuntimeUiController,
    private readonly onClosed?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  onClose(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
    this.contentEl.empty();
    this.onClosed?.();
  }

  private render(): void {
    const snapshot = this.controller.getFocusRuntimeViewState(new Date());
    const state = snapshot.runtime;
    const active = Boolean(state.currentSessionId);

    this.contentEl.empty();
    this.contentEl.addClass('quartzo-focus-runtime');

    const title = document.createElement('h2');
    title.textContent = state.currentItemTitle?.trim() || 'Focus';
    this.contentEl.appendChild(title);

    const phase = document.createElement('div');
    phase.className = 'quartzo-focus-phase';
    phase.textContent = phaseLabel(state.currentType);
    this.contentEl.appendChild(phase);

    const clock = document.createElement('div');
    clock.className = 'quartzo-focus-clock';
    clock.textContent = state.runtimeMode === 'stopwatch'
      ? formatClock(snapshot.elapsedSeconds)
      : formatClock(snapshot.remainingSeconds);
    this.contentEl.appendChild(clock);

    const status = document.createElement('p');
    status.className = 'quartzo-muted';
    if (!active) {
      status.textContent = 'No active Focus session.';
    } else if (!snapshot.canControl) {
      status.textContent =
        'This Focus session is controlled by another device. You can follow the timer here, but controls are read-only.';
    } else {
      status.textContent = state.isRunning ? 'Running' : 'Paused';
    }
    this.contentEl.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'quartzo-focus-actions';
    this.contentEl.appendChild(actions);

    if (!active) {
      this.addButton(actions, 'Start focus', () => this.controller.startPomodoro());
      this.addButton(actions, 'Start stopwatch', () => this.controller.startStopwatch());
      return;
    }

    if (state.isRunning) {
      this.addButton(actions, 'Pause', () => this.controller.pauseFocus(), !snapshot.canControl);
    } else {
      this.addButton(actions, 'Resume', () => this.controller.resumeFocus(), !snapshot.canControl);
    }

    if (state.runtimeMode !== 'stopwatch') {
      this.addButton(
        actions,
        'Skip phase',
        () => this.controller.skipFocusPhase(),
        !snapshot.canControl,
      );
    }

    this.addButton(
      actions,
      'Finish',
      () => this.controller.finishFocus('finish'),
      !snapshot.canControl,
      true,
    );
    this.addButton(
      actions,
      'Save partial',
      () => this.controller.finishFocus('savePartial'),
      !snapshot.canControl,
    );
    this.addButton(
      actions,
      'Discard',
      () => this.controller.finishFocus('discard'),
      !snapshot.canControl,
    );
  }

  private addButton(
    container: HTMLElement,
    label: string,
    action: () => Promise<void>,
    disabled = false,
    cta = false,
  ): void {
    const button = document.createElement('button');
    button.textContent = label;
    button.disabled = disabled || this.busy;
    if (cta) button.classList.add('mod-cta');
    button.addEventListener('click', () => {
      if (button.disabled) return;
      this.busy = true;
      this.render();
      void action()
        .finally(() => {
          this.busy = false;
          this.render();
        });
    });
    container.appendChild(button);
  }
}
