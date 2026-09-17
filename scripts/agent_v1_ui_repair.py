from pathlib import Path
import re

ROOT = Path('.')

def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8', newline='\n')

shared_settings = r'''import { TFile, Vault, normalizePath } from 'obsidian';
import { ObjectParser } from '../core/objects';
import type { ObjectType, ParseResult } from '../core/objects/types';

export const SHARED_SETTINGS_PATH = 'app/quartzo_shared_settings.md';

export type MarkerType = 'tag' | 'property' | 'folder';

export interface TypeSignature {
  objectType: string;
  markerType: MarkerType;
  markerValue: string;
  emoji?: string;
  iconName?: string | null;
  colorHex?: string | null;
}

export interface QuartzoSharedSettings {
  schemaVersion: number;
  typeSignatures: Record<string, TypeSignature>;
  folderPaths: Record<string, string>;
  categoryColors: Record<string, string>;
  accentColor: string;
  plannerColorMode: string;
  plannerVisibleKinds: string[];
  plannerShowAdaptiveTimeBlocks: boolean;
  startOfWeek: number;
  dayStartHour: number;
  showDayDialLegend: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> {
  const source = asRecord(value);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, String(item)]));
}

function normalizeFolder(value: string): string {
  return normalizePath(value.trim().replace(/^\/+|\/+$/g, ''));
}

function parseSignature(value: unknown, key: string): TypeSignature | null {
  const raw = asRecord(value);
  const markerType = String(raw.markerType ?? '');
  const markerValue = String(raw.markerValue ?? '');
  if (!['tag', 'property', 'folder'].includes(markerType) || !markerValue.trim()) return null;
  return {
    objectType: String(raw.objectType ?? key),
    markerType: markerType as MarkerType,
    markerValue,
    emoji: raw.emoji == null ? undefined : String(raw.emoji),
    iconName: raw.iconName == null ? null : String(raw.iconName),
    colorHex: raw.colorHex == null ? null : String(raw.colorHex),
  };
}

export function parseSharedSettings(markdown: string): QuartzoSharedSettings | null {
  const parsed = ObjectParser.parseMarkdown(markdown);
  const fm = parsed.frontmatter;
  if (fm.type !== 'quartzo_shared_settings') return null;

  const rawSignatures = asRecord(fm.type_signatures);
  const typeSignatures: Record<string, TypeSignature> = {};
  for (const [key, value] of Object.entries(rawSignatures)) {
    const signature = parseSignature(value, key);
    if (signature) typeSignatures[key] = signature;
  }

  const planner = asRecord(fm.planner);
  const calendar = asRecord(fm.calendar);
  const day = asRecord(fm.day);
  const dayDial = asRecord(fm.day_dial);
  const visibleKinds = Array.isArray(planner.visible_kinds)
    ? planner.visible_kinds.map(value => String(value))
    : [];

  return {
    schemaVersion: Number(fm.schema_version ?? 1),
    typeSignatures,
    folderPaths: stringMap(fm.folder_paths),
    categoryColors: stringMap(fm.category_colors),
    accentColor: String(fm.accent_color ?? '#F97316'),
    plannerColorMode: String(planner.color_mode ?? 'category'),
    plannerVisibleKinds: visibleKinds,
    plannerShowAdaptiveTimeBlocks: planner.show_adaptive_time_blocks !== false,
    startOfWeek: Number(calendar.start_of_week ?? 1),
    dayStartHour: Number(day.start_hour ?? 0),
    showDayDialLegend: dayDial.show_legend !== false,
  };
}

export class SharedSettingsRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<QuartzoSharedSettings | null> {
    const file = this.vault.getAbstractFileByPath(SHARED_SETTINGS_PATH);
    if (!(file instanceof TFile)) return null;
    const markdown = await this.vault.read(file);
    return parseSharedSettings(markdown);
  }
}

export function resolveTypeSignature(
  settings: QuartzoSharedSettings | null,
  objectType: string,
): TypeSignature | null {
  if (!settings) return null;
  return settings.typeSignatures[objectType]
    ?? Object.values(settings.typeSignatures).find(signature => signature.objectType === objectType)
    ?? null;
}

export function resolveCreationFolder(
  settings: QuartzoSharedSettings | null,
  objectType: string,
): string | null {
  if (!settings) return null;
  const signature = resolveTypeSignature(settings, objectType);
  if (signature?.markerType === 'folder') {
    const folder = normalizeFolder(signature.markerValue);
    return folder || null;
  }
  const configured = settings.folderPaths[objectType];
  if (!configured) return null;
  const folder = normalizeFolder(configured);
  return folder || null;
}

export function applyTypeSignature(
  frontmatter: Record<string, unknown>,
  body: string,
  signature: TypeSignature | null,
): { frontmatter: Record<string, unknown>; body: string } {
  if (!signature) return { frontmatter: { ...frontmatter }, body };
  const next = { ...frontmatter };
  if (signature.markerType === 'property') {
    const separator = signature.markerValue.indexOf(':');
    if (separator >= 0) {
      const key = signature.markerValue.slice(0, separator).trim();
      const value = signature.markerValue.slice(separator + 1).trim();
      if (key) next[key] = value;
    } else {
      const key = signature.markerValue.trim();
      if (key) next[key] = true;
    }
  }
  if (signature.markerType === 'tag') {
    const marker = signature.markerValue.trim();
    if (marker && !body.split(/\s+/).includes(marker)) {
      body = body.trimEnd() + (body.trim() ? '\n\n' : '') + marker;
    }
  }
  return { frontmatter: next, body };
}

function propertySignatureMatches(
  frontmatter: Record<string, unknown>,
  markerValue: string,
): boolean {
  const separator = markerValue.indexOf(':');
  if (separator < 0) return frontmatter[markerValue.trim()] === true;
  const key = markerValue.slice(0, separator).trim();
  const expected = markerValue.slice(separator + 1).trim().toLowerCase();
  const actual = frontmatter[key];
  if (Array.isArray(actual)) {
    return actual.some(item => String(item).trim().toLowerCase() === expected);
  }
  return String(actual ?? '').trim().toLowerCase() === expected;
}

function tagSignatureMatches(
  frontmatter: Record<string, unknown>,
  body: string,
  markerValue: string,
): boolean {
  const marker = markerValue.trim();
  const normalized = marker.replace(/^#/, '');
  const tags = frontmatter.tags;
  if (Array.isArray(tags) && tags.some(tag => String(tag).replace(/^#/, '') === normalized)) return true;
  const token = marker.startsWith('#') ? marker : `#${marker}`;
  return body.split(/\s+/).includes(token) || body.split(/\s+/).includes(marker);
}

export function identifyTypeFromSignatures(
  settings: QuartzoSharedSettings | null,
  filePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): ObjectType | null {
  if (!settings) return null;
  const normalizedPath = normalizePath(filePath);
  const matches = new Set<string>();

  for (const signature of Object.values(settings.typeSignatures)) {
    let matched = false;
    if (signature.markerType === 'folder') {
      const folder = normalizeFolder(signature.markerValue);
      matched = normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
    } else if (signature.markerType === 'property') {
      matched = propertySignatureMatches(frontmatter, signature.markerValue);
    } else if (signature.markerType === 'tag') {
      matched = tagSignatureMatches(frontmatter, body, signature.markerValue);
    }
    if (matched) matches.add(signature.objectType);
  }

  if (matches.size !== 1) return null;
  return [...matches][0] as ObjectType;
}

export function parseObjectWithSharedSettings(
  markdown: string,
  filePath: string,
  settings: QuartzoSharedSettings | null,
): ParseResult {
  try {
    return ObjectParser.parse(markdown);
  } catch (originalError) {
    const parsed = ObjectParser.parseMarkdown(markdown);
    const identified = identifyTypeFromSignatures(settings, filePath, parsed.frontmatter, parsed.body);
    if (!identified) throw originalError;
    return ObjectParser.parse(ObjectParser.serializeMarkdown(
      { ...parsed.frontmatter, type: identified },
      parsed.body,
    ));
  }
}
'''
write('src/vault/shared-settings.ts', shared_settings)

