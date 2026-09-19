import type { App } from 'obsidian';
import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import type {
  CanonicalOccurrenceAction,
  CanonicalOccurrenceActionResult,
} from '../../core/occurrence_actions';
import { addLocalDays, localIsoDate, parseLocalIsoDate } from '../../core/local-date';
import type { QuartzoSharedSettings } from '../../core/shared-settings';
import { renderScheduleList, type ScheduleListOptions } from '../daily/schedule-list';
import { projectAdaptivePlanner } from './adaptive-projection';

export type PlannerMode = 'day' | 'week' | 'month';
export type PlannerDayLens = 'timeline' | 'adaptive';

export interface PlannerViewOptions {
  app: App;
  mode: PlannerMode;
  dayLens: PlannerDayLens;
  selectedDate: string;
  now: Date;
  schedule?: NormalizedSchedule;
  schedulesByDate?: Map<string, NormalizedSchedule>;
  sharedSettings?: QuartzoSharedSettings | null;
  titleForItem(item: NormalizedItem): string;
  performOccurrenceAction(
    item: NormalizedItem,
    action: CanonicalOccurrenceAction,
    options?: { completedAt?: Date; snoozeMinutes?: number },
  ): Promise<CanonicalOccurrenceActionResult>;
  canOpenItem?(item: NormalizedItem): boolean;
  onOpenItem?(item: NormalizedItem): void;
  onDayLensChange?(lens: PlannerDayLens): void;
  onSelectDate?(date: string): void;
}

function listOptions(options: PlannerViewOptions): ScheduleListOptions {
  return {
    app: options.app,
    titleForItem: options.titleForItem,
    performOccurrenceAction: options.performOccurrenceAction,
    canOpenItem: options.canOpenItem,
    onOpenItem: options.onOpenItem,
  };
}

function section(
  container: HTMLElement,
  title: string,
  items: NormalizedItem[],
  emptyText: string,
  options: PlannerViewOptions,
): void {
  const root = document.createElement('section');
  root.className = 'quartzo-planner-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  root.appendChild(heading);
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'quartzo-empty-state';
    empty.textContent = emptyText;
    root.appendChild(empty);
  } else {
    renderScheduleList(root, items, listOptions(options));
  }
  container.appendChild(root);
}

function renderDay(container: HTMLElement, options: PlannerViewOptions): void {
  const schedule = options.schedule ?? { kind: 'empty', count: 0, items: [] };
  const lens = document.createElement('div');
  lens.className = 'quartzo-planner-day-lens';
  for (const [value, label] of [['timeline', 'Timeline'], ['adaptive', 'Adaptive']] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (options.dayLens === value) button.classList.add('is-active');
    button.addEventListener('click', () => options.onDayLensChange?.(value));
    lens.appendChild(button);
  }
  container.appendChild(lens);

  if (options.dayLens === 'timeline') {
    section(container, 'Timeline', schedule.items, 'Nothing scheduled for this day.', options);
    return;
  }

  const projection = projectAdaptivePlanner(schedule, options.selectedDate, options.now);
  section(container, 'Now', projection.now.map(entry => entry.item), 'Nothing needs your attention right now.', options);
  section(container, 'Next', projection.next.map(entry => entry.item), 'No next items.', options);
  section(container, 'Fell Behind', projection.fellBehind.map(entry => entry.item), 'Nothing fell behind.', options);
  section(container, 'Later', projection.later.map(entry => entry.item), 'Nothing later today.', options);

  const unavailable = document.createElement('p');
  unavailable.className = 'quartzo-planner-adaptive-note';
  unavailable.textContent = 'Essentials and capacity will appear when the canonical DailyPlanningState contract is available to Companion.';
  container.appendChild(unavailable);
}

function clockMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

interface WeekPosition {
  item: NormalizedItem;
  start: number;
  end: number;
  lane: number;
  laneCount: number;
}

