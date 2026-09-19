import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import type { NormalizedItem } from '../../core/daily_schedule/types';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import { addLocalDays, daysInLocalMonth, localIsoDate, parseLocalIsoDate, shiftLocalMonth } from '../../core/local-date';
import { chooseNewestConflictResolution, type SyncProgress } from '../../sync/coordinator';
import { VaultIndexEngine } from '../../vault/index';
import { renderObjectDetail } from '../detail/object-detail';
import { projectHomeSchedule } from '../home/home-projection';
import { projectJournalDay } from '../journal/journal-projection';
import {
  SharedSettingsRepository,
} from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import { QuickAddModal } from '../quick-add/modal';
import type { ViewContext } from '../types';
import { renderOccurrenceActionControls } from '../occurrence/action-controls';
import { buildConflictDiff, formatConflictDiff } from '../sync/conflict-diff';

export const QUARTZO_VIEW_TYPE = 'quartzo-view';
export type QuartzoSection = 'home' | 'planner' | 'journal' | 'browse';
export type QuartzoAction = 'search' | 'add' | 'sync' | 'conflicts' | 'settings';
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
  private selectedDate = isoDate(new Date());
  private plannerMode: 'day' | 'week' | 'month' = 'day';
  private sharedSettingsRepository: SharedSettingsRepository;
  private syncProgressTickerId: number | null = null;

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

  async setSection(section: QuartzoSection): Promise<void> {
    this.section = section;
    this.action = null;
    this.selectedObjectId = null;
    await this.render();
  }

  async handleAction(action: QuartzoAction): Promise<void> {
    this.selectedObjectId = null;
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

  private getIndex(): VaultIndex | null {
    return this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex() ?? null;
  }

  private async render(): Promise<void> {
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

    const nav = document.createElement('nav');
    for (const section of ['home', 'planner', 'journal', 'browse'] as QuartzoSection[]) {
      const button = document.createElement('button');
      button.textContent = labelForType(section);
      if (section === this.section) button.classList.add('is-active');
      button.addEventListener('click', () => { void this.setSection(section); });
      nav.appendChild(button);
    }
    header.appendChild(nav);

    const actions = document.createElement('div');
    actions.className = 'quartzo-shell-actions';
    for (const [action, label] of [['search', 'Search'], ['add', 'Add'], ['sync', 'Sync'], ['settings', 'Settings']] as Array<[QuartzoAction, string]>) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => { void this.handleAction(action); });
      actions.appendChild(button);
    }
    header.appendChild(actions);
    shell.appendChild(header);

    const content = document.createElement('main');
    content.className = 'quartzo-shell-content';
    shell.appendChild(content);

    if (this.selectedObjectId) {
      const object = this.getIndex()?.objects.get(this.selectedObjectId);
      if (object) {
        renderObjectDetail(content, object, {
          onBack: () => { this.selectedObjectId = null; void this.render(); },
          onOpenMarkdown: () => this.openMarkdown(object),
        });
        return;
      }
      this.selectedObjectId = null;
    }

    if (this.action === 'search') {
      this.renderSearch(content);
      return;
    }
    if (this.action === 'sync' || this.action === 'conflicts') {
      await this.renderSync(content, this.action === 'conflicts');
      return;
    }

    if (this.section === 'home') await this.renderHome(content);
    if (this.section === 'planner') await this.renderPlanner(content);
    if (this.section === 'journal') await this.renderJournal(content);
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
    });
  }

  private titleForSource(sourceId: string): string {
    const object = this.getIndex()?.objects.get(sourceId);
    return String(object?.frontmatter.title ?? object?.type ?? sourceId);
  }

  private renderScheduleList(container: HTMLElement, items: NormalizedItem[], googleEvents: GoogleCalendarProjection[] = []): void {
    const googleTitles = new Map(googleEvents.map(event => [event.id, event.summary] as const));
    const list = document.createElement('ul');
    list.className = 'quartzo-schedule-list';
    for (const item of items) {
      const row = document.createElement('li');
      row.className = 'quartzo-schedule-row';

      const label = document.createElement('span');
      label.className = 'quartzo-schedule-label';
      const time = item.start ? `${item.start} · ` : '';
      const title = item.origin === 'externalEvent'
        ? (googleTitles.get(item.sourceId) ?? item.sourceLabel)
        : this.titleForSource(item.sourceId);
      label.textContent = `${time}${title}`;
      row.appendChild(label);

      const object = this.getIndex()?.objects.get(item.sourceId);
      if (object) {
        label.classList.add('quartzo-clickable');
        label.addEventListener('click', () => this.openObjectDetail(object));
      }

      renderOccurrenceActionControls(row, {
        app: this.context.app,
        item,
        perform: (action, options) =>
          this.context.plugin.performOccurrenceAction(item, action, options),
      });
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  private renderScheduleItems(container: HTMLElement, date: string, googleEvents: GoogleCalendarProjection[] = []): void {
    const schedule = this.buildSchedule(date, googleEvents);
    const heading = document.createElement('h3');
    heading.textContent = date;
    container.appendChild(heading);
    if (schedule.items.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing scheduled.';
      container.appendChild(empty);
      return;
    }
    this.renderScheduleList(container, schedule.items, googleEvents);
  }

  private renderHomeBucket(container: HTMLElement, titleText: string, items: NormalizedItem[], emptyText: string, googleEvents: GoogleCalendarProjection[] = []): void {
    const section = document.createElement('section');
    section.className = 'quartzo-home-section';
    const heading = document.createElement('h3');
    heading.textContent = titleText;
    section.appendChild(heading);
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = emptyText;
      section.appendChild(empty);
    } else {
      this.renderScheduleList(section, items, googleEvents);
    }
    container.appendChild(section);
  }

  private async renderHome(container: HTMLElement): Promise<void> {
    const title = document.createElement('h2');
    title.textContent = 'Home';
    container.appendChild(title);

    const date = document.createElement('p');
    date.className = 'quartzo-home-date';
    date.textContent = this.selectedDate;
    container.appendChild(date);

    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(this.selectedDate, 1);
    const schedule = this.buildSchedule(this.selectedDate, googleEvents);
    const projection = projectHomeSchedule(schedule, this.selectedDate, new Date());

    const dial = document.createElement('section');
    dial.className = 'quartzo-home-section quartzo-day-dial-summary';
    const dialTitle = document.createElement('h3');
    dialTitle.textContent = 'Day Dial';
    dial.appendChild(dialTitle);
    const summary = document.createElement('p');
    summary.textContent = `${schedule.count} item${schedule.count === 1 ? '' : 's'} on the canonical Daily Schedule.`;
    dial.appendChild(summary);
    container.appendChild(dial);

    this.renderHomeBucket(container, 'Now', projection.now, 'Nothing active right now.', googleEvents);
    this.renderHomeBucket(container, 'Up Next', projection.upNext, 'Nothing timed is coming up.', googleEvents);
    this.renderHomeBucket(container, 'Today', projection.today, 'Nothing scheduled today.', googleEvents);
  }

  private async renderPlanner(container: HTMLElement): Promise<void> {
    const title = document.createElement('h2');
    title.textContent = 'Planner';
    container.appendChild(title);

    const controls = document.createElement('div');
    const previous = document.createElement('button');
    previous.textContent = '‹';
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
    dateInput.value = this.selectedDate;
    dateInput.addEventListener('change', () => {
      this.selectedDate = dateInput.value || isoDate(new Date());
      void this.render();
    });
    controls.appendChild(dateInput);

    const next = document.createElement('button');
    next.textContent = '›';
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
      if (mode === this.plannerMode) button.classList.add('is-active');
      button.addEventListener('click', () => { this.plannerMode = mode; void this.render(); });
      controls.appendChild(button);
    }
    container.appendChild(controls);

    const selected = parseIsoDate(this.selectedDate);
    if (this.plannerMode === 'day') {
      const googleEvents = await this.context.plugin.listGoogleCalendarEvents(this.selectedDate, 1);
      this.renderScheduleItems(container, this.selectedDate, googleEvents);
      return;
    }

    if (this.plannerMode === 'week') {
      const settings = await this.sharedSettingsRepository.load();
      const startOfWeek = settings?.startOfWeek ?? 1;
      const weekday = selected.getDay();
      const delta = (weekday - startOfWeek + 7) % 7;
      const start = addDays(selected, -delta);
      const googleEvents = await this.context.plugin.listGoogleCalendarEvents(isoDate(start), 7);
      for (let i = 0; i < 7; i++) this.renderScheduleItems(container, isoDate(addDays(start, i)), googleEvents);
      return;
    }

    const year = selected.getFullYear();
    const month = selected.getMonth();
    const days = daysInLocalMonth(selected);
    const monthStart = isoDate(new Date(year, month, 1));
    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(monthStart, days);
    for (let day = 1; day <= days; day++) {
      this.renderScheduleItems(container, isoDate(new Date(year, month, day)), googleEvents);
    }
  }

  private async renderJournal(container: HTMLElement): Promise<void> {
    const title = document.createElement('h2');
    title.textContent = 'Journal';
    container.appendChild(title);

    const navigation = document.createElement('div');
    navigation.className = 'quartzo-journal-navigation';
    const previous = document.createElement('button');
    previous.textContent = '‹';
    previous.addEventListener('click', () => {
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), -1));
      void this.render();
    });
    navigation.appendChild(previous);

    const date = document.createElement('input');
    date.type = 'date';
    date.value = this.selectedDate;
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

    const projection = projectJournalDay(this.getIndex(), this.selectedDate);

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

    const timeline = document.createElement('section');
    const timelineHeading = document.createElement('h3');
    timelineHeading.textContent = 'Timeline';
    timeline.appendChild(timelineHeading);
    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(this.selectedDate, 1);
    const schedule = this.buildSchedule(this.selectedDate, googleEvents);
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
    const index = this.getIndex();
    const objects = index ? Array.from(index.objects.values()) : [];

    const filter = document.createElement('select');
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All types';
    filter.appendChild(all);
    for (const type of [...new Set(objects.map(object => object.type))].sort()) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = labelForType(type);
      filter.appendChild(option);
    }
    container.appendChild(filter);

    const list = document.createElement('div');
    container.appendChild(list);
    const render = () => {
      list.replaceChildren();
      const visible = filter.value ? objects.filter(object => object.type === filter.value) : objects;
      for (const object of visible) this.renderObjectRow(list, object);
    };
    filter.addEventListener('change', render);
    render();
  }

  private renderSearch(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Search';
    container.appendChild(title);
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search Quartzo objects';
    container.appendChild(input);
    const results = document.createElement('div');
    container.appendChild(results);
    const renderResults = () => {
      results.replaceChildren();
      const index = this.getIndex();
      if (!index || !input.value.trim()) return;
      for (const object of VaultIndexEngine.searchObjects(index, input.value)) {
        this.renderObjectRow(results, object);
      }
    };
    input.addEventListener('input', renderResults);
    input.focus();
  }

  private async renderSync(container: HTMLElement, conflictsOnly: boolean): Promise<void> {
    const title = document.createElement('h2');
    title.textContent = conflictsOnly ? 'Conflicts' : 'Sync';
    container.appendChild(title);

    const plugin = this.context.plugin;
    const coordinator = plugin.driveSyncCoordinator;
    const snapshot = coordinator ? await coordinator.getSyncStatusSnapshot() : null;
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
              syncing: 'Syncing',
              conflict: 'Conflict',
              error: 'Error',
            } as const)[snapshot.status];

    const summary = document.createElement('section');
    summary.className = 'quartzo-sync-summary';
    const summaryLines = [
      `Status: ${statusLabel}`,
      `Last successful sync: ${snapshot?.lastSuccessfulSyncAt ? new Date(snapshot.lastSuccessfulSyncAt).toLocaleString() : 'Never'}`,
      `Pending local changes: ${snapshot?.pendingLocalChanges ?? 0}`,
      `Sync mode: ${plugin.settings.syncMode === 'automatic' ? 'Automatic' : 'Manual'}`,
      `Current Google Drive vault: ${plugin.settings.googleDriveFolderName ?? 'Not paired'}`,
      `Google account: ${plugin.authState.replace(/_/g, ' ')}`,
      `Companion version: ${plugin.manifest.version}`,
      `Conflicts: ${snapshot?.conflictCount ?? coordinator?.getConflicts().length ?? 0}`,
    ];
    for (const lineText of summaryLines) {
      const line = document.createElement('p');
      line.textContent = lineText;
      summary.appendChild(line);
    }
    if (snapshot?.lastError) {
      const lastError = document.createElement('p');
      lastError.textContent = `Last error: ${snapshot.lastError}`;
      summary.appendChild(lastError);
    }

    let syncProgressLine: HTMLParagraphElement | null = null;
    const ensureSyncProgressLine = (): HTMLParagraphElement => {
      if (!syncProgressLine) {
        syncProgressLine = document.createElement('p');
        syncProgressLine.className = 'quartzo-sync-progress';
        syncProgressLine.style.cssText = 'font-weight: 600; word-break: break-word;';
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
      connect.textContent = canReconnect ? 'Reconnect Google' : 'Connect Google Drive';
      connect.disabled = offline;
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

      const sync = document.createElement('button');
      sync.textContent = 'Sync now';
      sync.disabled = offline || snapshot?.status === 'syncing';

      const full = document.createElement('button');
      full.textContent = 'Run full reconciliation';
      full.disabled = offline || snapshot?.status === 'syncing';

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
            progressLine.textContent = formatSyncProgress(progress);
          };
          const result = operation === 'full'
            ? await coordinator.triggerFullReconciliation(onProgress)
            : await coordinator.triggerManualSync(onProgress);
          if (result.errors.length > 0) {
            new Notice(result.errors[result.errors.length - 1]);
          } else if (operation === 'full') {
            new Notice(`Full reconciliation complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          } else {
            new Notice(`Sync complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          }
        } finally {
          this.stopSyncProgressTicker();
          await this.render();
        }
      };

      sync.addEventListener('click', () => {
        void runWithVisibleProgress('incremental');
      });
      actions.appendChild(sync);

      full.addEventListener('click', () => {
        void runWithVisibleProgress('full');
      });
      actions.appendChild(full);

      const ambiguityPaths = coordinator.getRemoteIdentityAmbiguityPaths();
      if (ambiguityPaths.length > 0) {
        const repairDuplicates = document.createElement('button');
        repairDuplicates.textContent = `Review Drive duplicates (${ambiguityPaths.length})`;
        repairDuplicates.disabled = offline || snapshot?.status === 'syncing';
        repairDuplicates.addEventListener('click', async () => {
          await plugin.reviewSyncRemoteDuplicates();
          await this.render();
        });
        actions.appendChild(repairDuplicates);
      }

      const showConflicts = document.createElement('button');
      showConflicts.textContent = `View conflicts (${coordinator.getConflicts().length})`;
      showConflicts.addEventListener('click', () => { void this.handleAction('conflicts'); });
      actions.appendChild(showConflicts);

      const reconnect = document.createElement('button');
      reconnect.textContent = 'Reconnect Google';
      reconnect.disabled = offline;
      reconnect.addEventListener('click', async () => { await plugin.reconnectGoogle(); await this.render(); });
      actions.appendChild(reconnect);

      const disconnect = document.createElement('button');
      disconnect.textContent = 'Disconnect this device';
      disconnect.addEventListener('click', async () => { await plugin.disconnectDrive(); await this.render(); });
      actions.appendChild(disconnect);
      container.appendChild(actions);
    }

    const conflicts = coordinator?.getConflicts() ?? [];
    if (conflicts.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No conflicts.';
      container.appendChild(empty);
      return;
    }

    const decoder = new TextDecoder();
    for (const conflict of conflicts) {
      const card = document.createElement('section');
      card.className = 'quartzo-conflict-card';

      const heading = document.createElement('h3');
      heading.textContent = conflict.originalPath;
      card.appendChild(heading);

      const metadata = document.createElement('p');
      const localModified = conflict.localModifiedAt ? new Date(conflict.localModifiedAt).toLocaleString() : 'Unknown';
      const driveModified = conflict.remoteModifiedAt ? new Date(conflict.remoteModifiedAt).toLocaleString() : 'Unknown';
      metadata.textContent = `Local modified: ${localModified} · Drive modified: ${driveModified}`;
      card.appendChild(metadata);

      const hashes = document.createElement('p');
      hashes.textContent = `Local ${conflict.localSha256.slice(0, 12)} · Drive ${conflict.remoteSha256.slice(0, 12)}`;
      card.appendChild(hashes);

      const newest = chooseNewestConflictResolution(conflict);
      const newestInfo = document.createElement('p');
      newestInfo.textContent = newest === 'keep_local'
        ? 'Newest by modification time: Local'
        : newest === 'keep_drive'
          ? 'Newest by modification time: Drive'
          : 'Newest by modification time: unavailable; choose a side explicitly.';
      card.appendChild(newestInfo);

      if (plugin.settings.hideSensitivePreviews) {
        const hidden = document.createElement('p');
        hidden.textContent = 'Conflict content hidden by Privacy settings.';
        card.appendChild(hidden);
      } else if (conflict.isBinary) {
        const binary = document.createElement('p');
        binary.textContent = `Binary conflict. Local bytes: ${conflict.localContent.length}; Drive bytes: ${conflict.remoteContent.length}.`;
        card.appendChild(binary);
      } else {
        const localText = conflict.localExists ? decoder.decode(conflict.localContent) : '';
        const driveText = conflict.remoteExists ? decoder.decode(conflict.remoteContent) : '';

        const local = document.createElement('pre');
        local.textContent = conflict.localExists ? `Local:\n${localText}` : 'Local: deleted';
        card.appendChild(local);

        const remote = document.createElement('pre');
        remote.textContent = conflict.remoteExists ? `Drive:\n${driveText}` : 'Drive: deleted';
        card.appendChild(remote);

        if (conflict.localExists && conflict.remoteExists) {
          const diffTitle = document.createElement('strong');
          diffTitle.textContent = 'Diff';
          card.appendChild(diffTitle);
          const diff = buildConflictDiff(localText, driveText);
          const diffView = document.createElement('pre');
          diffView.textContent = diff == null
            ? 'Diff unavailable for this file size.'
            : formatConflictDiff(diff);
          card.appendChild(diffView);
        }
      }

      const actionRow = document.createElement('div');
      actionRow.className = 'quartzo-conflict-actions';
      const choices = [
        ['keep_local', 'Keep local'],
        ['keep_drive', 'Keep Drive'],
        ['keep_newest', 'Keep newest'],
      ] as const;
      for (const [resolution, label] of choices) {
        const button = document.createElement('button');
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
    void this.render();
  }

  private openMarkdown(object: IndexedObject): void {
    void this.context.app.workspace.openLinkText(object.path, '', true);
  }
}