shell_view = r'''import { ItemView, Modal, Notice, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import { ObjectParser } from '../../core/objects';
import type { ObjectType } from '../../core/objects/types';
import { VaultIndexEngine } from '../../vault/index';
import {
  SharedSettingsRepository,
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import type { ViewContext } from '../types';

export const QUARTZO_VIEW_TYPE = 'quartzo-view';
export type QuartzoSection = 'home' | 'planner' | 'journal' | 'browse';
export type QuartzoAction = 'search' | 'add' | 'sync' | 'conflicts' | 'settings';
export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder';

interface QuickAddInput {
  title: string;
  body: string;
  date?: string;
  time?: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function labelForType(type: string): string {
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

export function buildQuickAddDocument(
  settings: QuartzoSharedSettings | null,
  type: QuickAddType,
  input: QuickAddInput,
  id: string,
): { path: string; content: string } {
  const folder = resolveCreationFolder(settings, type);
  if (!folder) {
    throw new Error(`No canonical creation folder is configured for ${type}. Configure Object Identification in Quartzo first.`);
  }

  const title = input.title.trim() || (type === 'entry' ? 'Journal Entry' : 'Untitled');
  const frontmatter: Record<string, unknown> = { id, type, title };
  if (type === 'entry') {
    frontmatter.date = input.date ?? isoDate(new Date());
    if (input.time) frontmatter.time = input.time;
  }
  if (type === 'reminder') {
    frontmatter.date = input.date ?? isoDate(new Date());
    frontmatter.time = input.time ?? '09:00';
    frontmatter.is_completed = false;
    frontmatter.reminder_id = id;
    frontmatter.reminder_count = 1;
  }

  const signature = resolveTypeSignature(settings, type);
  const signed = applyTypeSignature(frontmatter, input.body, signature);
  const path = normalizePath(`${folder}/${id}.md`);
  const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
  const roundtrip = ObjectParser.parse(content);
  if (roundtrip.object.id !== id || roundtrip.object.type !== type) {
    throw new Error(`Creation roundtrip failed for ${type}`);
  }
  return { path, content };
}

class QuickAddModal extends Modal {
  private type: QuickAddType = 'task';
  private settingsRepository: SharedSettingsRepository;

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
    for (const type of ['task', 'entry', 'note', 'reminder'] as QuickAddType[]) {
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
    contentEl.appendChild(titleInput);

    const bodyInput = document.createElement('textarea');
    bodyInput.placeholder = 'Content';
    bodyInput.className = 'quartzo-input';
    contentEl.appendChild(bodyInput);

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

    const create = document.createElement('button');
    create.textContent = `Create ${labelForType(this.type)}`;
    create.className = 'mod-cta';
    create.addEventListener('click', async () => {
      try {
        const settings = await this.settingsRepository.load();
        const id = `${this.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const documentData = buildQuickAddDocument(settings, this.type, {
          title: titleInput.value,
          body: bodyInput.value,
          date: dateInput?.value,
          time: timeInput?.value,
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
    });
    contentEl.appendChild(create);
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
    await this.render();
  }

  async handleAction(action: QuartzoAction): Promise<void> {
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
    const list = document.createElement('ul');
    for (const item of schedule.items) {
      const row = document.createElement('li');
      const time = item.start ? `${item.start} · ` : '';
      row.textContent = `${time}${this.titleForSource(item.sourceId)}`;
      const object = this.getIndex()?.objects.get(item.sourceId);
      if (object) {
        row.className = 'quartzo-clickable';
        row.addEventListener('click', () => this.openMarkdown(object));
      }
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  private async renderHome(container: HTMLElement): Promise<void> {
    const title = document.createElement('h2');
    title.textContent = 'Home';
    container.appendChild(title);
    const dial = document.createElement('section');
    const dialTitle = document.createElement('h3');
    dialTitle.textContent = 'Day Dial';
    dial.appendChild(dialTitle);
    const schedule = this.buildSchedule(this.selectedDate);
    const summary = document.createElement('p');
    summary.textContent = `${schedule.count} item${schedule.count === 1 ? '' : 's'} on today’s canonical Daily Schedule.`;
    dial.appendChild(summary);
    container.appendChild(dial);
    this.renderScheduleItems(container, this.selectedDate);
  }

  private async renderPlanner(container: HTMLElement): Promise<void> {
    const title = document.createElement('h2');
    title.textContent = 'Planner';
    container.appendChild(title);

    const controls = document.createElement('div');
    const previous = document.createElement('button');
    previous.textContent = '‹';
    previous.addEventListener('click', () => {
      const step = this.plannerMode === 'week' ? -7 : this.plannerMode === 'month' ? -30 : -1;
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));
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
      const step = this.plannerMode === 'week' ? 7 : this.plannerMode === 'month' ? 30 : 1;
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));
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
      const weekday = selected.getUTCDay();
      const delta = (weekday - startOfWeek + 7) % 7;
      const start = addDays(selected, -delta);
      for (let i = 0; i < 7; i++) this.renderScheduleItems(container, isoDate(addDays(start, i)));
      return;
    }

    const year = selected.getUTCFullYear();
    const month = selected.getUTCMonth();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      this.renderScheduleItems(container, isoDate(new Date(Date.UTC(year, month, day))));
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
    row.addEventListener('click', () => this.openMarkdown(object));
    container.appendChild(row);
  }

  private openMarkdown(object: IndexedObject): void {
    void this.context.app.workspace.openLinkText(object.path, '', true);
  }
}
'''
write('src/ui/shell/view.ts', shell_view)

