import type { App } from 'obsidian';
import type { NormalizedItem } from '../../core/daily_schedule/types';
import type {
  CanonicalOccurrenceAction,
  CanonicalOccurrenceActionResult,
} from '../../core/occurrence_actions';
import { renderOccurrenceActionControls } from '../occurrence/action-controls';

export interface ScheduleListOptions {
  app: App;
  titleForItem(item: NormalizedItem): string;
  performOccurrenceAction(
    item: NormalizedItem,
    action: CanonicalOccurrenceAction,
    options?: { completedAt?: Date; snoozeMinutes?: number },
  ): Promise<CanonicalOccurrenceActionResult>;
  performOccurrenceReschedule?(item: NormalizedItem, start: Date, end: Date): Promise<void>;
  canOpenItem?(item: NormalizedItem): boolean;
  onOpenItem?(item: NormalizedItem): void;
}

export function renderScheduleList(
  container: HTMLElement,
  items: NormalizedItem[],
  options: ScheduleListOptions,
): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'quartzo-schedule-list';

  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'quartzo-schedule-row';
    if (item.outcome === 'done') row.classList.add('is-completed');
    if (item.outcome === 'skipped') row.classList.add('is-skipped');

    const label = document.createElement('span');
    label.className = 'quartzo-schedule-label';
    const time = item.start ? `${item.start} · ` : '';
    label.textContent = `${time}${options.titleForItem(item)}`;
    row.appendChild(label);

    if (options.onOpenItem && options.canOpenItem?.(item) !== false) {
      label.classList.add('quartzo-clickable');
      label.setAttribute('role', 'button');
      label.tabIndex = 0;
      const open = () => options.onOpenItem?.(item);
      label.addEventListener('click', open);
      label.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    }

    renderOccurrenceActionControls(row, {
      app: options.app,
      item,
      perform: (action, actionOptions) =>
        options.performOccurrenceAction(item, action, actionOptions),
      reschedule: options.performOccurrenceReschedule
        ? (start, end) => options.performOccurrenceReschedule!(item, start, end)
        : undefined,
    });
    list.appendChild(row);
  }

  container.appendChild(list);
  return list;
}
