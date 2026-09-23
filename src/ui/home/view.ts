import type { App } from 'obsidian';
import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import type { OverdueObjectProjection } from '../../core/overdue_projection';
import { parseLocalIsoDate } from '../../core/local-date';
import type { QuartzoSharedSettings } from '../../core/shared-settings';
import type {
  CanonicalOccurrenceAction,
  CanonicalOccurrenceActionResult,
} from '../../core/occurrence_actions';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import type { VaultIndex } from '../../vault/index/types';
import { renderDayDial } from '../day-dial/view';
import { renderScheduleList, type ScheduleListOptions } from '../daily/schedule-list';
import { projectHomeSchedule, type HomeProgress } from './home-projection';
import type { ManualExecutionRunCapability } from '../../core/manual-execution';
import { HOME_QUICK_ACTIONS, type HomeQuickAddType } from './quick-actions';

export interface HomeViewOptions {
  app: App;
  selectedDate: string;
  schedule: NormalizedSchedule;
  overdue?: OverdueObjectProjection[];
  index: VaultIndex | null;
  googleEvents?: GoogleCalendarProjection[];
  sharedSettings?: QuartzoSharedSettings | null;
  now?: Date;
  titleForItem(item: NormalizedItem): string;
  performOccurrenceAction(
    item: NormalizedItem,
    action: CanonicalOccurrenceAction,
    options?: { completedAt?: Date; snoozeMinutes?: number },
  ): Promise<CanonicalOccurrenceActionResult>;
  performOccurrenceReschedule?(item: NormalizedItem, start: Date, end: Date): Promise<void>;
  manualExecutionCapability?(item: NormalizedItem): ManualExecutionRunCapability;
  startManualExecution?(item: NormalizedItem): Promise<void>;
  canOpenItem?(item: NormalizedItem): boolean;
  onOpenItem?(item: NormalizedItem): void;
  iconFactory?: (name: string) => SVGSVGElement | null;
  onOpenOverdue?(projection: OverdueObjectProjection): void;
  onQuickAdd(type: HomeQuickAddType): void;
}

function sectionHeading(container: HTMLElement, text: string): HTMLElement {
  const heading = document.createElement('h3');
  heading.textContent = text;
  container.appendChild(heading);
  return heading;
}

function renderBucket(
  container: HTMLElement,
  title: string,
  items: NormalizedItem[],
  emptyText: string,
  listOptions: ScheduleListOptions,
): void {
  const section = document.createElement('section');
  section.className = 'quartzo-home-section';
  sectionHeading(section, title);
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'quartzo-empty-state';
    empty.textContent = emptyText;
    section.appendChild(empty);
  } else {
    renderScheduleList(section, items, listOptions);
  }
  container.appendChild(section);
}

function renderProgressCard(container: HTMLElement, label: string, progress: HomeProgress): void {
  const card = document.createElement('div');
  card.className = 'quartzo-home-progress-card';
  const title = document.createElement('span');
  title.textContent = label;
  card.appendChild(title);
  const value = document.createElement('strong');
  value.textContent = `${progress.completed} / ${progress.total}`;
  value.setAttribute('aria-label', `${label}: ${progress.completed} of ${progress.total} completed`);
  card.appendChild(value);
  container.appendChild(card);
}

function formatHomeDate(value: string): string {
  const date = parseLocalIsoDate(value);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function renderHomeView(container: HTMLElement, options: HomeViewOptions): void {
  const now = options.now ?? new Date();
  const projection = projectHomeSchedule(options.schedule, options.selectedDate, now, options.overdue ?? []);

  const header = document.createElement('div');
  header.className = 'quartzo-home-heading';
  const title = document.createElement('h2');
  title.textContent = 'Home';
  header.appendChild(title);
  const date = document.createElement('p');
  date.className = 'quartzo-home-date';
  date.textContent = formatHomeDate(options.selectedDate);
  header.appendChild(date);
  container.appendChild(header);

  const listOptions: ScheduleListOptions = {
    app: options.app,
    titleForItem: options.titleForItem,
    performOccurrenceAction: options.performOccurrenceAction,
    performOccurrenceReschedule: options.performOccurrenceReschedule,
    manualExecutionCapability: options.manualExecutionCapability,
    startManualExecution: options.startManualExecution,
    canOpenItem: options.canOpenItem,
    onOpenItem: options.onOpenItem,
  };

  renderDayDial(container, {
    selectedDate: options.selectedDate,
    schedule: options.schedule,
    index: options.index,
    googleEvents: options.googleEvents,
    sharedSettings: options.sharedSettings,
    now,
    canOpenItem: options.canOpenItem,
    onOpenItem: options.onOpenItem,
    iconFactory: options.iconFactory,
  });

  renderBucket(container, 'Now', projection.now, 'Nothing active right now.', listOptions);
  renderBucket(container, 'Up Next', projection.upNext, 'Nothing timed is coming up.', listOptions);

  const progress = document.createElement('section');
  progress.className = 'quartzo-home-section';
  sectionHeading(progress, 'Today');
  const cards = document.createElement('div');
  cards.className = 'quartzo-home-progress';
  renderProgressCard(cards, 'Tasks', projection.taskProgress);
  renderProgressCard(cards, 'Habits', projection.habitProgress);
  progress.appendChild(cards);
  if (projection.today.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'quartzo-empty-state';
    empty.textContent = 'Nothing scheduled today.';
    progress.appendChild(empty);
  } else {
    renderScheduleList(progress, projection.today, listOptions);
  }
  container.appendChild(progress);

  const overdue = document.createElement('section');
  overdue.className = 'quartzo-home-section';
  sectionHeading(overdue, 'Overdue');
  if (projection.overdue.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'quartzo-empty-state';
    empty.textContent = 'Nothing overdue.';
    overdue.appendChild(empty);
  } else {
    for (const item of projection.overdue) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quartzo-home-overdue-item';
      button.textContent = String(item.object.frontmatter.title ?? item.object.id);
      button.addEventListener('click', () => options.onOpenOverdue?.(item));
      overdue.appendChild(button);
    }
  }
  container.appendChild(overdue);

  const quickActions = document.createElement('section');
  quickActions.className = 'quartzo-home-section';
  sectionHeading(quickActions, 'Quick actions');
  const actions = document.createElement('div');
  actions.className = 'quartzo-home-quick-actions';
  for (const { type, label } of HOME_QUICK_ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => options.onQuickAdd(type));
    actions.appendChild(button);
  }
  quickActions.appendChild(actions);
  container.appendChild(quickActions);
}