index_engine_path = ROOT / 'src/vault/index/engine.ts'
engine = index_engine_path.read_text(encoding='utf-8')
engine = engine.replace(
    "import { VaultFile, IndexedObject, VaultIndex, IndexChange } from './types';",
    "import { VaultFile, IndexedObject, VaultIndex, IndexChange } from './types';\nimport type { ParseResult } from '../../core/objects/types';",
)
engine = engine.replace(
    '  static createInitialIndex(files: VaultFile[]): VaultIndex {',
    '  static createInitialIndex(\n    files: VaultFile[],\n    parseFile: (content: string, path: string) => ParseResult = (content) => ObjectParser.parse(content),\n  ): VaultIndex {',
)
engine = engine.replace('        const result = ObjectParser.parse(file.content);', '        const result = parseFile(file.content, file.path);')
write('src/vault/index/engine.ts', engine)

write('src/ui/index.ts', "export * from './types';\nexport * from './shell/view';\n")

ui_types_path = ROOT / 'src/ui/types.ts'
ui_types = ui_types_path.read_text(encoding='utf-8')
ui_types = ui_types.replace('    adoptFile(filePath: string): Promise<void>;\n', '    adoptFile(filePath: string): Promise<void>;\n    openSettings(): void;\n')
write('src/ui/types.ts', ui_types)

