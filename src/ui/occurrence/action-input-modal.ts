import { App, Modal } from 'obsidian';

class DateTimeActionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly resolveValue: (value: Date | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    const title = document.createElement('h2');
    title.textContent = 'Already did';
    this.contentEl.appendChild(title);

    const hint = document.createElement('p');
    hint.textContent = 'Choose when this occurrence actually happened.';
    this.contentEl.appendChild(hint);

    const input = document.createElement('input');
    input.type = 'datetime-local';
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    input.value = local;
    input.className = 'quartzo-input';
    this.contentEl.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'quartzo-modal-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.finish(null));
    const save = document.createElement('button');
    save.textContent = 'Record completion';
    save.className = 'mod-cta';
    save.addEventListener('click', () => {
      const value = new Date(input.value);
      if (Number.isNaN(value.getTime()) || value.getTime() > Date.now()) {
        input.setCustomValidity('Choose a valid time that is not in the future.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');
      this.finish(value);
    });
    actions.append(cancel, save);
    this.contentEl.appendChild(actions);
    input.focus();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveValue(null);
    }
    this.contentEl.empty();
  }

  private finish(value: Date | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveValue(value);
    this.close();
  }
}

class SnoozeActionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly resolveValue: (value: number | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    const title = document.createElement('h2');
    title.textContent = 'Snooze';
    this.contentEl.appendChild(title);

    const hint = document.createElement('p');
    hint.textContent = 'Choose how many minutes to snooze this occurrence.';
    this.contentEl.appendChild(hint);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = 'Minutes';
    input.className = 'quartzo-input';
    this.contentEl.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'quartzo-modal-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.finish(null));
    const save = document.createElement('button');
    save.textContent = 'Snooze';
    save.className = 'mod-cta';
    save.addEventListener('click', () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value <= 0) {
        input.setCustomValidity('Enter a positive whole number of minutes.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');
      this.finish(value);
    });
    actions.append(cancel, save);
    this.contentEl.appendChild(actions);
    input.focus();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveValue(null);
    }
    this.contentEl.empty();
  }

  private finish(value: number | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveValue(value);
    this.close();
  }
}

class RescheduleActionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly initialStart: Date,
    private readonly initialEnd: Date,
    private readonly resolveValue: (value: { start: Date; end: Date } | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    const title = document.createElement('h2');
    title.textContent = 'Reschedule';
    this.contentEl.appendChild(title);

    const hint = document.createElement('p');
    hint.textContent = 'Choose the new start and end for this occurrence.';
    this.contentEl.appendChild(hint);

    const start = document.createElement('input');
    start.type = 'datetime-local';
    start.className = 'quartzo-input';
    start.value = localDateTimeInputValue(this.initialStart);
    this.contentEl.appendChild(start);

    const end = document.createElement('input');
    end.type = 'datetime-local';
    end.className = 'quartzo-input';
    end.value = localDateTimeInputValue(this.initialEnd);
    this.contentEl.appendChild(end);

    const actions = document.createElement('div');
    actions.className = 'quartzo-modal-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.finish(null));
    const save = document.createElement('button');
    save.textContent = 'Reschedule';
    save.className = 'mod-cta';
    save.addEventListener('click', () => {
      const startValue = new Date(start.value);
      const endValue = new Date(end.value);
      if (
        Number.isNaN(startValue.getTime()) ||
        Number.isNaN(endValue.getTime()) ||
        endValue.getTime() <= startValue.getTime()
      ) {
        end.setCustomValidity('End must be after start.');
        end.reportValidity();
        return;
      }
      end.setCustomValidity('');
      this.finish({ start: startValue, end: endValue });
    });
    actions.append(cancel, save);
    this.contentEl.appendChild(actions);
    start.focus();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveValue(null);
    }
    this.contentEl.empty();
  }

  private finish(value: { start: Date; end: Date } | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveValue(value);
    this.close();
  }
}

function localDateTimeInputValue(value: Date): string {
  return [
    value.getFullYear().toString().padStart(4, '0'),
    '-',
    (value.getMonth() + 1).toString().padStart(2, '0'),
    '-',
    value.getDate().toString().padStart(2, '0'),
    'T',
    value.getHours().toString().padStart(2, '0'),
    ':',
    value.getMinutes().toString().padStart(2, '0'),
  ].join('');
}

export function promptAlreadyDid(app: App): Promise<Date | null> {
  return new Promise(resolve => new DateTimeActionModal(app, resolve).open());
}

export function promptSnoozeMinutes(app: App): Promise<number | null> {
  return new Promise(resolve => new SnoozeActionModal(app, resolve).open());
}

export function promptReschedule(
  app: App,
  initialStart: Date,
  initialEnd: Date,
): Promise<{ start: Date; end: Date } | null> {
  return new Promise(resolve =>
    new RescheduleActionModal(app, initialStart, initialEnd, resolve).open()
  );
}
