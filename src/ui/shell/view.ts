import { ItemView, Modal, Notice, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import type { NormalizedItem } from '../../core/daily_schedule/types';
import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';
import { ObjectParser } from '../../core/objects';
import type { TrackerDefinition } from '../../core/objects/types';
import { findResourceDuplicates, type ResourceIdentity } from '../../core/resource-capture/policy';
import { ResourceMetadataService, type ResourceMetadataDraft } from '../../integrations/resource-metadata/service';
import { addLocalDays, daysInLocalMonth, localIsoDate, parseLocalIsoDate, shiftLocalMonth } from '../../core/local-date';
import { createCanonicalObjectId } from '../../platform/object-id';
import { VaultIndexEngine } from '../../vault/index';
import { renderObjectDetail } from '../detail/object-detail';
import { projectHomeSchedule } from '../home/home-projection';
import { renderTrackerRecordQuickAdd, type TrackerRecordFormController } from '../quick-add/record-form';
import {
  SharedSettingsRepository,
} from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import type { ViewContext } from '../types';

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
    if (this.section === 'journal') this.renderJournal(content);
    if (this.section === 'browse') this.renderBrowse(content);
  }

  private buildSchedule(date: string) {
    return DailyScheduleEngine.normalize({
      date,
      today: isoDate(new Date()),
      objects: scheduleObjects(this.getIndex()),
      googleEvents: [],
    });
  }

  private titleForSource(sourceId: string): string {
    const object = this.getIndex()?.objects.get(sourceId);
    return String(object?.frontmatter.title ?? object?.type ?? sourceId);
  }

  private renderScheduleList(container: HTMLElement, items: NormalizedItem[]): void {
    const list = document.createElement('ul');
    for (const item of items) {
      const row = document.createElement('li');
      const time = item.start ? `${item.start} · ` : '';
      row.textContent = `${time}${this.titleForSource(item.sourceId)}`;
      const object = this.getIndex()?.objects.get(item.sourceId);
      if (object) {
        row.className = 'quartzo-clickable';
        row.addEventListener('click', () => this.openObjectDetail(object));
      }
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  private renderScheduleItems(container: HTMLElement, date: string): void {
    const schedule = this.buildSchedule(date);
    const heading = document.createElement('h3');
    heading.textContent = date;
    container.appendChild(heading);
    if (schedule.items.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing scheduled.';
      container.appendChild(empty);
      return;
    }
    this.renderScheduleList(container, schedule.items);
  }

  private renderHomeBucket(container: HTMLElement, titleText: string, items: NormalizedItem[], emptyText: string): void {
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
      this.renderScheduleList(section, items);
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

    const schedule = this.buildSchedule(this.selectedDate);
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

    this.renderHomeBucket(container, 'Now', projection.now, 'Nothing active right now.');
    this.renderHomeBucket(container, 'Up Next', projection.upNext, 'Nothing timed is coming up.');
    this.renderHomeBucket(container, 'Today', projection.today, 'Nothing scheduled today.');
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
      this.renderScheduleItems(container, this.selectedDate);
      return;
    }

    if (this.plannerMode === 'week') {
      const settings = await this.sharedSettingsRepository.load();
      const startOfWeek = settings?.startOfWeek ?? 1;
      const weekday = selected.getDay();
      const delta = (weekday - startOfWeek + 7) % 7;
      const start = addDays(selected, -delta);
      for (let i = 0; i < 7; i++) this.renderScheduleItems(container, isoDate(addDays(start, i)));
      return;
    }

    const year = selected.getFullYear();
    const month = selected.getMonth();
    const days = daysInLocalMonth(selected);
    for (let day = 1; day <= days; day++) {
      this.renderScheduleItems(container, isoDate(new Date(year, month, day)));
    }
  }

  private renderJournal(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Journal';
    container.appendChild(title);

    const add = document.createElement('button');
    add.textContent = 'New Entry';
    add.addEventListener('click', () => new QuickAddModal(this.context, 'entry').open());
    container.appendChild(add);

    const index = this.getIndex();
    const objects = index ? Array.from(index.objects.values()) : [];
    const relevant = objects.filter(object => {
      if (object.type === 'daily_note') return String(object.frontmatter.date ?? '').startsWith(this.selectedDate);
      if (object.type === 'entry') return String(object.frontmatter.date ?? '').startsWith(this.selectedDate);
      if (object.type === 'tracker_record') return String(object.frontmatter.date ?? '').startsWith(this.selectedDate);
      return false;
    });
    if (relevant.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No journal items for this date.';
      container.appendChild(empty);
      return;
    }
    for (const object of relevant) this.renderObjectRow(container, object);
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
    const status = document.createElement('p');
    status.textContent = `Status: ${plugin.authState.replace(/_/g, ' ')}`;
    container.appendChild(status);

    if (plugin.authState === 'disconnected' || plugin.authState === 'authentication_required') {
      const connect = document.createElement('button');
      connect.textContent = 'Connect Google Drive';
      connect.addEventListener('click', async () => { await plugin.startPairingFlow(); await this.render(); });
      container.appendChild(connect);
      return;
    }

    if (plugin.authState === 'authenticated_unpaired') {
      const candidates = await plugin.driveAdapter?.listQuartzoVaultCandidates() ?? [];
      if (candidates.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No existing Quartzo vault was found.';
        container.appendChild(empty);
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

    if (!conflictsOnly) {
      const folder = document.createElement('p');
      folder.textContent = `Vault: ${plugin.settings.googleDriveFolderName ?? 'Quartzo'}`;
      container.appendChild(folder);
      const sync = document.createElement('button');
      sync.textContent = 'Sync now';
      sync.addEventListener('click', async () => {
        const result = await plugin.driveSyncCoordinator?.triggerManualSync();
        if (result) new Notice(`Sync complete: ${result.synced} synced, ${result.conflicts} conflicts`);
        await this.render();
      });
      container.appendChild(sync);
      const showConflicts = document.createElement('button');
      showConflicts.textContent = 'View conflicts';
      showConflicts.addEventListener('click', () => { void this.handleAction('conflicts'); });
      container.appendChild(showConflicts);
      const disconnect = document.createElement('button');
      disconnect.textContent = 'Disconnect this device';
      disconnect.addEventListener('click', async () => { await plugin.disconnectDrive(); await this.render(); });
      container.appendChild(disconnect);
    }

    const conflicts = plugin.driveSyncCoordinator?.getConflicts() ?? [];
    if (conflicts.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No conflicts.';
      container.appendChild(empty);
      return;
    }
    const decoder = new TextDecoder();
    for (const conflict of conflicts) {
      const card = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = conflict.originalPath;
      card.appendChild(heading);
      const hashes = document.createElement('p');
      hashes.textContent = `Local ${conflict.localSha256.slice(0, 12)} · Drive ${conflict.remoteSha256.slice(0, 12)}`;
      card.appendChild(hashes);
      if (!conflict.isBinary) {
        const local = document.createElement('pre');
        local.textContent = conflict.localExists ? `Local:\n${decoder.decode(conflict.localContent)}` : 'Local: deleted';
        card.appendChild(local);
        const remote = document.createElement('pre');
        remote.textContent = conflict.remoteExists ? `Drive:\n${decoder.decode(conflict.remoteContent)}` : 'Drive: deleted';
        card.appendChild(remote);
      }
      for (const [resolution, label] of [['keep_local', 'Keep local'], ['keep_drive', 'Keep Drive']] as const) {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', async () => {
          await plugin.driveSyncCoordinator?.resolveConflict(conflict.originalPath, resolution);
          await this.render();
        });
        card.appendChild(button);
      }
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