main_path = ROOT / 'src/main.ts'
main = main_path.read_text(encoding='utf-8')
main = main.replace(
    "import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, ItemView, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';",
    "import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';",
)
main = main.replace(
    "import { HomeView, PlannerView, DayDialView, JournalView, BrowseView, SearchView, QuickAddView, ConflictCenterView } from './ui';",
    "import { QuartzoView, QUARTZO_VIEW_TYPE, type QuartzoSection, type QuartzoAction } from './ui';",
)
main = main.replace("import { ObjectParser } from './core/objects';\n", "")
main = main.replace(
    "import { VaultSyncFilePolicy } from './sync/coordinator/file-policy';\n",
    "import { VaultSyncFilePolicy } from './sync/coordinator/file-policy';\nimport { SHARED_SETTINGS_PATH, SharedSettingsRepository, parseObjectWithSharedSettings, type QuartzoSharedSettings } from './vault/shared-settings';\n",
)
main = re.sub(r"\nconst HOME_VIEW_TYPE = 'quartzo-home-view';[\s\S]*?const CONFLICT_CENTER_VIEW_TYPE = 'quartzo-conflict-center-view';\n", "\n", main, count=1)
main = re.sub(r"\nclass SyncCenterView extends ItemView \{[\s\S]*?\n\}\n\nexport default class QuartzoCompanionPlugin", "\nexport default class QuartzoCompanionPlugin", main, count=1)
main = main.replace(
    "  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];\n",
    "  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];\n  private sharedSettingsRepository: SharedSettingsRepository | null = null;\n  private sharedSettings: QuartzoSharedSettings | null = null;\n",
)
main = main.replace("        currentView: HOME_VIEW_TYPE,", "        currentView: 'home',")
register_pattern = re.compile(r"    this\.registerView\(HOME_VIEW_TYPE,[\s\S]*?    this\.registerView\(CONFLICT_CENTER_VIEW_TYPE, \(leaf\) => new ConflictCenterView\(leaf, this\.viewContext!\)\);\n")
main, register_count = register_pattern.subn("    this.registerView(QUARTZO_VIEW_TYPE, (leaf) => new QuartzoView(leaf, this.viewContext!));\n", main, count=1)
if register_count != 1:
    raise RuntimeError('Could not replace legacy view registrations')
