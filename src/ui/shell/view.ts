import { ItemView, Modal, Notice, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import type { NormalizedItem } from '../../core/daily_schedule/types';
import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';
import { ObjectParser } from '../../core/objects';
import type { TrackerDefinition } from '../../core/objects/types';
import { findResourceDuplicates, type ResourceIdentity } from '../../core/resource-capture/policy';
import { ResourceMetadataService, type ResourceMetadataDraft } from '../../integrations/resource-metadata/service';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import { addLocalDays, daysInLocalMonth, localIsoDate, parseLocalIsoDate, shiftLocalMonth } from '../../core/local-date';
import { createCanonicalObjectId } from '../../platform/object-id';
import { chooseNewestConflictResolution } from '../../sync/coordinator';
import { VaultIndexEngine } from '../../vault/index';
import { renderObjectDetail } from '../detail/object-detail';
import { projectHomeSchedule } from '../home/home-projection';
import { projectJournalDay } from '../journal/journal-projection';
import { renderTrackerRecordQuickAdd, type TrackerRecordFormController } from '../quick-add/record-form';
import {
  SharedSettingsRepository,
} from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import type { ViewContext } from '../types';
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

class QuickAddModal extends Modal {
  private type: QuickAddType = 'task';
  private settingsRepository: SharedSettingsRepository;
  private readonly resourceMetadataService = new ResourceMetadataService();

  constructor(private readonly context: ViewContext, initialType?: QuickAddType) {
    super(context.app);
    if (initialType) this.type = initialType;
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const title = document.createElement('h2');
    title.textContent = 'Quick Add';
    contentEl.appendChild(title);

    const typeSelect = document.createElement('select');
    for (const type of ['task', 'entry', 'note', 'reminder', 'tracker_record', 'resource'] as QuickAddType[]) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = labelForType(type);
      option.selected = type === this.type;
      typeSelect.appendChild(option);
    }
    typeSelect.addEventListener('change', () => {
      this.type = typeSelect.value as QuickAddType;
      this.render();
    });
    contentEl.appendChild(typeSelect);

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = this.type === 'entry' ? 'Entry title (optional)' : `${labelForType(this.type)} title`;
    titleInput.className = 'quartzo-input';
    if (this.type !== 'tracker_record') contentEl.appendChild(titleInput);

    const bodyInput = document.createElement('textarea');
    bodyInput.placeholder = this.type === 'resource' ? 'Synopsis or notes' : 'Content';
    bodyInput.className = 'quartzo-input';
    if (this.type !== 'tracker_record') contentEl.appendChild(bodyInput);

    let dateInput: HTMLInputElement | null = null;
    let timeInput: HTMLInputElement | null = null;
    if (this.type === 'entry' || this.type === 'reminder') {
      dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.value = isoDate(new Date());
      contentEl.appendChild(dateInput);
      timeInput = document.createElement('input');
      timeInput.type = 'time';
      timeInput.value = this.type === 'reminder' ? '09:00' : new Date().toTimeString().slice(0, 5);
      contentEl.appendChild(timeInput);
    }

    let recordForm: TrackerRecordFormController | null = null;
    if (this.type === 'tracker_record') {
      recordForm = renderTrackerRecordQuickAdd(contentEl, this.trackerDefinitions(), isoDate(new Date()));
    }

    let sourceUrlInput: HTMLInputElement | null = null;
    let mediaTypeSelect: HTMLSelectElement | null = null;
    let prioritySelect: HTMLSelectElement | null = null;
    let statusSelect: HTMLSelectElement | null = null;
    let categoriesInput: HTMLInputElement | null = null;
    let relationsSelect: HTMLSelectElement | null = null;
    let resourceMetadata: ResourceMetadataDraft | null = null;
    let titleEdited = false;
    let bodyEdited = false;
    let mediaTypeEdited = false;
    if (this.type === 'resource') {
      titleInput.addEventListener('input', () => { titleEdited = true; });
      bodyInput.addEventListener('input', () => { bodyEdited = true; });
      sourceUrlInput = document.createElement('input');
      sourceUrlInput.type = 'url';
      sourceUrlInput.placeholder = 'Source URL (optional)';
      sourceUrlInput.className = 'quartzo-input';
      sourceUrlInput.addEventListener('input', () => { resourceMetadata = null; });
      contentEl.appendChild(sourceUrlInput);

      mediaTypeSelect = this.createSelect('Resource type', [
        'General', 'Book', 'Movie', 'Show', 'Video', 'Podcast', 'Article', 'Course',
      ]);
      mediaTypeSelect.addEventListener('change', () => { mediaTypeEdited = true; });
      contentEl.appendChild(mediaTypeSelect);

      const metadataStatus = document.createElement('small');
      metadataStatus.textContent = 'Paste a supported link and fetch metadata, or fill the fields manually.';
      const fetchMetadata = document.createElement('button');
      fetchMetadata.type = 'button';
      fetchMetadata.textContent = 'Fetch metadata';
      fetchMetadata.addEventListener('click', async () => {
        const url = sourceUrlInput?.value.trim() ?? '';
        if (!url) {
          new Notice('Paste a Resource URL first.');
          return;
        }
        fetchMetadata.disabled = true;
        fetchMetadata.textContent = 'Fetching…';
        metadataStatus.textContent = 'Checking supported metadata providers…';
        try {
          const metadata = await this.resourceMetadataService.fetch(url);
          resourceMetadata = metadata.sourceUrl === url ? metadata : null;
          if (!metadata.fetched) {
            metadataStatus.textContent = 'No automatic metadata found. You can still save this Resource manually.';
            return;
          }
          if (!titleEdited && metadata.title) titleInput.value = metadata.title;
          if (!bodyEdited && metadata.synopsis) bodyInput.value = metadata.synopsis;
          if (!mediaTypeEdited && metadata.mediaType && mediaTypeSelect) {
            const supported = Array.from(mediaTypeSelect.options).some(option => option.value === metadata.mediaType);
            if (supported) mediaTypeSelect.value = metadata.mediaType;
          }
          const details = [metadata.author, metadata.year, metadata.pages ? `${metadata.pages} pages` : undefined]
            .filter((value): value is string | number => value != null && value !== '');
          metadataStatus.textContent = details.length > 0
            ? `Metadata loaded: ${details.join(' • ')}`
            : 'Metadata loaded. Review the fields before saving.';
        } finally {
          fetchMetadata.disabled = false;
          fetchMetadata.textContent = 'Fetch metadata';
        }
      });
      contentEl.appendChild(fetchMetadata);
      contentEl.appendChild(metadataStatus);

      prioritySelect = this.createSelect('Priority', ['none', 'low', 'medium', 'high']);
      contentEl.appendChild(prioritySelect);

      statusSelect = this.createSelect('Status', ['toConsume', 'inProgress', 'completed', 'dropped']);
      contentEl.appendChild(statusSelect);

      categoriesInput = document.createElement('input');
      categoriesInput.type = 'text';
      categoriesInput.placeholder = 'Categories, comma separated';
      categoriesInput.className = 'quartzo-input';
      contentEl.appendChild(categoriesInput);

      relationsSelect = document.createElement('select');
      relationsSelect.multiple = true;
      relationsSelect.className = 'quartzo-input';
      relationsSelect.setAttribute('aria-label', 'Related Resources');
      for (const resource of this.resourceObjects()) {
        const option = document.createElement('option');
        option.value = this.wikilinkFor(resource);
        option.textContent = String(resource.frontmatter.title ?? resource.id);
        relationsSelect.appendChild(option);
      }
      contentEl.appendChild(relationsSelect);
      const relationHint = document.createElement('small');
      relationHint.textContent = 'Related Resources (use Ctrl/Cmd to select more than one).';
      contentEl.appendChild(relationHint);
    }

    const create = document.createElement('button');
    create.textContent = `Create ${labelForType(this.type)}`;
    create.className = 'mod-cta';
    const performCreate = async (skipDuplicateCheck = false): Promise<void> => {
      try {
        const currentResourceUrl = sourceUrlInput?.value.trim() ?? '';
        const currentMetadata = resourceMetadata?.sourceUrl === currentResourceUrl && resourceMetadata.fetched
          ? resourceMetadata
          : null;
        const recordInput = this.type === 'tracker_record' ? recordForm?.value() : undefined;
        const resourceInput = this.type === 'resource'
          ? {
              mediaType: mediaTypeSelect?.value ?? '',
              sourceUrl: currentResourceUrl || undefined,
              priority: (prioritySelect?.value ?? 'none') as 'none' | 'low' | 'medium' | 'high',
              status: (statusSelect?.value ?? 'toConsume') as 'toConsume' | 'inProgress' | 'completed' | 'dropped',
              categories: this.csvValues(categoriesInput?.value ?? ''),
              links: relationsSelect == null
                ? []
                : Array.from(relationsSelect.selectedOptions).map(option => option.value),
              cover: currentMetadata?.cover,
              author: currentMetadata?.author,
              year: currentMetadata?.year,
              pages: currentMetadata?.pages,
              category: currentMetadata?.category,
              isbn: currentMetadata?.isbn,
              googleBooksId: currentMetadata?.googleBooksId,
              imdbId: currentMetadata?.imdbId,
            }
          : undefined;

        if (this.type === 'resource' && resourceInput && !skipDuplicateCheck) {
          const candidate: ResourceIdentity = {
            id: '',
            title: titleInput.value,
            mediaType: resourceInput.mediaType,
            sourceUrl: resourceInput.sourceUrl,
            isbn: resourceInput.isbn,
            googleBooksId: resourceInput.googleBooksId,
            imdbId: resourceInput.imdbId,
          };
          const duplicateIds = findResourceDuplicates(candidate, this.resourceIdentities()).map(item => item.id);
          if (duplicateIds.length > 0) {
            this.renderResourceDuplicateWarning(contentEl, duplicateIds, () => { void performCreate(true); });
            return;
          }
        }

        const settings = await this.settingsRepository.load();
        const id = createCanonicalObjectId();
        const documentData = buildQuickAddDocument(settings, this.type, {
          title: titleInput.value,
          body: bodyInput.value,
          date: dateInput?.value,
          time: timeInput?.value,
          resource: resourceInput,
          record: recordInput,
        }, id);
        await this.ensureParentFolders(documentData.path);
        if (this.context.app.vault.getAbstractFileByPath(documentData.path)) {
          throw new Error(`Target already exists: ${documentData.path}`);
        }
        await this.context.app.vault.create(documentData.path, documentData.content);
        new Notice(`${labelForType(this.type)} created`);
        this.close();
      } catch (error) {
        new Notice(`Quick Add blocked: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    create.addEventListener('click', () => { void performCreate(false); });
    contentEl.appendChild(create);
  }

  private getIndex(): VaultIndex | null {
    return this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex() ?? null;
  }

  private trackerDefinitions(): TrackerDefinition[] {
    const index = this.getIndex();
    if (!index) return [];
    const trackers: TrackerDefinition[] = [];
    for (const indexed of index.objects.values()) {
      if (indexed.type !== 'tracker_definition' || indexed.frontmatter.archived === true) continue;
      try {
        const parsed = ObjectParser.parse(ObjectParser.serializeMarkdown(indexed.frontmatter, indexed.body)).object;
        if (parsed.type === 'tracker_definition') trackers.push(parsed);
      } catch {
        // Malformed Trackers fail closed and are not offered for Record creation.
      }
    }
    return trackers.sort((left, right) => left.title.localeCompare(right.title));
  }

  private resourceObjects(): IndexedObject[] {
    const index = this.getIndex();
    if (!index) return [];
    return Array.from(index.objects.values())
      .filter(object => object.type === 'resource' && object.frontmatter.archived !== true)
      .sort((left, right) => String(left.frontmatter.title ?? left.id).localeCompare(String(right.frontmatter.title ?? right.id)));
  }

  private resourceIdentities(): ResourceIdentity[] {
    return this.resourceObjects().map(object => ({
      id: object.id,
      title: String(object.frontmatter.title ?? ''),
      mediaType: String(object.frontmatter.media_type ?? ''),
      sourceUrl: object.frontmatter.source_url == null ? undefined : String(object.frontmatter.source_url),
      isbn: object.frontmatter.isbn == null ? undefined : String(object.frontmatter.isbn),
      googleBooksId: object.frontmatter.google_books_id == null ? undefined : String(object.frontmatter.google_books_id),
      imdbId: object.frontmatter.imdb_id == null ? undefined : String(object.frontmatter.imdb_id),
      archived: object.frontmatter.archived === true,
    }));
  }

  private wikilinkFor(object: IndexedObject): string {
    const target = object.path.replace(/\\/g, '/').replace(/\.md$/i, '');
    return `[[${target}]]`;
  }

  private csvValues(value: string): string[] {
    return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
  }

  private createSelect(label: string, values: string[]): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'quartzo-input';
    select.setAttribute('aria-label', label);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    return select;
  }

  private renderResourceDuplicateWarning(
    container: HTMLElement,
    duplicateIds: string[],
    onCreateAnyway: () => void,
  ): void {
    container.querySelector('.quartzo-resource-duplicate-warning')?.remove();
    const warning = document.createElement('section');
    warning.className = 'quartzo-resource-duplicate-warning';
    const duplicates = duplicateIds
      .map(id => this.getIndex()?.objects.get(id))
      .filter((object): object is IndexedObject => object != null);

    const message = document.createElement('p');
    message.textContent = duplicates.length === 1
      ? `Possible duplicate: ${String(duplicates[0].frontmatter.title ?? duplicates[0].id)}`
      : `Possible duplicates found (${duplicates.length}).`;
    warning.appendChild(message);

    if (duplicates[0]) {
      const openExisting = document.createElement('button');
      openExisting.textContent = 'Open existing';
      openExisting.addEventListener('click', () => { void this.openIndexedObject(duplicates[0]); });
      warning.appendChild(openExisting);
    }

    const createAnyway = document.createElement('button');
    createAnyway.textContent = 'Create anyway';
    createAnyway.addEventListener('click', onCreateAnyway);
    warning.appendChild(createAnyway);

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => warning.remove());
    warning.appendChild(cancel);
    container.appendChild(warning);
  }

  private async openIndexedObject(object: IndexedObject): Promise<void> {
    const file = this.context.app.vault.getAbstractFileByPath(object.path);
    if (file instanceof TFile) {
      await this.context.app.workspace.getLeaf(false).openFile(file);
      this.close();
    }
  }

  private async ensureParentFolders(filePath: string): Promise<void> {
    const segments = normalizePath(filePath).split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.context.app.vault.getAbstractFileByPath(current)) {
        await this.context.app.vault.createFolder(current);
      }
    }
  }
}

export class QuartzoView extends ItemView {
  private section: QuartzoSection = 'home';
  private action: QuartzoAction | null = null;
  private selectedObjectId: string | null = null;
  private selectedDate = isoDate(new Date());
  private plannerMode: 'day' | 'week' | 'month' = 'day';
  private sharedSettingsRepository: SharedSettingsRepository;

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
    });
  }

  private titleForSource(sourceId: string): string {
    const object = this.getIndex()?.objects.get(sourceId);
    return String(object?.frontmatter.title ?? object?.type ?? sourceId);
  }

  private renderScheduleList(container: HTMLElement, items: NormalizedItem[], googleEvents: GoogleCalendarProjection[] = []): void {
    const googleTitles = new Map(googleEvents.map(event => [event.id, event.summary] as const));
    const list = document.createElement('ul');
    for (const item of items) {
      const row = document.createElement('li');
      const time = item.start ? `${item.start} · ` : '';
      const title = item.origin === 'externalEvent'
        ? (googleTitles.get(item.sourceId) ?? item.sourceLabel)
        : this.titleForSource(item.sourceId);
      row.textContent = `${time}${title}`;
      const object = this.getIndex()?.objects.get(item.sourceId);
      if (object) {
        row.className = 'quartzo-clickable';
        row.addEventListener('click', () => this.openObjectDetail(object));
      }
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
          await plugin.confirmPairing(candidate.id, candidate.name, false, false);
          await this.render();
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
      sync.addEventListener('click', async () => {
        const result = await coordinator.triggerManualSync();
        if (result.errors.length > 0) new Notice(result.errors[result.errors.length - 1]);
        else new Notice(`Sync complete: ${result.synced} synced, ${result.conflicts} conflicts`);
        await this.render();
      });
      actions.appendChild(sync);

      const full = document.createElement('button');
      full.textContent = 'Run full reconciliation';
      full.disabled = offline || snapshot?.status === 'syncing';
      full.addEventListener('click', async () => {
        const result = await coordinator.triggerFullReconciliation();
        if (result.errors.length > 0) new Notice(result.errors[result.errors.length - 1]);
        else new Notice(`Full reconciliation complete: ${result.synced} synced, ${result.conflicts} conflicts`);
        await this.render();
      });
      actions.appendChild(full);

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
