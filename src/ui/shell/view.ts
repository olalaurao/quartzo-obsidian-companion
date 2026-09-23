import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import { addLocalDays, localIsoDate, parseLocalIsoDate, shiftLocalMonth } from '../../core/local-date';
import { chooseNewestConflictResolution, type SyncPendingDiagnostic, type SyncProgress, type SyncStatusSnapshot } from '../../sync/coordinator';
import { queryVaultObjects } from '../../core/object-query';
import { renderObjectDetail } from '../detail/object-detail';
import { renderObjectEditor } from '../detail/object-editor';
import { renderHomeView } from '../home/view';
import { renderPlannerSurface, type PlannerDayLens } from '../planner/view';
import { monthGridDates, weekDates } from '../planner/calendar-projection';
import { renderScheduleList as renderDailyScheduleList } from '../daily/schedule-list';
import { projectJournalDay } from '../journal/journal-projection';
import { projectOverdueObjects } from '../../core/overdue_projection';
import {
  SharedSettingsRepository,
} from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import { QuickAddModal } from '../quick-add/modal';
import { renderFocusRuntime } from '../focus/view';
import type { ViewContext } from '../types';
import { buildConflictDiff, formatConflictDiff } from '../sync/conflict-diff';

export const QUARTZO_VIEW_TYPE = 'quartzo-view';
export type QuartzoSection = 'home' | 'planner' | 'journal' | 'browse';
export type QuartzoAction = 'focus' | 'search' | 'add' | 'sync' | 'conflicts' | 'settings';
function isoDate(date: Date): string {
  return localIsoDate(date);
}

function addDays(date: Date, days: number): Date {
  return addLocalDays(date, days);
}

function parseIsoDate(value: string): Date {
  return parseLocalIsoDate(value);
}