main = main.replace("      this.activateView(HOME_VIEW_TYPE);", "      void this.activateQuartzo('home');")
command_block = re.compile(r"    this\.addCommand\(\{ id: 'quartzo-open',[\s\S]*?    this\.addCommand\(\{ id: 'quartzo-conflict-center'.*?\n", re.MULTILINE)
replacement_commands = """    this.addCommand({ id: 'quartzo-open', name: 'Quartzo: Open', callback: () => { void this.activateQuartzo('home'); } });
    this.addCommand({ id: 'quartzo-planner', name: 'Quartzo: Planner', callback: () => { void this.activateQuartzo('planner'); } });
    this.addCommand({ id: 'quartzo-day-dial', name: 'Quartzo: Day Dial', callback: () => { void this.activateQuartzo('home'); } });
    this.addCommand({ id: 'quartzo-journal', name: 'Quartzo: Journal', callback: () => { void this.activateQuartzo('journal'); } });
    this.addCommand({ id: 'quartzo-browse', name: 'Quartzo: Browse', callback: () => { void this.activateQuartzo('browse'); } });
    this.addCommand({ id: 'quartzo-search', name: 'Quartzo: Search', callback: () => { void this.activateQuartzo('browse', 'search'); } });
    this.addCommand({ id: 'quartzo-quick-add', name: 'Quartzo: Quick Add', callback: () => { void this.activateQuartzo('home', 'add'); } });
    this.addCommand({ id: 'quartzo-sync-center', name: 'Quartzo: Sync', callback: () => { void this.activateQuartzo('home', 'sync'); } });
    this.addCommand({ id: 'quartzo-conflict-center', name: 'Quartzo: Conflicts', callback: () => { void this.activateQuartzo('home', 'conflicts'); } });
"""
main, command_count = command_block.subn(replacement_commands, main, count=1)
if command_count != 1:
    raise RuntimeError('Could not replace legacy command block')
main = main.replace(
    "    await this.initializeVaultIndex();\n",
    "    this.sharedSettingsRepository = new SharedSettingsRepository(this.app.vault);\n    this.sharedSettings = await this.sharedSettingsRepository.load();\n    await this.initializeVaultIndex();\n",
    1,
)
main = main.replace(
    "    const index = VaultIndexEngine.createInitialIndex(vaultFiles);",
    "    const index = VaultIndexEngine.createInitialIndex(\n      vaultFiles,\n      (content, filePath) => parseObjectWithSharedSettings(content, filePath, this.sharedSettings),\n    );",
)
main = main.replace(
    "              const result = ObjectParser.parse(content);",
    "              const result = parseObjectWithSharedSettings(content, file.path, this.sharedSettings);",
)
main = main.replace(
    "          const result = ObjectParser.parse(content);",
    "          const result = parseObjectWithSharedSettings(content, file.path, this.sharedSettings);",
)
# shared settings reload on create/modify/rename
main = main.replace(
    "    const oncreate = this.app.vault.on('create', (file: TAbstractFile) => {\n",
    "    const oncreate = this.app.vault.on('create', (file: TAbstractFile) => {\n      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }\n",
)
main = main.replace(
    "    const onmodify = this.app.vault.on('modify', (file: TAbstractFile) => {\n",
    "    const onmodify = this.app.vault.on('modify', (file: TAbstractFile) => {\n      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }\n",
)
main = main.replace(
    "    const onrename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {\n",
    "    const onrename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {\n      if (normalizeVaultPath(oldPath) === SHARED_SETTINGS_PATH || normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }\n",
)
activate_pattern = re.compile(r"  async activateView\(viewType: string\) \{[\s\S]*?\n  \}\n\n  showFirstRunDialog\(\)")
activate_replacement = r'''  async activateQuartzo(section: QuartzoSection = 'home', action?: QuartzoAction) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (!leaf) {
      const newLeaf = workspace.getRightLeaf(false);
      if (!newLeaf) return;
      leaf = newLeaf;
    }
    await leaf.setViewState({ type: QUARTZO_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
    if (leaf.view instanceof QuartzoView) {
      await leaf.view.setSection(section);
      if (action) await leaf.view.handleAction(action);
    }
  }

  openSettings(): void {
    const appWithSettings = this.app as App & { setting?: { open(): void; openTabById(id: string): void } };
    appWithSettings.setting?.open();
    appWithSettings.setting?.openTabById(this.manifest.id);
  }

  private async reloadSharedSettingsAndIndex(): Promise<void> {
    this.sharedSettings = await this.sharedSettingsRepository?.load() ?? null;
    await this.initializeVaultIndex();
    const leaf = this.app.workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (leaf?.view instanceof QuartzoView) await leaf.view.refresh();
  }

  showFirstRunDialog()'''