function positionWeekItems(items: NormalizedItem[]): WeekPosition[] {
  const candidates = items
    .filter(item => item.isTimed && !item.isAllDay)
    .map(item => {
      const start = clockMinutes(item.start);
      const endRaw = clockMinutes(item.end);
      if (start == null) return null;
      const end = endRaw != null && endRaw > start ? endRaw : Math.min(1440, start + 15);
      return { item, start, end };
    })
    .filter((value): value is { item: NormalizedItem; start: number; end: number } => value != null)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.item.id.localeCompare(b.item.id));

  const laneEnds: number[] = [];
  const assigned = candidates.map(candidate => {
    let lane = laneEnds.findIndex(end => end <= candidate.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(candidate.end);
    } else {
      laneEnds[lane] = candidate.end;
    }
    return { ...candidate, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return assigned.map(entry => ({ ...entry, laneCount }));
}

function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' })
    .format(parseLocalIsoDate(date));
}

function renderWeek(container: HTMLElement, options: PlannerViewOptions): void {
  const selected = parseLocalIsoDate(options.selectedDate);
  const startOfWeek = options.sharedSettings?.startOfWeek ?? 1;
  const delta = (selected.getDay() - startOfWeek + 7) % 7;
  const start = addLocalDays(selected, -delta);
  const dates = Array.from({ length: 7 }, (_, index) => localIsoDate(addLocalDays(start, index)));
  const schedules = options.schedulesByDate ?? new Map<string, NormalizedSchedule>();

  const allDay = document.createElement('div');
  allDay.className = 'quartzo-planner-week-all-day';
  const allDayLabel = document.createElement('strong');
  allDayLabel.textContent = 'All day';
  allDay.appendChild(allDayLabel);
  for (const date of dates) {
    const day = document.createElement('div');
    day.className = 'quartzo-planner-week-all-day-cell';
    const dayButton = document.createElement('button');
    dayButton.className = 'quartzo-planner-week-day-heading';
    dayButton.textContent = weekdayLabel(date);
    dayButton.addEventListener('click', () => options.onSelectDate?.(date));
    day.appendChild(dayButton);
    const untimed = schedules.get(date)?.items.filter(item => !item.isTimed || item.isAllDay) ?? [];
    for (const item of untimed) {
      const chip = document.createElement('button');
      chip.className = 'quartzo-planner-week-chip';
      if (item.isCompleted) chip.classList.add('is-completed');
      if (item.isSkipped) chip.classList.add('is-skipped');
      chip.textContent = options.titleForItem(item);
      chip.disabled = options.canOpenItem?.(item) === false;
      chip.addEventListener('click', () => options.onOpenItem?.(item));
      day.appendChild(chip);
    }
    allDay.appendChild(day);
  }
  container.appendChild(allDay);

  const grid = document.createElement('div');
  grid.className = 'quartzo-planner-week-grid';
  const hours = document.createElement('div');
  hours.className = 'quartzo-planner-week-hours';
  for (let hour = 0; hour < 24; hour++) {
    const label = document.createElement('span');
    label.textContent = `${String(hour).padStart(2, '0')}:00`;
    label.style.top = `${(hour / 24) * 100}%`;
    hours.appendChild(label);
  }
  grid.appendChild(hours);

  for (const date of dates) {
    const column = document.createElement('div');
    column.className = 'quartzo-planner-week-day';
    column.setAttribute('aria-label', weekdayLabel(date));
    const positions = positionWeekItems(schedules.get(date)?.items ?? []);
    for (const entry of positions) {
      const item = document.createElement('button');
      item.className = 'quartzo-planner-week-item';
      if (entry.item.isCompleted) item.classList.add('is-completed');
      if (entry.item.isSkipped) item.classList.add('is-skipped');
      item.textContent = options.titleForItem(entry.item);
      item.title = `${entry.item.start ?? ''} ${options.titleForItem(entry.item)}`.trim();
      item.style.top = `${(entry.start / 1440) * 100}%`;
      item.style.height = `${Math.max(1.2, ((entry.end - entry.start) / 1440) * 100)}%`;
      item.style.left = `${(entry.lane / entry.laneCount) * 100}%`;
      item.style.width = `${100 / entry.laneCount}%`;
      item.disabled = options.canOpenItem?.(entry.item) === false;
      item.addEventListener('click', () => options.onOpenItem?.(entry.item));
      column.appendChild(item);
    }
    grid.appendChild(column);
  }
  container.appendChild(grid);
}

function renderMonth(container: HTMLElement, options: PlannerViewOptions): void {
  const selected = parseLocalIsoDate(options.selectedDate);
  const year = selected.getFullYear();
  const month = selected.getMonth();
  const first = new Date(year, month, 1);
  const startOfWeek = options.sharedSettings?.startOfWeek ?? 1;
  const leading = (first.getDay() - startOfWeek + 7) % 7;
  const gridStart = addLocalDays(first, -leading);
  const schedules = options.schedulesByDate ?? new Map<string, NormalizedSchedule>();

  const weekdayHeader = document.createElement('div');
  weekdayHeader.className = 'quartzo-planner-month-weekdays';
  for (let i = 0; i < 7; i++) {
    const date = addLocalDays(gridStart, i);
    const label = document.createElement('strong');
    label.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
    weekdayHeader.appendChild(label);
  }
  container.appendChild(weekdayHeader);

  const grid = document.createElement('div');
  grid.className = 'quartzo-planner-month-grid';
  for (let index = 0; index < 42; index++) {
    const dateValue = addLocalDays(gridStart, index);
    const date = localIsoDate(dateValue);
    const schedule = schedules.get(date);
    const cell = document.createElement('button');
    cell.className = 'quartzo-planner-month-cell';
    if (dateValue.getMonth() !== month) cell.classList.add('is-outside-month');
    if (date === options.selectedDate) cell.classList.add('is-selected');
    if (date === localIsoDate(options.now)) cell.classList.add('is-today');

    const number = document.createElement('strong');
    number.textContent = String(dateValue.getDate());
    cell.appendChild(number);

    const items = schedule?.items ?? [];
    if (items.length > 0) {
      const count = document.createElement('span');
      count.className = 'quartzo-planner-month-count';
      const completed = items.filter(item => item.isCompleted || item.isSkipped).length;
      count.textContent = completed > 0
        ? `${items.length} items · ${completed} resolved`
        : `${items.length} items`;
      cell.appendChild(count);
      for (const item of items.slice(0, 3)) {
        const preview = document.createElement('span');
        preview.className = 'quartzo-planner-month-preview';
        preview.textContent = options.titleForItem(item);
        cell.appendChild(preview);
      }
      if (items.length > 3) {
        const more = document.createElement('span');
        more.className = 'quartzo-planner-month-more';
        more.textContent = `+${items.length - 3} more`;
        cell.appendChild(more);
      }
    }

    cell.addEventListener('click', () => options.onSelectDate?.(date));
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}

export function renderPlannerSurface(container: HTMLElement, options: PlannerViewOptions): void {
  if (options.mode === 'day') {
    renderDay(container, options);
    return;
  }
  if (options.mode === 'week') {
    renderWeek(container, options);
    return;
  }
  renderMonth(container, options);
}