function labelForType(type: string): string {
  if (type === 'tracker_record') return 'Record';
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatSyncProgress(progress: SyncProgress | null): string {
  if (!progress) return 'Sync is active. Waiting for the coordinator to report its current phase…';

  const phaseLabels: Record<SyncProgress['phase'], string> = {
    local_inventory: 'Scanning local vault',
    remote_inventory: 'Listing Google Drive vault',
    resolving_paths: 'Resolving Drive paths',
    hashing_remote: 'Hashing remote files',
    processing_changes: 'Processing Drive changes',
    processing_local_changes: 'Processing local changes',
    reconciling: 'Reconciling files',
    finalizing: 'Finalizing sync',
  };
  const now = Date.now();
  const elapsed = formatDurationSeconds((now - progress.startedAt) / 1000);
  const lastActivity = formatDurationSeconds((now - progress.lastActivityAt) / 1000);
  const amount = progress.total > 0
    ? ` · ${progress.completed}/${progress.total} (${Math.min(100, Math.round((progress.completed / progress.total) * 100))}%)`
    : progress.completed > 0
      ? ` · ${progress.completed} processed`
      : '';
  const current = progress.currentPath ? ` · ${progress.currentPath}` : '';
  return `${phaseLabels[progress.phase]}${amount}${current} · elapsed ${elapsed} · last progress update ${lastActivity} ago`;
}

function formatPendingDiagnostic(diagnostic: SyncPendingDiagnostic): string {
  const reasonLabels: Record<SyncPendingDiagnostic['reason'], string> = {
    local_create: 'local create',
    local_modify: 'local modify',
    pending_delete: 'pending delete',
    pending_rename: 'pending rename',
    adoption_required: 'adoption required',
    conflict: 'conflict',
    quarantined_duplicate_identity: 'quarantined duplicate identity',
  };
  const related = diagnostic.relatedPath ? ` (${diagnostic.relatedPath})` : '';
  return `${diagnostic.path}: ${reasonLabels[diagnostic.reason]}${related}`;
}

function formatSyncDiagnosticsText(input: {
  statusLabel: string;
  snapshot: SyncStatusSnapshot;
  syncMode: 'automatic' | 'manual';
  driveVault: string;
  googleAccountStatus: string;
  companionVersion: string;
}): string {
  const lines = [
    'Quartzo Companion sync diagnostics',
    `Status: ${input.statusLabel}`,
    `Last successful sync: ${input.snapshot.lastSuccessfulSyncAt ?? 'Never'}`,
    `Pending local changes: ${input.snapshot.pendingLocalChanges}`,
    `Sync mode: ${input.syncMode === 'automatic' ? 'Automatic' : 'Manual'}`,
    `Current Google Drive vault: ${input.driveVault}`,
    `Google account: ${input.googleAccountStatus}`,
    `Companion version: ${input.companionVersion}`,
    `Conflicts: ${input.snapshot.conflictCount}`,
  ];
  if (input.snapshot.lastError) lines.push(`Last error: ${input.snapshot.lastError}`);
  if (input.snapshot.pendingDiagnostics.length > 0) {
    lines.push('Pending diagnostics:');
    for (const diagnostic of input.snapshot.pendingDiagnostics) {
      lines.push(`- ${formatPendingDiagnostic(diagnostic)}`);
    }
  }
  return lines.join('\n');
}

function scheduleObjects(index: VaultIndex | null): Array<Record<string, unknown>> {
  if (!index) return [];
  return Array.from(index.objects.values()).map(object => ({
    ...object.frontmatter,
    id: object.id,
    type: object.type,
    body: object.body,
    __path: object.path,
  }));
}

export class QuartzoView extends ItemView {
  private section: QuartzoSection = 'home';
  private action: QuartzoAction | null = null;
  private selectedObjectId: string | null = null;
  private editingSelectedObject = false;
  private selectedDate = isoDate(new Date());
  private plannerMode: 'day' | 'week' | 'month' = 'day';
  private plannerDayLens: PlannerDayLens = 'timeline';
  private sharedSettingsRepository: SharedSettingsRepository;
  private syncProgressTickerId: number | null = null;
  private renderGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly context: ViewContext) {
    super(leaf);
    this.sharedSettingsRepository = new SharedSettingsRepository(context.app.vault);
  }

  getViewType(): string { return QUARTZO_VIEW_TYPE; }
  getDisplayText(): string { return 'Quartzo'; }
  getIcon(): string { return 'calendar-clock'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.stopSyncProgressTicker();
  }

  private stopSyncProgressTicker(): void {
    if (this.syncProgressTickerId !== null) {
      window.clearInterval(this.syncProgressTickerId);
      this.syncProgressTickerId = null;
    }
  }

  private startSyncProgressTicker(
    line: HTMLParagraphElement,
    getProgress: () => SyncProgress | null
  ): void {
    this.stopSyncProgressTicker();
    const refresh = () => {
      if (!line.isConnected) {
        this.stopSyncProgressTicker();
        return;
      }
      line.textContent = formatSyncProgress(getProgress());
    };
    refresh();
    this.syncProgressTickerId = window.setInterval(refresh, 1000);
  }

  private isCurrentRender(container: HTMLElement, generation: number): boolean {
    return generation === this.renderGeneration && container.isConnected;
  }

  async setSection(section: QuartzoSection): Promise<void> {
    this.section = section;
    this.action = null;
    this.selectedObjectId = null;
    this.editingSelectedObject = false;
    if (section === 'home') this.selectedDate = isoDate(new Date());
    await this.render();
  }

  async handleAction(action: QuartzoAction): Promise<void> {
    this.selectedObjectId = null;
    this.editingSelectedObject = false;
    if (action === 'add') {
      new QuickAddModal(this.context).open();
      return;
    }
    if (action === 'settings') {
      this.context.plugin.openSettings();
      return;
    }
    this.action = action;
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  async openObjectById(objectId: string): Promise<boolean> {
    if (this.getIndex()?.objects.has(objectId) !== true) return false;
    this.action = null;
    this.selectedObjectId = objectId;
    this.editingSelectedObject = false;
    await this.render();
    return true;
  }


  private getIndex(): VaultIndex | null {
    return this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex() ?? null;
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.stopSyncProgressTicker();
    this.contentEl.empty();
    const shell = document.createElement('div');
    shell.className = 'quartzo-shell';
    this.contentEl.appendChild(shell);

    const header = document.createElement('div');
    header.className = 'quartzo-shell-header';
    const brand = document.createElement('strong');
    brand.textContent = 'Quartzo';
    header.appendChild(brand);

    // Navigation tabs
    const nav = document.createElement('nav');
    nav.className = 'qz-nav-tabs';
    const sectionIcons: Record<QuartzoSection, string> = {
      home: '🏠', planner: '📅', journal: '📓', browse: '🔍',
    };
    for (const section of ['home', 'planner', 'journal', 'browse'] as QuartzoSection[]) {
      const button = document.createElement('button');
      button.className = 'qz-nav-tab';
      button.textContent = `${sectionIcons[section]} ${labelForType(section)}`;
      if (section === this.section) {
        button.classList.add('is-active');
        button.setAttribute('aria-current', 'page');
      }
      button.addEventListener('click', () => { void this.setSection(section); });
      nav.appendChild(button);
    }
    header.appendChild(nav);

    const actions = document.createElement('div');
    actions.className = 'quartzo-shell-actions';

    const focusSnapshot = this.context.plugin.getFocusRuntimeViewState(new Date());
    const focusButton = document.createElement('button');
    focusButton.className = focusSnapshot.runtime.currentSessionId
      ? 'qz-btn qz-btn-secondary'
      : 'qz-btn qz-btn-ghost';
    focusButton.textContent = focusSnapshot.runtime.currentSessionId
      ? focusSnapshot.canControl
        ? '⏱ Focus · Active'
        : '⏱ Focus · Read-only'
      : '⏱ Focus';
    if (this.action === 'focus') {
      focusButton.classList.add('is-active');
      focusButton.setAttribute('aria-pressed', 'true');
    }
    focusButton.addEventListener('click', () => {
      void this.handleAction('focus');
    });
    actions.appendChild(focusButton);

    const actionDefs: Array<[QuartzoAction, string, string]> = [
      ['search', '🔍', 'Search'],
      ['add', '＋', 'Add'],
      ['sync', '☁', 'Sync'],
      ['settings', '⚙', 'Settings'],
    ];
    for (const [action, icon, label] of actionDefs) {
      const button = document.createElement('button');
      button.className = action === 'add' ? 'qz-btn qz-btn-primary qz-btn-sm' : 'qz-btn qz-btn-ghost qz-btn-sm';
      button.textContent = `${icon} ${label}`;
      if (this.action === action) {
        button.classList.add('is-active');
        button.setAttribute('aria-pressed', 'true');
      }
      button.addEventListener('click', () => { void this.handleAction(action); });
      actions.appendChild(button);
    }
    header.appendChild(actions);
    shell.appendChild(header);

    const content = document.createElement('main');
    content.className = 'quartzo-shell-content';
    shell.appendChild(content);

    const sharedSettingsState = this.context.plugin.getSharedSettingsState();
    if (sharedSettingsState === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'qz-empty-state';
      loading.setAttribute('role', 'status');
      loading.setAttribute('aria-live', 'polite');
      const icon = document.createElement('div');
      icon.className = 'qz-empty-state-icon';
      icon.textContent = '⏳';
      const title = document.createElement('div');
      title.className = 'qz-empty-state-title';
      title.textContent = 'Loading Quartzo vault index…';
      loading.appendChild(icon);
      loading.appendChild(title);
      content.appendChild(loading);
      return;
    }
    if (sharedSettingsState === 'missing') {
      const warning = document.createElement('div');
      warning.className = 'quartzo-warning-state';
      warning.setAttribute('role', 'alert');
      const badge = document.createElement('span');
      badge.className = 'qz-badge qz-badge-warning';
      badge.textContent = '⚠ Settings missing';
      warning.appendChild(badge);
      const msg = document.createElement('span');
      msg.textContent = ' Shared Quartzo settings are missing (app/quartzo_shared_settings.md). Explicitly typed objects remain available; Object Identification-dependent files may be unavailable until Quartzo creates the shared settings file.';
      warning.appendChild(msg);
      content.appendChild(warning);
    }

    if (this.selectedObjectId) {
      const object = this.getIndex()?.objects.get(this.selectedObjectId);
      if (object) {
        if (this.editingSelectedObject) {
          renderObjectEditor(content, object, {
            onCancel: () => {
              this.editingSelectedObject = false;
              void this.render();
            },
            onSave: async patch => {
              await this.context.plugin.mutateObject(object, patch);
              this.editingSelectedObject = false;
              await this.render();
            },
          });
        } else {
          renderObjectDetail(content, object, {
            onBack: () => {
              this.selectedObjectId = null;
              this.editingSelectedObject = false;
              void this.render();
            },
            onOpenMarkdown: () => this.openMarkdown(object),
            onEdit: () => {
              this.editingSelectedObject = true;
              void this.render();
            },
          });
        }
        return;
      }
      this.selectedObjectId = null;
      this.editingSelectedObject = false;
    }

    if (this.action === 'focus') {
      renderFocusRuntime(content, this.context.plugin);
      return;
    }
    if (this.action === 'search') {
      this.renderSearch(content);
      return;
    }
    if (this.action === 'sync' || this.action === 'conflicts') {
      await this.renderSync(content, this.action === 'conflicts', generation);
      return;
    }

    if (this.section === 'home') await this.renderHome(content, generation);
    if (this.section === 'planner') await this.renderPlanner(content, generation);
    if (this.section === 'journal') await this.renderJournal(content, generation);
    if (this.section === 'browse') this.renderBrowse(content);
  }

  private buildSchedule(date: string, googleEvents: GoogleCalendarProjection[] = []) {
    return DailyScheduleEngine.normalize({
      date,
      today: isoDate(new Date()),
      objects: scheduleObjects(this.getIndex()),
      googleEvents: googleEvents.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        calendarId: event.calendarId,
        colorHex: event.colorHex,
        htmlLink: event.htmlLink,
      })),
      occurrenceResponses: this.context.plugin.getOccurrenceResponses(),
      occurrenceOverrides: this.context.plugin.getOccurrenceOverrides(),
    });
  }

  private buildOverdue(now: Date = new Date()) {
    return projectOverdueObjects(this.getIndex()?.objects.values() ?? [], now);
  }

  private titleForSource(sourceId: string): string {
    const object = this.getIndex()?.objects.get(sourceId);
    return String(object?.frontmatter.title ?? object?.type ?? sourceId);
  }

  private titleForScheduleItem(item: NormalizedItem, googleEvents: GoogleCalendarProjection[] = []): string {
    if (item.origin === 'externalEvent') {
      return googleEvents.find(event => event.id === item.sourceId)?.summary ?? item.sourceLabel;
    }
    return this.titleForSource(item.sourceId);
  }

  private googleEventForScheduleItem(
    item: NormalizedItem,
    googleEvents: GoogleCalendarProjection[],
  ): GoogleCalendarProjection | null {
    if (item.origin !== 'externalEvent') return null;
    return googleEvents.find(event => event.id === item.sourceId) ?? null;
  }

  private canOpenScheduleItem(item: NormalizedItem, googleEvents: GoogleCalendarProjection[]): boolean {
    const external = this.googleEventForScheduleItem(item, googleEvents);
    if (external) return Boolean(external.htmlLink);
    return this.getIndex()?.objects.has(item.sourceId) === true;
  }

  private openScheduleItem(item: NormalizedItem, googleEvents: GoogleCalendarProjection[]): void {
    const external = this.googleEventForScheduleItem(item, googleEvents);
    if (external) {
      void this.context.plugin.openGoogleCalendarEvent(external).catch(error => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const object = this.getIndex()?.objects.get(item.sourceId);
    if (object) this.openObjectDetail(object);
  }


  private renderScheduleList(container: HTMLElement, items: NormalizedItem[], googleEvents: GoogleCalendarProjection[] = []): void {
    renderDailyScheduleList(container, items, {
      app: this.context.app,
      titleForItem: item => this.titleForScheduleItem(item, googleEvents),
      canOpenItem: item => this.canOpenScheduleItem(item, googleEvents),
      onOpenItem: item => this.openScheduleItem(item, googleEvents),
      performOccurrenceAction: (item, action, options) =>
        this.context.plugin.performOccurrenceAction(item, action, options),
      performOccurrenceReschedule: (item, start, end) =>
        this.context.plugin.performOccurrenceReschedule(item, start, end),
      manualExecutionCapability: item =>
        this.context.plugin.getManualExecutionCapability(item),
      startManualExecution: item =>
        this.context.plugin.startManualExecution(item),
    });
  }

  private async renderHome(container: HTMLElement, generation: number): Promise<void> {
    const selectedDate = this.selectedDate;
    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(selectedDate, 1);
    if (!this.isCurrentRender(container, generation)) return;
    const now = new Date();
    const schedule = this.buildSchedule(selectedDate, googleEvents);
    const sharedSettings = await this.sharedSettingsRepository.load();
    if (!this.isCurrentRender(container, generation)) return;

    renderHomeView(container, {
      app: this.context.app,
      selectedDate,
      schedule,
      overdue: selectedDate === isoDate(now) ? this.buildOverdue(now) : [],
      index: this.getIndex(),
      googleEvents,
      sharedSettings,
      now,
      titleForItem: item => this.titleForScheduleItem(item, googleEvents),
      canOpenItem: item => this.canOpenScheduleItem(item, googleEvents),
      onOpenItem: item => this.openScheduleItem(item, googleEvents),
      onOpenOverdue: projection => this.openObjectDetail(projection.object),
      performOccurrenceAction: (item, action, options) =>
        this.context.plugin.performOccurrenceAction(item, action, options),
      performOccurrenceReschedule: (item, start, end) =>
        this.context.plugin.performOccurrenceReschedule(item, start, end),
      manualExecutionCapability: item =>
        this.context.plugin.getManualExecutionCapability(item),
      startManualExecution: item =>
        this.context.plugin.startManualExecution(item),
      onQuickAdd: type => new QuickAddModal(this.context, type).open(),
    });
  }

  private async renderPlanner(container: HTMLElement, generation: number): Promise<void> {
    const selectedDate = this.selectedDate;
    const plannerMode = this.plannerMode;
    const plannerDayLens = this.plannerDayLens;
    const title = document.createElement('h2');
    title.textContent = 'Planner';
    container.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'quartzo-planner-controls';
    const previous = document.createElement('button');
    previous.textContent = '‹';
    previous.setAttribute('aria-label', `Previous ${plannerMode}`);
    previous.title = `Previous ${plannerMode}`;
    previous.addEventListener('click', () => {
      if (this.plannerMode === 'month') {
        this.selectedDate = shiftLocalMonth(this.selectedDate, -1);
      } else {
        const step = this.plannerMode === 'week' ? -7 : -1;
        this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));
      }
      void this.render();
    });
    controls.appendChild(previous);

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.setAttribute('aria-label', 'Planner date');
    dateInput.value = selectedDate;
    dateInput.addEventListener('change', () => {
      this.selectedDate = dateInput.value || isoDate(new Date());
      void this.render();
    });
    controls.appendChild(dateInput);

    const next = document.createElement('button');
    next.textContent = '›';
    next.setAttribute('aria-label', `Next ${plannerMode}`);
    next.title = `Next ${plannerMode}`;
    next.addEventListener('click', () => {
      if (this.plannerMode === 'month') {
        this.selectedDate = shiftLocalMonth(this.selectedDate, 1);
      } else {
        const step = this.plannerMode === 'week' ? 7 : 1;
        this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));
      }
      void this.render();
    });
    controls.appendChild(next);

    for (const mode of ['day', 'week', 'month'] as const) {
      const button = document.createElement('button');
      button.textContent = labelForType(mode);
      if (mode === plannerMode) {
        button.classList.add('is-active');
        button.setAttribute('aria-pressed', 'true');
      }
      button.addEventListener('click', () => {
        this.plannerMode = mode;
        void this.render();
      });
      controls.appendChild(button);
    }
    container.appendChild(controls);

    const settings = await this.sharedSettingsRepository.load();
    if (!this.isCurrentRender(container, generation)) return;
    let googleEvents: GoogleCalendarProjection[] = [];
    let schedule = this.buildSchedule(selectedDate);
    const schedulesByDate = new Map<string, NormalizedSchedule>();

    if (plannerMode === 'day') {
      googleEvents = await this.context.plugin.listGoogleCalendarEvents(selectedDate, 1);
      if (!this.isCurrentRender(container, generation)) return;
      schedule = this.buildSchedule(selectedDate, googleEvents);
    } else if (plannerMode === 'week') {
      const dates = weekDates(selectedDate, settings?.startOfWeek ?? 1);
      const start = dates[0] ?? selectedDate;
      googleEvents = await this.context.plugin.listGoogleCalendarEvents(start, dates.length);
      if (!this.isCurrentRender(container, generation)) return;
      for (const date of dates) {
        schedulesByDate.set(date, this.buildSchedule(date, googleEvents));
      }
    } else {
      const dates = monthGridDates(selectedDate, settings?.startOfWeek ?? 1);
      const start = dates[0] ?? selectedDate;
      googleEvents = await this.context.plugin.listGoogleCalendarEvents(start, dates.length);
      if (!this.isCurrentRender(container, generation)) return;
      for (const date of dates) {
        schedulesByDate.set(date, this.buildSchedule(date, googleEvents));
      }
    }

    renderPlannerSurface(container, {
      app: this.context.app,
      mode: plannerMode,
      dayLens: plannerDayLens,
      selectedDate,
      now: new Date(),
      schedule,
      schedulesByDate,
      dailyPlanningState: this.context.plugin.getDailyPlanningState(selectedDate),
      sharedSettings: settings,
      titleForItem: item => this.titleForScheduleItem(item, googleEvents),
      canOpenItem: item => this.canOpenScheduleItem(item, googleEvents),
      onOpenItem: item => this.openScheduleItem(item, googleEvents),
      performOccurrenceAction: (item, action, options) =>
        this.context.plugin.performOccurrenceAction(item, action, options),
      performOccurrenceReschedule: (item, start, end) =>
        this.context.plugin.performOccurrenceReschedule(item, start, end),
      manualExecutionCapability: item =>
        this.context.plugin.getManualExecutionCapability(item),
      startManualExecution: item =>
        this.context.plugin.startManualExecution(item),
      onDayLensChange: lens => {
        this.plannerDayLens = lens;
        void this.render();
      },
      onSelectDate: date => {
        this.selectedDate = date;
        this.plannerMode = 'day';
        void this.render();
      },
    });
  }

  private async renderJournal(container: HTMLElement, generation: number): Promise<void> {
    const selectedDate = this.selectedDate;
    const title = document.createElement('h2');
    title.textContent = 'Journal';
    container.appendChild(title);

    const navigation = document.createElement('div');
    navigation.className = 'quartzo-journal-navigation';
    const previous = document.createElement('button');
    previous.textContent = '‹';
    previous.setAttribute('aria-label', 'Previous journal day');
    previous.title = 'Previous journal day';
    previous.addEventListener('click', () => {
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), -1));
      void this.render();
    });
    navigation.appendChild(previous);

    const date = document.createElement('input');
    date.type = 'date';
    date.setAttribute('aria-label', 'Journal date');
    date.value = selectedDate;
    date.addEventListener('change', () => {
      this.selectedDate = date.value || isoDate(new Date());
      void this.render();
    });
    navigation.appendChild(date);

    const today = document.createElement('button');
    today.textContent = 'Today';
    today.addEventListener('click', () => {
      this.selectedDate = isoDate(new Date());
      void this.render();
    });
    navigation.appendChild(today);

    const next = document.createElement('button');
    next.textContent = '›';
    next.setAttribute('aria-label', 'Next journal day');
    next.title = 'Next journal day';
    next.addEventListener('click', () => {
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), 1));
      void this.render();
    });
    navigation.appendChild(next);
    container.appendChild(navigation);

    const quickActions = document.createElement('div');
    quickActions.className = 'quartzo-journal-actions';
    const addEntry = document.createElement('button');
    addEntry.textContent = '+ Entry';
    addEntry.addEventListener('click', () => new QuickAddModal(this.context, 'entry').open());
    quickActions.appendChild(addEntry);
    const addRecord = document.createElement('button');
    addRecord.textContent = '+ Record';
    addRecord.addEventListener('click', () => new QuickAddModal(this.context, 'tracker_record').open());
    quickActions.appendChild(addRecord);
    container.appendChild(quickActions);

    const now = new Date();
    const projection = projectJournalDay(
      this.getIndex(),
      selectedDate,
      selectedDate === isoDate(now) ? this.buildOverdue(now) : [],
    );

    const dailySection = document.createElement('section');
    const dailyHeading = document.createElement('h3');
    dailyHeading.textContent = 'Daily Note';
    dailySection.appendChild(dailyHeading);
    if (projection.dailyNotes.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No Daily Note exists for this date.';
      dailySection.appendChild(empty);
    } else {
      for (const note of projection.dailyNotes) {
        const row = document.createElement('div');
        row.className = 'quartzo-journal-daily-note';
        const label = document.createElement('span');
        label.textContent = String(note.frontmatter.title ?? note.path);
        row.appendChild(label);
        const open = document.createElement('button');
        open.textContent = 'Open Markdown';
        open.addEventListener('click', () => this.openMarkdown(note));
        row.appendChild(open);
        dailySection.appendChild(row);
      }
      const rawHint = document.createElement('small');
      rawHint.textContent = 'Daily Note stays raw/read-only in Companion V1.';
      dailySection.appendChild(rawHint);
    }
    container.appendChild(dailySection);

    const entriesSection = document.createElement('section');
    const entriesHeading = document.createElement('h3');
    entriesHeading.textContent = 'Entries';
    entriesSection.appendChild(entriesHeading);
    if (projection.entries.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No Journal Entries for this date.';
      entriesSection.appendChild(empty);
    } else {
      for (const entry of projection.entries) {
        const row = document.createElement('div');
        row.className = 'quartzo-journal-entry-row';
        this.renderObjectRow(row, entry);
        if (!this.context.plugin.settings.hideSensitivePreviews && !this.context.plugin.settings.hideJournalPreviewText) {
          const previewText = entry.body.trim().replace(/\s+/g, ' ').slice(0, 180);
          if (previewText) {
            const preview = document.createElement('p');
            preview.className = 'quartzo-journal-entry-preview';
            preview.textContent = previewText;
            row.appendChild(preview);
          }
        }
        entriesSection.appendChild(row);
      }
    }
    container.appendChild(entriesSection);

    const recordsSection = document.createElement('section');
    const recordsHeading = document.createElement('h3');
    recordsHeading.textContent = 'Tracking Records';
    recordsSection.appendChild(recordsHeading);
    if (projection.trackingRecords.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No Tracking Records for this date.';
      recordsSection.appendChild(empty);
    } else {
      for (const record of projection.trackingRecords) this.renderObjectRow(recordsSection, record);
    }
    container.appendChild(recordsSection);

    if (projection.moodEntryCount > 0) {
      const moods = document.createElement('section');
      const moodsHeading = document.createElement('h3');
      moodsHeading.textContent = 'Mood';
      moods.appendChild(moodsHeading);
      const summary = document.createElement('p');
      summary.textContent = String(projection.moodEntryCount) + ' mood ' + (projection.moodEntryCount === 1 ? 'entry' : 'entries') + ' stored in the Daily Note.';
      moods.appendChild(summary);
      container.appendChild(moods);
    }

    const overdue = document.createElement('section');
    const overdueHeading = document.createElement('h3');
    overdueHeading.textContent = 'Overdue';
    overdue.appendChild(overdueHeading);
    if (projection.overdue.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing overdue for today.';
      overdue.appendChild(empty);
    } else {
      for (const item of projection.overdue) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'quartzo-journal-overdue-row';
        row.textContent = String(item.object.frontmatter.title ?? item.object.id);
        row.addEventListener('click', () => this.openObjectDetail(item.object));
        overdue.appendChild(row);
      }
    }
    container.appendChild(overdue);

    const timeline = document.createElement('section');
    const timelineHeading = document.createElement('h3');
    timelineHeading.textContent = 'Timeline';
    timeline.appendChild(timelineHeading);
    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(selectedDate, 1);
    if (!this.isCurrentRender(container, generation)) return;
    const schedule = this.buildSchedule(selectedDate, googleEvents);
    if (schedule.items.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing on the canonical Daily Schedule for this date.';
      timeline.appendChild(empty);
    } else {
      this.renderScheduleList(timeline, schedule.items, googleEvents);
    }
    container.appendChild(timeline);
  }
  private renderBrowse(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Browse';
    container.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'quartzo-browse-controls';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Filter Quartzo objects';
    input.setAttribute('aria-label', 'Filter Quartzo objects');
    input.className = 'quartzo-input';
    controls.appendChild(input);

    const filter = document.createElement('select');
    filter.className = 'quartzo-input';
    filter.setAttribute('aria-label', 'Filter by object type');
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All types';
    filter.appendChild(all);
    const available = queryVaultObjects(this.getIndex());
    for (const type of [...new Set(available.map(object => object.type))].sort()) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = labelForType(type);
      filter.appendChild(option);
    }
    controls.appendChild(filter);
    container.appendChild(controls);

    const list = document.createElement('div');
    list.className = 'quartzo-object-results';
    container.appendChild(list);

    const render = () => {
      list.replaceChildren();
      const visible = queryVaultObjects(this.getIndex(), {
        query: input.value,
        types: filter.value ? [filter.value] : undefined,
      });
      if (visible.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'quartzo-empty-state';
        empty.textContent = input.value.trim() || filter.value
          ? 'No matching Quartzo objects.'
          : 'No Quartzo objects yet.';
        list.appendChild(empty);
        return;
      }
      for (const object of visible) this.renderObjectRow(list, object);
    };
    filter.addEventListener('change', render);
    input.addEventListener('input', render);
    render();
  }

  private renderSearch(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Search';
    container.appendChild(title);
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search Quartzo objects';
    input.setAttribute('aria-label', 'Search Quartzo objects');
    input.className = 'quartzo-input';
    container.appendChild(input);
    const results = document.createElement('div');
    results.className = 'quartzo-object-results';
    container.appendChild(results);
    const renderResults = () => {
      results.replaceChildren();
      const query = input.value.trim();
      if (!query) {
        const hint = document.createElement('p');
        hint.className = 'quartzo-empty-state';
        hint.textContent = 'Search by title, ID, type, body or object metadata.';
        results.appendChild(hint);
        return;
      }
      const matches = queryVaultObjects(this.getIndex(), { query });
      if (matches.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'quartzo-empty-state';
        empty.textContent = 'No matching Quartzo objects.';
        results.appendChild(empty);
        return;
      }
      for (const object of matches) this.renderObjectRow(results, object);
    };
    input.addEventListener('input', renderResults);
    renderResults();
    input.focus();
  }

  private async renderSync(container: HTMLElement, conflictsOnly: boolean, generation: number): Promise<void> {
    const headerRow = document.createElement('div');
    headerRow.className = 'qz-section-header';
    const headerIcon = document.createElement('span');
    headerIcon.className = 'qz-section-header-icon';
    headerIcon.textContent = conflictsOnly ? '⚡' : '☁';
    const headerTitle = document.createElement('span');
    headerTitle.className = 'qz-section-header-title';
    headerTitle.textContent = conflictsOnly ? 'Conflicts' : 'Sync Center';
    headerRow.appendChild(headerIcon);
    headerRow.appendChild(headerTitle);
    container.appendChild(headerRow);

    const plugin = this.context.plugin;
    const coordinator = plugin.driveSyncCoordinator;
    const snapshot = coordinator ? await coordinator.getSyncStatusSnapshot() : null;
    if (!this.isCurrentRender(container, generation)) return;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const requiresAuth = plugin.authState === 'disconnected' || plugin.authState === 'authentication_required';
    const statusLabel = requiresAuth
      ? 'Authentication required'
      : offline
        ? 'Offline'
        : snapshot == null
          ? 'Error'
          : ({
              synced: 'Synced',
              local_changes: 'Local changes',
              syncing: 'Syncing…',
              conflict: 'Conflict',
              error: 'Error',
            } as const)[snapshot.status];
    const statusBadgeClass = requiresAuth || snapshot?.status === 'error'
      ? 'qz-badge qz-badge-error'
      : offline
        ? 'qz-badge qz-badge-warning'
        : snapshot?.status === 'synced'
          ? 'qz-badge qz-badge-success'
          : snapshot?.status === 'syncing'
            ? 'qz-badge qz-badge-info'
            : snapshot?.status === 'conflict'
              ? 'qz-badge qz-badge-warning'
              : 'qz-badge qz-badge-neutral';

    const summary = document.createElement('section');
    summary.className = 'quartzo-sync-summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');

    // Status row with badge
    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;';
    const statusBadge = document.createElement('span');
    statusBadge.className = statusBadgeClass;
    statusBadge.textContent = statusLabel;
    statusRow.appendChild(statusBadge);
    const conflictCount = snapshot?.conflictCount ?? coordinator?.getConflicts().length ?? 0;
    if (conflictCount > 0) {
      const conflictBadge = document.createElement('span');
      conflictBadge.className = 'qz-badge qz-badge-warning';
      conflictBadge.textContent = `⚡ ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}`;
      statusRow.appendChild(conflictBadge);
    }
    const pendingCount = snapshot?.pendingLocalChanges ?? 0;
    if (pendingCount > 0) {
      const pendingBadge = document.createElement('span');
      pendingBadge.className = 'qz-badge qz-badge-neutral';
      pendingBadge.textContent = `${pendingCount} pending`;
      statusRow.appendChild(pendingBadge);
    }
    summary.appendChild(statusRow);

    // Info grid
    const infoGrid = document.createElement('dl');
    infoGrid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:var(--qz-font-xs);margin-bottom:8px;';
    const infoRows: Array<[string, string]> = [
      ['Last sync', snapshot?.lastSuccessfulSyncAt ? new Date(snapshot.lastSuccessfulSyncAt).toLocaleString() : 'Never'],
      ['Sync mode', `Sync mode: ${plugin.settings.syncMode === 'automatic' ? 'Automatic' : 'Manual'}`],
      ['Drive vault', plugin.settings.googleDriveFolderName ?? 'Not paired'],
      ['Account', plugin.authState.replace(/_/g, ' ')],
      ['Version', plugin.manifest.version],
    ];
    for (const [k, v] of infoRows) {
      const dt = document.createElement('dt');
      dt.style.cssText = 'color:var(--qz-text-secondary);font-weight:600;';
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.style.cssText = 'margin:0;overflow-wrap:anywhere;';
      // For the sync mode row, strip the redundant label prefix so only the value shows
      dd.textContent = k === 'Sync mode' ? v.replace('Sync mode: ', '') : v;
      infoGrid.appendChild(dt);
      infoGrid.appendChild(dd);
    }
    summary.appendChild(infoGrid);

    if (snapshot?.lastError) {
      const lastError = document.createElement('div');
      lastError.className = 'quartzo-warning-state';
      lastError.setAttribute('role', 'alert');
      const errBadge = document.createElement('span');
      errBadge.className = 'qz-badge qz-badge-error';
      errBadge.textContent = 'Error';
      lastError.appendChild(errBadge);
      const errMsg = document.createElement('span');
      errMsg.textContent = ` ${snapshot.lastError}`;
      lastError.appendChild(errMsg);
      summary.appendChild(lastError);
    }

    if (snapshot && snapshot.pendingDiagnostics.length > 0) {
      const pendingHeader = document.createElement('div');
      pendingHeader.className = 'qz-section-header';
      pendingHeader.style.marginTop = '12px';
      const ph_icon = document.createElement('span');
      ph_icon.className = 'qz-section-header-icon';
      ph_icon.textContent = '📋';
      const ph_title = document.createElement('span');
      ph_title.className = 'qz-section-header-title';
      ph_title.textContent = `Pending (${snapshot.pendingDiagnostics.length})`;
      pendingHeader.appendChild(ph_icon);
      pendingHeader.appendChild(ph_title);
      summary.appendChild(pendingHeader);

      const reasonBadgeClass: Record<SyncPendingDiagnostic['reason'], string> = {
        local_create: 'qz-badge qz-badge-info',
        local_modify: 'qz-badge qz-badge-info',
        pending_delete: 'qz-badge qz-badge-error',
        pending_rename: 'qz-badge qz-badge-neutral',
        adoption_required: 'qz-badge qz-badge-warning',
        conflict: 'qz-badge qz-badge-warning',
        quarantined_duplicate_identity: 'qz-badge qz-badge-error',
      };
      const pendingList = document.createElement('div');
      pendingList.className = 'quartzo-sync-pending-diagnostics';
      for (const diagnostic of snapshot.pendingDiagnostics) {
        const row = document.createElement('div');
        row.className = 'qz-diagnostic-row';
        const badge = document.createElement('span');
        badge.className = reasonBadgeClass[diagnostic.reason];
        badge.textContent = diagnostic.reason.replace(/_/g, ' ');
        const pathSpan = document.createElement('span');
        pathSpan.textContent = formatPendingDiagnostic(diagnostic).split(': ').slice(1).join(': ') || diagnostic.path;
        row.appendChild(badge);
        row.appendChild(pathSpan);
        pendingList.appendChild(row);
      }
      summary.appendChild(pendingList);
    }

    if (snapshot) {
      const copyDiagnostics = document.createElement('button');
      copyDiagnostics.className = 'qz-btn qz-btn-ghost qz-btn-sm';
      copyDiagnostics.style.marginTop = '8px';
      copyDiagnostics.textContent = '📋 Copy diagnostics';
      copyDiagnostics.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(formatSyncDiagnosticsText({
            statusLabel,
            snapshot,
            syncMode: plugin.settings.syncMode,
            driveVault: plugin.settings.googleDriveFolderName ?? 'Not paired',
            googleAccountStatus: plugin.authState.replace(/_/g, ' '),
            companionVersion: plugin.manifest.version,
          }));
          new Notice('Sync diagnostics copied.');
        } catch (error) {
          new Notice(`Could not copy sync diagnostics: ${error}`);
        }
      });
      summary.appendChild(copyDiagnostics);
    }

    let syncProgressLine: HTMLParagraphElement | null = null;
    const ensureSyncProgressLine = (): HTMLParagraphElement => {
      if (!syncProgressLine) {
        syncProgressLine = document.createElement('p');
        syncProgressLine.className = 'quartzo-sync-progress';
        syncProgressLine.style.cssText = 'font-weight: 600; word-break: break-word;';
        syncProgressLine.setAttribute('role', 'status');
        syncProgressLine.setAttribute('aria-live', 'polite');
        summary.appendChild(syncProgressLine);
      }
      return syncProgressLine;
    };
    if (snapshot?.status === 'syncing' && coordinator) {
      const progressLine = ensureSyncProgressLine();
      this.startSyncProgressTicker(progressLine, () => coordinator.getSyncProgress());
    }
    container.appendChild(summary);

    if (requiresAuth) {
      const connect = document.createElement('button');
      const canReconnect = Boolean(plugin.settings.googleDriveFolderId);
      connect.className = 'qz-btn qz-btn-primary';
      connect.textContent = canReconnect ? '🔗 Reconnect Google' : '🔗 Connect Google Drive';
      connect.disabled = offline;
      if (offline) connect.title = 'Google Drive connection requires network access.';
      connect.addEventListener('click', async () => {
        if (canReconnect) await plugin.reconnectGoogle();
        else await plugin.startPairingFlow();
        await this.render();
      });
      container.appendChild(connect);
      return;
    }

    if (plugin.authState === 'authenticated_unpaired') {
      if (coordinator?.isPairingApplyInProgress()) {
        const progress = coordinator.getPairingApplyProgress();
        const active = document.createElement('p');
        active.textContent = 'Pairing is in progress. Keep Obsidian open.';
        container.appendChild(active);

        const detail = document.createElement('p');
        if (!progress) {
          detail.textContent = 'Preparing pairing…';
        } else if (progress.phase === 'revalidating_remote') {
          detail.textContent = 'Revalidating Google Drive vault…';
        } else if (progress.phase === 'baselining') {
          detail.textContent = progress.total > 0
            ? `Establishing baselines ${progress.completed}/${progress.total}`
            : 'Establishing baselines…';
        } else if (progress.phase === 'adopting_local') {
          detail.textContent = progress.total > 0
            ? `Uploading local-only files ${progress.completed}/${progress.total}`
            : 'Checking local-only files…';
        } else if (progress.phase === 'pulling_remote') {
          detail.textContent = progress.total > 0
            ? `Downloading remote-only files ${progress.completed}/${progress.total}`
            : 'Checking remote-only files…';
        } else {
          detail.textContent = 'Finalizing pairing…';
        }
        if (progress?.currentPath) detail.textContent += ` · ${progress.currentPath}`;
        container.appendChild(detail);

        const blocked = document.createElement('button');
        blocked.textContent = 'Pairing in progress…';
        blocked.disabled = true;
        blocked.title = 'Pairing is already running. Keep Obsidian open until it completes.';
        container.appendChild(blocked);
        return;
      }

      const lastPairingError = coordinator?.getPairingLastError() ?? null;
      if (lastPairingError) {
        const failed = document.createElement('p');
        failed.textContent = `Last pairing attempt failed: ${lastPairingError}`;
        failed.style.cssText = 'word-break: break-word;';
        container.appendChild(failed);

        const copyError = document.createElement('button');
        copyError.textContent = 'Copy last pairing error';
        copyError.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(lastPairingError);
            new Notice('Pairing error copied.');
          } catch (error) {
            new Notice(`Could not copy pairing error: ${error}`);
          }
        });
        container.appendChild(copyError);
      }

      const candidates = await plugin.driveAdapter?.listQuartzoVaultCandidates() ?? [];
      if (candidates.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No existing Quartzo vault was found.';
        container.appendChild(empty);

        const retry = document.createElement('button');
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => { void this.render(); });
        container.appendChild(retry);

        const cancelSetup = document.createElement('button');
        cancelSetup.textContent = 'Cancel setup';
        cancelSetup.addEventListener('click', async () => {
          await plugin.useWithoutSync();
          this.action = null;
          await this.render();
        });
        container.appendChild(cancelSetup);
        return;
      }
      for (const candidate of candidates) {
        const button = document.createElement('button');
        button.textContent = `Pair with ${candidate.name}`;
        button.addEventListener('click', async () => {
          const originalLabel = button.textContent || `Pair with ${candidate.name}`;
          button.disabled = true;
          button.textContent = 'Scanning vaults…';
          new Notice('Scanning local and Google Drive vaults for a safe pairing summary…');
          try {
            await plugin.confirmPairing(candidate.id, candidate.name, false, false, progress => {
              if (progress.phase === 'local_inventory') {
                button.textContent = 'Scanning local vault…';
              } else if (progress.phase === 'remote_inventory') {
                button.textContent = 'Listing Drive vault…';
              } else if (progress.phase === 'resolving_ambiguities') {
                button.textContent = progress.total > 0
                  ? `Hashing duplicates ${progress.completed}/${progress.total}…`
                  : 'Hashing duplicate candidates…';
              } else if (progress.total > 0) {
                button.textContent = `Comparing ${progress.completed}/${progress.total}…`;
              } else {
                button.textContent = 'Comparing vaults…';
              }
            });
          } catch (error) {
            new Notice(`Pairing scan failed: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            button.disabled = false;
            button.textContent = originalLabel;
            await this.render();
          }
        });
        container.appendChild(button);
      }
      return;
    }

    if (!conflictsOnly && coordinator) {
      const actions = document.createElement('div');
      actions.className = 'quartzo-sync-actions';
      actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-block:12px;';

      const isSyncing = offline || snapshot?.status === 'syncing';

      const sync = document.createElement('button');
      sync.className = 'qz-btn qz-btn-primary';
      sync.textContent = '☁ Sync now';
      sync.disabled = isSyncing;
      if (sync.disabled) sync.title = offline ? 'Sync requires network access.' : 'A sync operation is already running.';

      const full = document.createElement('button');
      full.className = 'qz-btn qz-btn-secondary';
      full.textContent = '🔄 Full reconciliation';
      full.disabled = isSyncing;
      if (full.disabled) full.title = offline ? 'Full reconciliation requires network access.' : 'A sync operation is already running.';

      const runWithVisibleProgress = async (
        operation: 'incremental' | 'full'
      ): Promise<void> => {
        sync.disabled = true;
        full.disabled = true;
        const progressLine = ensureSyncProgressLine();
        progressLine.textContent = operation === 'full'
          ? 'Starting full reconciliation…'
          : 'Starting sync…';

        this.startSyncProgressTicker(progressLine, () => coordinator.getSyncProgress());

        try {
          const onProgress = (progress: SyncProgress) => {
            if (!this.isCurrentRender(container, generation)) return;
            progressLine.textContent = formatSyncProgress(progress);
          };
          const result = operation === 'full'
            ? await coordinator.triggerFullReconciliation(onProgress)
            : await coordinator.triggerManualSync(onProgress);
          if (!this.isCurrentRender(container, generation)) return;
          if (result.errors.length > 0) {
            new Notice(result.errors[result.errors.length - 1]);
          } else if (operation === 'full') {
            new Notice(`Full reconciliation complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          } else {
            new Notice(`Sync complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          }
        } finally {
          this.stopSyncProgressTicker();
          if (this.isCurrentRender(container, generation)) {
            await this.render();
          }
        }
      };

      sync.addEventListener('click', () => { void runWithVisibleProgress('incremental'); });
      actions.appendChild(sync);

      full.addEventListener('click', () => { void runWithVisibleProgress('full'); });
      actions.appendChild(full);

      const ambiguityPaths = coordinator.getRemoteIdentityAmbiguityPaths();
      if (ambiguityPaths.length > 0) {
        const repairDuplicates = document.createElement('button');
        repairDuplicates.className = 'qz-btn qz-btn-secondary';
        repairDuplicates.textContent = `Review Drive duplicates (${ambiguityPaths.length})`;
        repairDuplicates.disabled = isSyncing;
        if (repairDuplicates.disabled) repairDuplicates.title = offline ? 'Duplicate review requires network access.' : 'Finish the active sync before reviewing duplicates.';
        repairDuplicates.addEventListener('click', async () => {
          await plugin.reviewSyncRemoteDuplicates();
          await this.render();
        });
        actions.appendChild(repairDuplicates);
      }

      const numConflicts = coordinator.getConflicts().length;
      if (numConflicts > 0) {
        const showConflicts = document.createElement('button');
        showConflicts.className = 'qz-btn qz-btn-secondary';
        showConflicts.textContent = `⚡ Conflicts (${numConflicts})`;
        showConflicts.addEventListener('click', () => { void this.handleAction('conflicts'); });
        actions.appendChild(showConflicts);
      }

      const reconnect = document.createElement('button');
      reconnect.className = 'qz-btn qz-btn-ghost qz-btn-sm';
      reconnect.textContent = 'Reconnect Google';
      reconnect.disabled = offline;
      if (offline) reconnect.title = 'Reconnect requires network access.';
      reconnect.addEventListener('click', async () => { await plugin.reconnectGoogle(); await this.render(); });
      actions.appendChild(reconnect);

      const disconnect = document.createElement('button');
      disconnect.className = 'qz-btn qz-btn-danger qz-btn-sm';
      disconnect.textContent = 'Disconnect';
      disconnect.addEventListener('click', async () => { await plugin.disconnectDrive(); await this.render(); });
      actions.appendChild(disconnect);
      container.appendChild(actions);
    }

    const conflicts = coordinator?.getConflicts() ?? [];
    if (conflicts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'qz-empty-state';
      const emIcon = document.createElement('div');
      emIcon.className = 'qz-empty-state-icon';
      emIcon.textContent = '✅';
      const emTitle = document.createElement('div');
      emTitle.className = 'qz-empty-state-title';
      emTitle.textContent = 'No conflicts';
      const emBody = document.createElement('div');
      emBody.className = 'qz-empty-state-body';
      emBody.textContent = 'All files are in sync between local vault and Google Drive.';
      empty.appendChild(emIcon);
      empty.appendChild(emTitle);
      empty.appendChild(emBody);
      container.appendChild(empty);
      return;
    }

    const conflictsHeader = document.createElement('div');
    conflictsHeader.className = 'qz-section-header';
    const ch_icon = document.createElement('span');
    ch_icon.className = 'qz-section-header-icon';
    ch_icon.textContent = '⚡';
    const ch_title = document.createElement('span');
    ch_title.className = 'qz-section-header-title';
    ch_title.textContent = `Conflicts (${conflicts.length})`;
    conflictsHeader.appendChild(ch_icon);
    conflictsHeader.appendChild(ch_title);
    container.appendChild(conflictsHeader);

    const decoder = new TextDecoder();
    for (const conflict of conflicts) {
      const card = document.createElement('section');
      card.className = 'quartzo-conflict-card';

      // Card header: path + newest badge
      const cardHeader = document.createElement('div');
      cardHeader.className = 'qz-conflict-header';
      const pathSpan = document.createElement('span');
      pathSpan.className = 'qz-conflict-path';
      pathSpan.textContent = conflict.originalPath;
      pathSpan.title = conflict.originalPath;
      cardHeader.appendChild(pathSpan);
      const newest = chooseNewestConflictResolution(conflict);
      const newestBadge = document.createElement('span');
      newestBadge.className = 'qz-badge qz-badge-neutral';
      newestBadge.textContent = newest === 'keep_local' ? '📱 Local newer' : newest === 'keep_drive' ? '☁ Drive newer' : '≡ Same age';
      cardHeader.appendChild(newestBadge);
      card.appendChild(cardHeader);

      // Metadata row
      const meta = document.createElement('p');
      meta.style.cssText = 'font-size:var(--qz-font-xs);color:var(--qz-text-secondary);margin-bottom:8px;';
      const localModified = conflict.localModifiedAt ? new Date(conflict.localModifiedAt).toLocaleString() : 'Unknown';
      const driveModified = conflict.remoteModifiedAt ? new Date(conflict.remoteModifiedAt).toLocaleString() : 'Unknown';
      meta.textContent = `Local: ${localModified}  ·  Drive: ${driveModified}  ·  Hashes: ${conflict.localSha256.slice(0, 8)}… vs ${conflict.remoteSha256.slice(0, 8)}…`;
      card.appendChild(meta);

      // Two-column content preview
      if (plugin.settings.hideSensitivePreviews) {
        const hidden = document.createElement('p');
        hidden.style.cssText = 'font-size:var(--qz-font-xs);color:var(--qz-text-secondary);';
        hidden.textContent = 'Content hidden by Privacy settings.';
        card.appendChild(hidden);
      } else if (conflict.isBinary) {
        const binary = document.createElement('p');
        binary.style.cssText = 'font-size:var(--qz-font-xs);';
        binary.textContent = `Binary file — Local: ${conflict.localContent.length} bytes · Drive: ${conflict.remoteContent.length} bytes`;
        card.appendChild(binary);
      } else {
        const localText = conflict.localExists ? decoder.decode(conflict.localContent) : '';
        const driveText = conflict.remoteExists ? decoder.decode(conflict.remoteContent) : '';
        const versions = document.createElement('div');
        versions.className = 'qz-conflict-versions';

        for (const [side, text, exists] of [
          ['📱 Local', localText, conflict.localExists],
          ['☁ Drive', driveText, conflict.remoteExists],
        ] as const) {
          const block = document.createElement('div');
          block.className = 'qz-conflict-version-block';
          const label = document.createElement('div');
          label.className = 'qz-conflict-version-label';
          label.textContent = side;
          block.appendChild(label);
          const pre = document.createElement('pre');
          pre.style.cssText = 'font-size:10px;overflow:auto;max-height:120px;margin:0;';
          pre.textContent = exists ? text.slice(0, 500) + (text.length > 500 ? '…' : '') : '(deleted)';
          block.appendChild(pre);
          versions.appendChild(block);
        }
        card.appendChild(versions);

        if (conflict.localExists && conflict.remoteExists) {
          const diff = buildConflictDiff(localText, driveText);
          if (diff != null) {
            const diffWrap = document.createElement('details');
            diffWrap.style.cssText = 'font-size:var(--qz-font-xs);';
            const diffSummary = document.createElement('summary');
            diffSummary.textContent = 'Show diff';
            diffSummary.style.cursor = 'pointer';
            diffWrap.appendChild(diffSummary);
            const diffView = document.createElement('pre');
            diffView.style.cssText = 'font-size:10px;overflow:auto;max-height:180px;margin-top:4px;';
            diffView.textContent = formatConflictDiff(diff);
            diffWrap.appendChild(diffView);
            card.appendChild(diffWrap);
          }
        }
      }

      // Action row — keep_newest must remain fail-closed (button.disabled = true when newest == null)
      const actionRow = document.createElement('div');
      actionRow.className = 'qz-conflict-actions';
      // Resolution choices: ['keep_newest', 'Keep newest'] is the canonical fail-closed option
      const resolutionChoices: Array<['keep_local' | 'keep_drive' | 'keep_newest', string, string]> = [
        ['keep_local', '📱 Keep local', 'qz-btn qz-btn-secondary'],
        ['keep_drive', '☁ Keep Drive', 'qz-btn qz-btn-secondary'],
        ['keep_newest', 'Keep newest', 'qz-btn qz-btn-primary'],
      ];
      for (const [resolution, label, cls] of resolutionChoices) {
        const button = document.createElement('button');
        button.className = cls;
        button.textContent = label;
        if (resolution === 'keep_newest' && newest == null) {
          button.disabled = true;
          button.title = 'Keep newest requires two distinct trustworthy modification times.';
        }
        button.addEventListener('click', async () => {
          try {
            await coordinator?.resolveConflict(conflict.originalPath, resolution);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
          await this.render();
        });
        actionRow.appendChild(button);
      }
      card.appendChild(actionRow);
      container.appendChild(card);
    }
  }

  private renderObjectRow(container: HTMLElement, object: IndexedObject): void {
    const row = document.createElement('button');
    row.className = 'quartzo-object-row';
    row.textContent = `${String(object.frontmatter.title ?? 'Untitled')} · ${labelForType(object.type)}`;
    row.addEventListener('click', () => this.openObjectDetail(object));
    container.appendChild(row);
  }

  private openObjectDetail(object: IndexedObject): void {
    this.selectedObjectId = object.id;
    this.editingSelectedObject = false;
    void this.render();
  }

  private openMarkdown(object: IndexedObject): void {
    void this.context.app.workspace.openLinkText(object.path, '', true);
  }
}