main, activate_count = activate_pattern.subn(activate_replacement, main, count=1)
if activate_count != 1:
    raise RuntimeError('Could not replace activateView')
main = main.replace("      this.activateView(SYNC_CENTER_VIEW_TYPE);", "      void this.activateQuartzo('home', 'sync');")
write('src/main.ts', main)

# Remove legacy top-level clone views. Their logic is replaced by the single shell.
for legacy in [
    'src/ui/home/view.ts',
    'src/ui/planner/view.ts',
    'src/ui/day-dial/view.ts',
    'src/ui/journal/view.ts',
    'src/ui/browse/view.ts',
    'src/ui/search/view.ts',
    'src/ui/quick-add/view.ts',
    'src/ui/conflict-center/view.ts',
]:
    p = ROOT / legacy
    if p.exists(): p.unlink()

shared_tests = r'''import { describe, expect, it } from 'vitest';
import {
  applyTypeSignature,
  identifyTypeFromSignatures,
  parseObjectWithSharedSettings,
  parseSharedSettings,
  resolveCreationFolder,
} from '../../src/vault/shared-settings';

describe('shared Quartzo settings interoperability', () => {
  const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  task:
    objectType: task
    markerType: property
    markerValue: kind: task
  note:
    objectType: note
    markerType: folder
    markerValue: knowledge/notes
  entry:
    objectType: entry
    markerType: tag
    markerValue: "#journal"
folder_paths:
  task: work/tasks
  entry: journal
accent_color: "#123456"
planner:
  color_mode: type
  visible_kinds: [task, reminder]
calendar:
  start_of_week: 0
---
# Settings
`)!;

  it('parses canonical shared settings and resolves creation paths', () => {
    expect(settings.accentColor).toBe('#123456');
    expect(settings.startOfWeek).toBe(0);
    expect(resolveCreationFolder(settings, 'task')).toBe('work/tasks');
    expect(resolveCreationFolder(settings, 'note')).toBe('knowledge/notes');
    expect(resolveCreationFolder(settings, 'reminder')).toBeNull();
  });

  it('applies property and tag signatures without inventing a folder', () => {
    const task = applyTypeSignature({ id: 't1', type: 'task' }, 'Body', settings.typeSignatures.task);
    expect(task.frontmatter.kind).toBe('task');
    const entry = applyTypeSignature({ id: 'e1', type: 'entry' }, 'Text', settings.typeSignatures.entry);
    expect(entry.body).toContain('#journal');
  });

  it('identifies an object by exactly one canonical signature when type is absent', () => {
    expect(identifyTypeFromSignatures(settings, 'knowledge/notes/a.md', { id: 'n1' }, 'Body')).toBe('note');
    const parsed = parseObjectWithSharedSettings(`---\nid: n1\ntitle: Hello\n---\nBody`, 'knowledge/notes/a.md', settings);
    expect(parsed.object.type).toBe('note');
    expect(parsed.object.id).toBe('n1');
  });

  it('fails closed when signatures are ambiguous', () => {
    const ambiguous = {
      ...settings,
      typeSignatures: {
        a: { objectType: 'task', markerType: 'folder' as const, markerValue: 'same' },
        b: { objectType: 'note', markerType: 'folder' as const, markerValue: 'same' },
      },
    };
    expect(identifyTypeFromSignatures(ambiguous, 'same/file.md', { id: 'x' }, '')).toBeNull();
  });
});
'''
write('tests/vault/shared-settings.test.ts', shared_tests)

