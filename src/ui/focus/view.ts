import { Notice } from 'obsidian';
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

export interface FocusRuntimeRenderOptions {
  onBack?: () => void | Promise<void>;
  backLabel?: string;
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

function projectionSignature(snapshot: FocusRuntimeViewState): string {
  const runtime = snapshot.runtime;
  return [
    runtime.currentSessionId ?? '',
    runtime.focusControllerId ?? '',
    runtime.runtimeMode,
    runtime.currentType,
    runtime.isRunning ? 'running' : 'paused',
    runtime.phaseSequence,
    runtime.pausedRemainingSeconds ?? '',
    snapshot.capability,
  ].join('|');
}

export function renderFocusRuntime(
  container: HTMLElement,
  controller: FocusRuntimeUiController,
  options: FocusRuntimeRenderOptions = {},
): void {
  container.empty();
  const root = document.createElement('section');
  root.className = 'quartzo-focus-runtime';
  container.appendChild(root);

  let busy = false;
  const initial = controller.getFocusRuntimeViewState(new Date());
  const initialSignature = projectionSignature(initial);

  if (options.onBack) {
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = options.backLabel ?? 'Back';
    back.addEventListener('click', () => {
      void Promise.resolve(options.onBack?.()).catch(error => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    });
    root.appendChild(back);
  }

  const title = document.createElement('h2');
  title.textContent = initial.runtime.currentItemTitle?.trim() || 'Focus';
  root.appendChild(title);

  const phase = document.createElement('div');
  phase.className = 'quartzo-focus-phase';
  phase.textContent = phaseLabel(initial.runtime.currentType);
  root.appendChild(phase);

  const clock = document.createElement('div');
  clock.className = 'quartzo-focus-clock';
  root.appendChild(clock);

  const status = document.createElement('p');
  status.className = 'quartzo-muted';
  root.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'quartzo-focus-actions';
  root.appendChild(actions);

  const updateProjection = (snapshot: FocusRuntimeViewState): void => {
    const runtime = snapshot.runtime;
    clock.textContent = runtime.runtimeMode === 'stopwatch'
      ? formatClock(snapshot.elapsedSeconds)
      : formatClock(snapshot.remainingSeconds);

    if (!runtime.currentSessionId) {
      status.textContent = 'No active Focus session.';
    } else if (!snapshot.canControl) {
      status.textContent =
        'This Focus session is controlled by another device. You can follow the timer here, but controls are read-only.';
    } else {
      status.textContent = runtime.isRunning ? 'Running' : 'Paused';
    }
  };

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    for (const button of Array.from(actions.querySelectorAll('button'))) {
      (button as HTMLButtonElement).disabled = true;
    }
    try {
      await operation();
    } catch (error) {
      new Notice(`Focus blocked: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
      if (root.isConnected) renderFocusRuntime(container, controller, options);
    }
  };

  const addButton = (
    label: string,
    operation: () => Promise<void>,
    disabled = false,
    cta = false,
  ): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled || busy;
    if (cta) button.classList.add('mod-cta');
    button.addEventListener('click', () => { void run(operation); });
    actions.appendChild(button);
  };

  if (!initial.runtime.currentSessionId) {
    addButton('Start focus', () => controller.startPomodoro());
    addButton('Start stopwatch', () => controller.startStopwatch());
  } else {
    if (initial.runtime.isRunning) {
      addButton('Pause', () => controller.pauseFocus(), !initial.canControl);
    } else {
      addButton('Resume', () => controller.resumeFocus(), !initial.canControl);
    }

    if (initial.runtime.runtimeMode !== 'stopwatch') {
      addButton(
        'Skip phase',
        () => controller.skipFocusPhase(),
        !initial.canControl,
      );
    }

    addButton(
      'Finish',
      () => controller.finishFocus('finish'),
      !initial.canControl,
      true,
    );
    addButton(
      'Save partial',
      () => controller.finishFocus('savePartial'),
      !initial.canControl,
    );
    addButton(
      'Discard',
      () => controller.finishFocus('discard'),
      !initial.canControl,
    );
  }

  updateProjection(initial);

  const ticker = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(ticker);
      return;
    }
    const snapshot = controller.getFocusRuntimeViewState(new Date());
    if (projectionSignature(snapshot) !== initialSignature) {
      window.clearInterval(ticker);
      renderFocusRuntime(container, controller, options);
      return;
    }
    updateProjection(snapshot);
  }, 1000);
}
