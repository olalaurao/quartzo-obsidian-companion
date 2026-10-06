import { Modal, Notice, TFile, normalizePath } from 'obsidian';
import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';
import { ObjectParser } from '../../core/objects';
import type { TrackerDefinition } from '../../core/objects/types';
import {
  findResourceDuplicates,
  normalizeResourceMediaType,
  resourceMediaTypeSuggestions,
  resourceStatusLabel,
  type ResourceIdentity,
  type ResourceStatus,
} from '../../core/resource-capture/policy';
import { localIsoDate } from '../../core/local-date';
import { queryVaultObjects } from '../../core/object-query';
import { ResourceMetadataService, type ResourceMetadataDraft } from '../../integrations/resource-metadata/service';
import { createCanonicalObjectId } from '../../platform/object-id';
import { VaultIndexEngine } from '../../vault/index';
import {
  SharedSettingsRepository,
} from '../../vault/shared-settings';
import { ObjectCreationRepository } from '../../vault/object-creation';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import { renderTrackerRecordQuickAdd, type TrackerRecordFormController } from './record-form';
import { renderLinkCaptureQuickAdd } from './link-capture/view';
import type { ViewContext } from '../types';

function isoDate(date: Date): string {
  return localIsoDate(date);
}

function labelForType(type: string): string {
  if (type === 'tracker_record') return 'Record';
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export interface QuickAddModalOptions {
  initialTrackerId?: string;
  trackerReferenceId?: string;
  onCreated?(created: { id: string; type: QuickAddType; path: string }): void | Promise<void>;
  onClosed?(): void;
}

export class QuickAddModal extends Modal {
  private type: QuickAddType = 'task';
  private settingsRepository: SharedSettingsRepository;
  private objectCreationRepository: ObjectCreationRepository;
  private readonly resourceMetadataService = new ResourceMetadataService();

  constructor(
    private readonly context: ViewContext,
    initialType?: QuickAddType,
    private readonly options: QuickAddModalOptions = {},
  ) {
    super(context.app);
    if (initialType) this.type = initialType;
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
    this.objectCreationRepository = new ObjectCreationRepository(context.app.vault);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.options.onClosed?.();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const title = document.createElement('h2');
    title.textContent = 'Quick Add';
    contentEl.appendChild(title);

    const saveLink = document.createElement('button');
    saveLink.type = 'button';
    saveLink.className = 'mod-cta';
    saveLink.textContent = 'Save link';
    saveLink.addEventListener('click', () => {
      renderLinkCaptureQuickAdd(contentEl, this.context, {
        settingsRepository: this.settingsRepository,
        getIndex: () => this.getIndex(),
        createDocument: (type, document) => this.objectCreationRepository.create(type, document, 'capture_created'),
        openIndexedObject: object => this.openIndexedObject(object),
        onCreated: this.options.onCreated,
        close: () => this.close(),
        back: () => this.render(),
      });
    });
    contentEl.appendChild(saveLink);

    const typeSelect = document.createElement('select');
    typeSelect.setAttribute('aria-label', 'Quick Add type');
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
    titleInput.setAttribute('aria-label', this.type === 'entry' ? 'Entry title optional' : `${labelForType(this.type)} title`);
    titleInput.className = 'quartzo-input';
    if (this.type !== 'tracker_record') contentEl.appendChild(titleInput);

    const bodyInput = document.createElement('textarea');
    bodyInput.placeholder = this.type === 'resource' ? 'Synopsis or notes' : 'Content';
    bodyInput.setAttribute('aria-label', this.type === 'resource' ? 'Synopsis or notes' : 'Content');
    bodyInput.className = 'quartzo-input';
    if (this.type !== 'tracker_record') contentEl.appendChild(bodyInput);

    let dateInput: HTMLInputElement | null = null;
    let timeInput: HTMLInputElement | null = null;
    if (this.type === 'entry' || this.type === 'reminder') {
      dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.setAttribute('aria-label', `${labelForType(this.type)} date`);
      dateInput.value = isoDate(new Date());
      contentEl.appendChild(dateInput);
      timeInput = document.createElement('input');
      timeInput.type = 'time';
      timeInput.setAttribute('aria-label', `${labelForType(this.type)} time`);
      timeInput.value = this.type === 'reminder' ? '09:00' : new Date().toTimeString().slice(0, 5);
      contentEl.appendChild(timeInput);
    }

    let recordForm: TrackerRecordFormController | null = null;
    if (this.type === 'tracker_record') {
      recordForm = renderTrackerRecordQuickAdd(
        contentEl,
        this.trackerDefinitions(),
        isoDate(new Date()),
        this.options.initialTrackerId,
      );
    }

    let sourceUrlInput: HTMLInputElement | null = null;
    let mediaTypeInput: HTMLInputElement | null = null;
    let prioritySelect: HTMLSelectElement | null = null;
    let statusSelect: HTMLSelectElement | null = null;
    let categoriesInput: HTMLInputElement | null = null;
    let tagsInput: HTMLInputElement | null = null;
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
      sourceUrlInput.setAttribute('aria-label', 'Source URL optional');
      sourceUrlInput.className = 'quartzo-input';
      sourceUrlInput.addEventListener('input', () => { resourceMetadata = null; });
      contentEl.appendChild(sourceUrlInput);

      mediaTypeInput = document.createElement('input');
      mediaTypeInput.className = 'quartzo-input';
      mediaTypeInput.setAttribute('aria-label', 'Resource type');
      mediaTypeInput.setAttribute('list', 'quartzo-resource-media-types');
      mediaTypeInput.value = 'General';
      mediaTypeInput.addEventListener('input', () => {
        mediaTypeEdited = true;
        if (statusSelect) this.updateResourceStatusLabels(statusSelect, mediaTypeInput?.value ?? 'General');
      });
      const mediaTypeOptions = document.createElement('datalist');
      mediaTypeOptions.id = 'quartzo-resource-media-types';
      for (const value of this.resourceMediaTypeSuggestions()) {
        const option = document.createElement('option');
        option.value = value;
        mediaTypeOptions.appendChild(option);
      }
      contentEl.appendChild(mediaTypeInput);
      contentEl.appendChild(mediaTypeOptions);

      const metadataStatus = document.createElement('small');
      metadataStatus.setAttribute('role', 'status');
      metadataStatus.setAttribute('aria-live', 'polite');
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
          if (!mediaTypeEdited && metadata.mediaType && mediaTypeInput) {
            mediaTypeInput.value = normalizeResourceMediaType(metadata.mediaType);
            if (statusSelect) this.updateResourceStatusLabels(statusSelect, mediaTypeInput.value);
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
      this.updateResourceStatusLabels(statusSelect, mediaTypeInput.value);
      contentEl.appendChild(statusSelect);

      categoriesInput = document.createElement('input');
      categoriesInput.type = 'text';
      categoriesInput.placeholder = 'Categories, comma separated';
      categoriesInput.setAttribute('aria-label', 'Categories comma separated');
      categoriesInput.className = 'quartzo-input';
      contentEl.appendChild(categoriesInput);

      tagsInput = document.createElement('input');
      tagsInput.type = 'text';
      tagsInput.placeholder = 'Tags, comma separated';
      tagsInput.setAttribute('aria-label', 'Tags comma separated');
      tagsInput.className = 'quartzo-input';
      contentEl.appendChild(tagsInput);

      relationsSelect = document.createElement('select');
      relationsSelect.multiple = true;
      relationsSelect.className = 'quartzo-input';
      relationsSelect.setAttribute('aria-label', 'Related objects');
      for (const object of this.linkableObjects()) {
        const option = document.createElement('option');
        option.value = this.wikilinkFor(object);
        option.textContent = `${String(object.frontmatter.title ?? object.id)} · ${object.type}`;
        relationsSelect.appendChild(option);
      }
      contentEl.appendChild(relationsSelect);
      const relationHint = document.createElement('small');
      relationHint.textContent = 'Related objects (use Ctrl/Cmd to select more than one).';
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
        const rawRecordInput = this.type === 'tracker_record' ? recordForm?.value() : undefined;
        const recordInput = rawRecordInput && this.options.trackerReferenceId
          ? { ...rawRecordInput, trackerId: this.options.trackerReferenceId }
          : rawRecordInput;
        const resourceInput = this.type === 'resource'
          ? {
              mediaType: mediaTypeInput?.value ?? '',
              sourceUrl: currentResourceUrl || undefined,
              priority: (prioritySelect?.value ?? 'none') as 'none' | 'low' | 'medium' | 'high',
              status: (statusSelect?.value ?? 'toConsume') as 'toConsume' | 'inProgress' | 'completed' | 'dropped',
              categories: this.csvValues(categoriesInput?.value ?? ''),
              tags: this.csvValues(tagsInput?.value ?? ''),
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
            mediaType: normalizeResourceMediaType(resourceInput.mediaType),
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
        const created = await this.objectCreationRepository.create(this.type, documentData);
        await this.options.onCreated?.(created);
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
    for (const indexed of queryVaultObjects(index, { types: ['tracker_definition'] })) {
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
    return queryVaultObjects(index, { types: ['resource'] });
  }

  private resourceMediaTypeSuggestions(): string[] {
    const existing: string[] = [];
    for (const object of this.resourceObjects()) {
      const raw = object.frontmatter.media_type;
      if (typeof raw === 'string' && raw.trim()) existing.push(raw);
    }
    return resourceMediaTypeSuggestions({ existing });
  }

  private linkableObjects(): IndexedObject[] {
    return queryVaultObjects(this.getIndex());
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

  private updateResourceStatusLabels(select: HTMLSelectElement, mediaType: string): void {
    for (const option of Array.from(select.options)) {
      option.textContent = resourceStatusLabel(option.value as ResourceStatus, mediaType);
    }
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

}