ui_tests = r'''import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/ui/shell/view';
import { parseSharedSettings } from '../../src/vault/shared-settings';
import { ObjectParser } from '../../src/core/objects';
import fs from 'fs';
import path from 'path';

describe('Companion V1 shell contract', () => {
  const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  task:
    objectType: task
    markerType: property
    markerValue: kind: task
  entry:
    objectType: entry
    markerType: tag
    markerValue: "#journal"
  note:
    objectType: note
    markerType: folder
    markerValue: notes/custom
  reminder:
    objectType: reminder
    markerType: property
    markerValue: kind: reminder
folder_paths:
  task: tasks/custom
  entry: journal/custom
  reminder: reminders/custom
---
`)!;

  it.each([
    ['task', { title: 'Prepare campaign', body: 'Draft' }],
    ['entry', { title: 'Reflection', body: 'Text', date: '2026-09-16', time: '20:00' }],
    ['note', { title: 'Idea', body: 'Text' }],
    ['reminder', { title: 'Call', body: '', date: '2026-09-17', time: '09:45' }],
  ] as const)('creates %s through canonical settings and roundtrips', (type, input) => {
    const built = buildQuickAddDocument(settings, type, input, `${type}-fixture`);
    const parsed = ObjectParser.parse(built.content);
    expect(parsed.object.type).toBe(type);
    expect(parsed.object.id).toBe(`${type}-fixture`);
    expect(built.path).not.toMatch(/^tasks\//i.test(type) ? /$a/ : /$a/);
  });

  it('uses configured/folder-signature paths rather than hardcoded plural folders', () => {
    expect(buildQuickAddDocument(settings, 'task', { title: 'T', body: '' }, 't1').path).toBe('tasks/custom/t1.md');
    expect(buildQuickAddDocument(settings, 'note', { title: 'N', body: '' }, 'n1').path).toBe('notes/custom/n1.md');
  });

  it('registers one primary workspace view and no legacy top-level clones', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    expect((main.match(/registerView\(/g) ?? []).length).toBe(1);
    expect(main).toContain('QUARTZO_VIEW_TYPE');
    expect(main).not.toContain("registerView(HOME_VIEW_TYPE");
    expect(main).not.toContain("registerView(QUICK_ADD_VIEW_TYPE");
  });
});
'''
# Remove the intentionally meaningless assertion generated above and keep the real path assertions.
ui_tests = ui_tests.replace("    expect(built.path).not.toMatch(/^tasks\\//i.test(type) ? /$a/ : /$a/);\n", "")
write('tests/contracts/ui_shell.test.ts', ui_tests)

architecture_path = ROOT / 'scripts/architecture-check.mjs'
architecture = architecture_path.read_text(encoding='utf-8')
insert = r'''
function checkSingleQuartzoWorkspaceView() {
  const mainPath = path.join(rootDir, 'src/main.ts');
  const content = fs.readFileSync(mainPath, 'utf8');
  const registrations = content.match(/registerView\(/g) || [];
  if (registrations.length !== 1 || !content.includes('registerView(QUARTZO_VIEW_TYPE')) {
    console.error(`FAIL: V1 requires one primary Quartzo workspace view; found ${registrations.length} registrations`);
    return false;
  }
  console.log('PASS: Single primary Quartzo workspace view');
  return true;
}

function checkNoHardcodedQuickAddFolders() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  if (!fs.existsSync(shellPath)) {
    console.error('FAIL: Quartzo shell missing');
    return false;
  }
  const content = fs.readFileSync(shellPath, 'utf8');
  const forbidden = ['tasks/', 'notes/', 'journal/', 'reminders/'];
  const violations = forbidden.filter(value => content.includes(`'${value}`) || content.includes(`\"${value}`));
  if (violations.length > 0) {
    console.error(`FAIL: Quick Add contains hardcoded canonical folders: ${violations.join(', ')}`);
    return false;
  }
  if (!content.includes('resolveCreationFolder')) {
    console.error('FAIL: Quick Add does not consume shared Object Identification settings');
    return false;
  }
  console.log('PASS: Quick Add paths come from shared Object Identification');
  return true;
}
'''
architecture = architecture.replace('function main() {', insert + '\nfunction main() {')
architecture = architecture.replace(
    "  if (!checkOAuthNotConnectedWithoutRealClientId()) allPassed = false;\n",
    "  if (!checkOAuthNotConnectedWithoutRealClientId()) allPassed = false;\n  if (!checkSingleQuartzoWorkspaceView()) allPassed = false;\n  if (!checkNoHardcodedQuickAddFolders()) allPassed = false;\n",
)
write('scripts/architecture-check.mjs', architecture)

print('V1 UI repair patch applied')
