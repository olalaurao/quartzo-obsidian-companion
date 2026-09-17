from pathlib import Path
import re

ROOT = Path('.')

def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8', newline='\n')

object_creation = r'''import { ObjectParser } from './objects';
import {
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from './shared-settings';

export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder' | 'tracker_record';

export interface QuickAddInput {
  title: string;
  body: string;
  date?: string;
  time?: string;
  trackerId?: string;
  trackerTitle?: string;
  fieldValues?: Record<string, unknown>;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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

  const defaultTitle = type === 'entry'
    ? 'Journal Entry'
    : type === 'tracker_record'
      ? `${input.trackerTitle?.trim() || 'Tracker'} record`
      : 'Untitled';
  const title = input.title.trim() || defaultTitle;
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
  if (type === 'tracker_record') {
    const trackerId = input.trackerId?.trim();
    if (!trackerId) throw new Error('A canonical tracker must be selected before creating a record.');
    const date = input.date ?? isoDate(new Date());
    frontmatter.tracker_id = trackerId;
    frontmatter.date = date.includes('T') ? date : `${date}T00:00:00.000`;
    frontmatter.field_values = { ...(input.fieldValues ?? {}) };
  }

  const signature = resolveTypeSignature(settings, type);
  const signed = applyTypeSignature(frontmatter, input.body, signature);
  const path = `${folder}/${id}.md`.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
  const roundtrip = ObjectParser.parse(content);
  if (roundtrip.object.id !== id || roundtrip.object.type !== type) {
    throw new Error(`Creation roundtrip failed for ${type}`);
  }
  if (type === 'tracker_record') {
    const parsed = roundtrip.object as Record<string, unknown>;
    if (parsed.tracker_id !== input.trackerId || !(parsed.field_values instanceof Object)) {
      throw new Error('Tracking record roundtrip lost tracker identity or field values.');
    }
  }
  return { path, content };
}
'''
write('src/core/object-creation.ts', object_creation)

daily_presentation = r'''import type { NormalizedItem, NormalizedSchedule } from './daily_schedule/types';

export interface DailySourceObject {
  id: string;
  type: string;
  title: string;
  frontmatter: Record<string, unknown>;
}

export interface PresentedDailyItem extends NormalizedItem {
  occurrenceId: string;
  sourceType: string;
  sourceLabel: string;
  isCompletable: boolean;
  isCompleted: boolean;
  isPlayable: boolean;
  origin: 'vault' | 'googleCalendar';
  restrictionMetadata: Record<string, unknown>;
}

export interface DailyPresentation {
  items: PresentedDailyItem[];
  now: PresentedDailyItem | null;
  upNext: PresentedDailyItem[];
  overdue: PresentedDailyItem[];
  taskCount: number;
  taskCompleted: number;
  habitCount: number;
  habitCompleted: number;
}

function toMinutes(value?: string): number | null {
  if (!value || !/^\d{1,2}:\d{2}/.test(value)) return null;
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function sourceCompleted(source: DailySourceObject | undefined): boolean {
  if (!source) return false;
  const fm = source.frontmatter;
  return fm.is_completed === true || fm.completed === true || fm.status === 'completed' || fm.state === 'completed';
}

export function projectDailySchedule(
  schedule: NormalizedSchedule,
  sources: Map<string, DailySourceObject>,
  today: string,
  nowMinutes: number,
): DailyPresentation {
  const items = schedule.items.map(item => {
    const source = sources.get(item.sourceId);
    const sourceType = source?.type ?? (item.id.startsWith('google_calendar:') ? 'googleCalendar' : 'unknown');
    const completed = sourceCompleted(source);
    return {
      ...item,
      occurrenceId: item.occurrenceId ?? item.id,
      sourceType,
      sourceLabel: source?.title ?? item.sourceId,
      isCompletable: ['task', 'habit', 'reminder'].includes(sourceType),
      isCompleted: completed,
      isPlayable: false,
      origin: item.id.startsWith('google_calendar:') ? 'googleCalendar' as const : 'vault' as const,
      restrictionMetadata: {},
    };
  });

  const timed = items
    .filter(item => toMinutes(item.start) != null)
    .sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
  const now = timed.find(item => {
    const start = toMinutes(item.start);
    const end = toMinutes(item.end) ?? (start == null ? null : start + 1);
    return start != null && end != null && start <= nowMinutes && nowMinutes < end;
  }) ?? null;
  const upNext = timed.filter(item => (toMinutes(item.start) ?? -1) > nowMinutes).slice(0, 5);
  const overdue = items.filter(item => {
    const source = sources.get(item.sourceId);
    if (!source || item.isCompleted) return false;
    const rawDate = String(source.frontmatter.scheduled_date ?? source.frontmatter.date ?? '');
    return rawDate.length >= 10 && rawDate.slice(0, 10) < today;
  });
  const tasks = items.filter(item => item.sourceType === 'task');
  const habits = items.filter(item => item.sourceType === 'habit');

  return {
    items,
    now,
    upNext,
    overdue,
    taskCount: tasks.length,
    taskCompleted: tasks.filter(item => item.isCompleted).length,
    habitCount: habits.length,
    habitCompleted: habits.filter(item => item.isCompleted).length,
  };
}

export function dialPoint(time: string, radius = 86, center = 100): { x: number; y: number } | null {
  const minutes = toMinutes(time);
  if (minutes == null) return null;
  const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius,
  };
}
'''
write('src/core/daily-presentation.ts', daily_presentation)

shell = r'''import { ItemView, Modal, Notice, WorkspaceLeaf, normalizePath } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import { projectDailySchedule, dialPoint, type DailySourceObject, type PresentedDailyItem } from '../../core/daily-presentation';
import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';
import { resolveTypeSignature, type QuartzoSharedSettings } from '../../core/shared-settings';
import { VaultIndexEngine } from '../../vault/index';
import { SharedSettingsRepository } from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import type { ViewContext } from '../types';

export const QUARTZO_VIEW_TYPE = 'quartzo-view';
export type QuartzoSection = 'home' | 'planner' | 'journal' | 'browse';
export type QuartzoAction = 'search' | 'add' | 'sync' | 'conflicts' | 'settings';
type PlannerMode = 'day' | 'week' | 'month';
type PlannerLens = 'timeline' | 'adaptive';

type TrackerField = Record<string, unknown>;
type TrackerObject = IndexedObject & { frontmatter: Record<string, unknown> };

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }
function parseIsoDate(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function addDays(date: Date, days: number): Date { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + days); return copy; }
function labelForType(type: string): string { return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()); }
function isHexColor(value: string | null | undefined): value is string { return !!value && /^#[0-9a-fA-F]{6}$/.test(value); }

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

function sourceMap(index: VaultIndex | null): Map<string, DailySourceObject> {
  const map = new Map<string, DailySourceObject>();
  if (!index) return map;
  for (const object of index.objects.values()) {
    map.set(object.id, {
      id: object.id,
      type: object.type,
      title: String(object.frontmatter.title ?? object.id),
      frontmatter: object.frontmatter,
    });
  }
  return map;
}

function trackerFields(tracker: TrackerObject): TrackerField[] {
  const sections = Array.isArray(tracker.frontmatter.sections) ? tracker.frontmatter.sections : [];
  const fields: TrackerField[] = [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const raw = section as Record<string, unknown>;
    const inputFields = Array.isArray(raw.input_fields) ? raw.input_fields : Array.isArray(raw.fields) ? raw.fields : [];
    for (const field of inputFields) {
      if (field && typeof field === 'object') fields.push(field as TrackerField);
    }
  }
  return fields;
}

class QuickAddModal extends Modal {
  private type: QuickAddType = 'task';
  private settingsRepository: SharedSettingsRepository;
  private selectedTrackerId = '';
  private recordValues = new Map<string, unknown>();

  constructor(private readonly context: ViewContext, initialType?: QuickAddType) {
    super(context.app);
    if (initialType) this.type = initialType;
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
  }

  onOpen(): void { this.render(); }

  private trackers(): TrackerObject[] {
    const index = this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex();
    if (!index) return [];
    return Array.from(index.objects.values()).filter(object => object.type === 'tracker_definition') as TrackerObject[];
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const heading = document.createElement('h2');
    heading.textContent = 'Quick Add';
    contentEl.appendChild(heading);

    const typeSelect = document.createElement('select');
    for (const type of ['task', 'entry', 'note', 'reminder', 'tracker_record'] as QuickAddType[]) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type === 'tracker_record' ? 'Record' : labelForType(type);
      option.selected = type === this.type;
      typeSelect.appendChild(option);
    }
    typeSelect.addEventListener('change', () => {
      this.type = typeSelect.value as QuickAddType;
      this.selectedTrackerId = '';
      this.recordValues.clear();
      this.render();
    });
    contentEl.appendChild(typeSelect);

    if (this.type === 'tracker_record') {
      this.renderRecordForm(contentEl);
      return;
    }
    this.renderObjectForm(contentEl);
  }

  private renderObjectForm(contentEl: HTMLElement): void {
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
      await this.createDocument({
        title: titleInput.value,
        body: bodyInput.value,
        date: dateInput?.value,
        time: timeInput?.value,
      });
    });
    contentEl.appendChild(create);
  }

  private renderRecordForm(contentEl: HTMLElement): void {
    const trackers = this.trackers();
    if (trackers.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No trackers are available. Create a tracker in Quartzo before logging a record.';
      contentEl.appendChild(empty);
      return;
    }

    const trackerSelect = document.createElement('select');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select tracker';
    trackerSelect.appendChild(placeholder);
    for (const tracker of trackers) {
      const option = document.createElement('option');
      option.value = tracker.id;
      option.textContent = String(tracker.frontmatter.title ?? tracker.id);
      option.selected = tracker.id === this.selectedTrackerId;
      trackerSelect.appendChild(option);
    }
    trackerSelect.addEventListener('change', () => {
      this.selectedTrackerId = trackerSelect.value;
      this.recordValues.clear();
      this.initializeRecordDefaults(trackers.find(item => item.id === this.selectedTrackerId));
      this.render();
    });
    contentEl.appendChild(trackerSelect);

    const tracker = trackers.find(item => item.id === this.selectedTrackerId);
    if (!tracker) return;

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = isoDate(new Date());
    contentEl.appendChild(dateInput);

    let unsupported = false;
    for (const field of trackerFields(tracker)) {
      const fieldId = String(field.id ?? '');
      if (!fieldId) continue;
      const row = document.createElement('div');
      row.className = 'quartzo-record-field';
      const label = document.createElement('label');
      label.textContent = String(field.title ?? fieldId);
      row.appendChild(label);

      if (field.options_source_collection_slug) {
        unsupported = true;
        const warning = document.createElement('small');
        warning.textContent = 'This field uses dynamic collection options. Log this record in Quartzo to avoid losing semantics.';
        row.appendChild(warning);
        contentEl.appendChild(row);
        continue;
      }

      const type = String(field.type ?? 'text');
      if (type === 'checkbox') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this.recordValues.get(fieldId) === true;
        input.addEventListener('change', () => this.recordValues.set(fieldId, input.checked));
        row.appendChild(input);
      } else if (type === 'selection') {
        const input = document.createElement('select');
        const options = Array.isArray(field.options) ? field.options.map(String) : [];
        const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Select…'; input.appendChild(blank);
        for (const value of options) {
          const option = document.createElement('option'); option.value = value; option.textContent = value; input.appendChild(option);
        }
        input.value = String(this.recordValues.get(fieldId) ?? '');
        input.addEventListener('change', () => this.recordValues.set(fieldId, input.value));
        row.appendChild(input);
      } else if (type === 'checklist') {
        const options = Array.isArray(field.options) ? field.options.map(String) : [];
        const selected = new Set(Array.isArray(this.recordValues.get(fieldId)) ? (this.recordValues.get(fieldId) as unknown[]).map(String) : []);
        if (options.length === 0) {
          const warning = document.createElement('small'); warning.textContent = 'No checklist options configured.'; row.appendChild(warning);
        }
        for (const value of options) {
          const wrapper = document.createElement('label');
          const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(value);
          input.addEventListener('change', () => {
            if (input.checked) selected.add(value); else selected.delete(value);
            this.recordValues.set(fieldId, [...selected]);
          });
          wrapper.appendChild(input); wrapper.append(` ${value}`); row.appendChild(wrapper);
        }
      } else {
        const input = document.createElement('input');
        const numeric = ['quantity', 'range', 'mood'].includes(type);
        input.type = numeric ? 'number' : 'text';
        if (numeric && field.min != null) input.min = String(field.min);
        if (numeric && field.max != null) input.max = String(field.max);
        input.value = this.recordValues.get(fieldId)?.toString() ?? '';
        if (type === 'media') input.placeholder = 'Vault attachment path';
        if (type === 'duration') input.placeholder = '00:00';
        input.addEventListener('input', () => {
          if (numeric) {
            const parsed = Number(input.value);
            this.recordValues.set(fieldId, Number.isFinite(parsed) ? parsed : null);
          } else if (type === 'media') {
            const mediaPath = input.value.trim();
            this.recordValues.set(fieldId, mediaPath ? { type: 'attachment', path: mediaPath, name: mediaPath.split('/').pop() ?? mediaPath } : null);
          } else {
            this.recordValues.set(fieldId, input.value);
          }
        });
        row.appendChild(input);
      }
      contentEl.appendChild(row);
    }

    const save = document.createElement('button');
    save.textContent = 'Save record';
    save.className = 'mod-cta';
    save.disabled = unsupported;
    save.addEventListener('click', async () => {
      const fieldValues = Object.fromEntries([...this.recordValues.entries()].filter(([, value]) => value != null && value !== ''));
      await this.createDocument({
        title: `${String(tracker.frontmatter.title ?? tracker.id)} record`,
        body: '',
        date: dateInput.value,
        trackerId: tracker.id,
        trackerTitle: String(tracker.frontmatter.title ?? tracker.id),
        fieldValues,
      });
    });
    contentEl.appendChild(save);
  }

  private initializeRecordDefaults(tracker?: TrackerObject): void {
    if (!tracker) return;
    for (const field of trackerFields(tracker)) {
      const id = String(field.id ?? '');
      if (!id) continue;
      if (field.default_value != null) this.recordValues.set(id, field.default_value);
      else if (field.type === 'checkbox') this.recordValues.set(id, false);
      else if (field.type === 'quantity') this.recordValues.set(id, 0);
      else if (field.type === 'range') this.recordValues.set(id, Number(field.min ?? 0));
    }
  }

  private async createDocument(input: Parameters<typeof buildQuickAddDocument>[2]): Promise<void> {
    try {
      const settings = await this.settingsRepository.load();
      const id = `${this.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const documentData = buildQuickAddDocument(settings, this.type, input, id);
      await this.ensureParentFolders(documentData.path);
      if (this.context.app.vault.getAbstractFileByPath(documentData.path)) throw new Error(`Target already exists: ${documentData.path}`);
      await this.context.app.vault.create(documentData.path, documentData.content);
      new Notice(`${this.type === 'tracker_record' ? 'Record' : labelForType(this.type)} created`);
      this.close();
    } catch (error) {
      new Notice(`Quick Add blocked: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ensureParentFolders(filePath: string): Promise<void> {
    const segments = normalizePath(filePath).split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.context.app.vault.getAbstractFileByPath(current)) await this.context.app.vault.createFolder(current);
    }
  }
}

export class QuartzoView extends ItemView {
  private section: QuartzoSection = 'home';
  private action: QuartzoAction | null = null;
  private selectedDate = isoDate(new Date());
  private plannerMode: PlannerMode = 'day';
  private plannerLens: PlannerLens = 'timeline';
  private sharedSettingsRepository: SharedSettingsRepository;

  constructor(leaf: WorkspaceLeaf, private readonly context: ViewContext) {
    super(leaf);
    this.sharedSettingsRepository = new SharedSettingsRepository(context.app.vault);
  }

  getViewType(): string { return QUARTZO_VIEW_TYPE; }
  getDisplayText(): string { return 'Quartzo'; }
  getIcon(): string { return 'calendar-clock'; }
  async onOpen(): Promise<void> { await this.render(); }
  async setSection(section: QuartzoSection): Promise<void> { this.section = section; this.action = null; await this.render(); }
  async refresh(): Promise<void> { await this.render(); }

  async handleAction(action: QuartzoAction): Promise<void> {
    if (action === 'add') { new QuickAddModal(this.context).open(); return; }
    if (action === 'settings') { this.context.plugin.openSettings(); return; }
    this.action = action;
    await this.render();
  }

  private getIndex(): VaultIndex | null { return this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex() ?? null; }
  private getSources(): Map<string, DailySourceObject> { return sourceMap(this.getIndex()); }
  private buildSchedule(date: string) { return DailyScheduleEngine.normalize({ date, today: isoDate(new Date()), objects: scheduleObjects(this.getIndex()), googleEvents: [] }); }
  private nowMinutes(): number { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); }

  private async render(): Promise<void> {
    this.contentEl.empty();
    const shell = document.createElement('div'); shell.className = 'quartzo-shell'; this.contentEl.appendChild(shell);
    const header = document.createElement('header'); header.className = 'quartzo-shell-header'; shell.appendChild(header);
    const brand = document.createElement('strong'); brand.textContent = 'Quartzo'; header.appendChild(brand);

    const nav = document.createElement('nav'); nav.className = 'quartzo-shell-nav';
    for (const section of ['home', 'planner', 'journal', 'browse'] as QuartzoSection[]) {
      const button = document.createElement('button'); button.textContent = labelForType(section); if (section === this.section) button.classList.add('is-active');
      button.addEventListener('click', () => { void this.setSection(section); }); nav.appendChild(button);
    }
    header.appendChild(nav);

    const actions = document.createElement('div'); actions.className = 'quartzo-shell-actions';
    for (const [action, label] of [['search', 'Search'], ['add', 'Add'], ['sync', 'Sync'], ['settings', 'Settings']] as Array<[QuartzoAction, string]>) {
      const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => { void this.handleAction(action); }); actions.appendChild(button);
    }
    header.appendChild(actions);

    const content = document.createElement('main'); content.className = 'quartzo-shell-content'; shell.appendChild(content);
    if (this.action === 'search') { this.renderSearch(content); return; }
    if (this.action === 'sync' || this.action === 'conflicts') { await this.renderSync(content, this.action === 'conflicts'); return; }
    if (this.section === 'home') await this.renderHome(content);
    if (this.section === 'planner') await this.renderPlanner(content);
    if (this.section === 'journal') this.renderJournal(content);
    if (this.section === 'browse') this.renderBrowse(content);
  }

  private presentation(date: string) {
    const schedule = this.buildSchedule(date);
    return { schedule, view: projectDailySchedule(schedule, this.getSources(), isoDate(new Date()), this.nowMinutes()) };
  }

  private renderDailyRow(container: HTMLElement, item: PresentedDailyItem): void {
    const row = document.createElement('button'); row.className = 'quartzo-daily-row';
    const time = item.start ? `${item.start} · ` : '';
    row.textContent = `${time}${item.sourceLabel}${item.isCompleted ? ' ✓' : ''}`;
    row.dataset.occurrenceId = item.occurrenceId;
    row.dataset.sourceId = item.sourceId;
    row.dataset.sourceType = item.sourceType;
    const object = this.getIndex()?.objects.get(item.sourceId);
    if (object) row.addEventListener('click', () => this.openMarkdown(object)); else row.disabled = true;
    container.appendChild(row);
  }

  private renderScheduleList(container: HTMLElement, date: string, lens: PlannerLens = 'timeline'): void {
    const { view } = this.presentation(date);
    const items = [...view.items].sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99'));
    if (items.length === 0) { const empty = document.createElement('p'); empty.textContent = 'Nothing scheduled.'; container.appendChild(empty); return; }
    if (lens === 'adaptive') {
      for (const [label, subset] of [['Timed', items.filter(item => item.isTimed)], ['Flexible', items.filter(item => !item.isTimed)]] as const) {
        if (subset.length === 0) continue;
        const heading = document.createElement('h4'); heading.textContent = label; container.appendChild(heading);
        subset.forEach(item => this.renderDailyRow(container, item));
      }
    } else items.forEach(item => this.renderDailyRow(container, item));
  }

  private async renderDayDial(container: HTMLElement, items: PresentedDailyItem[], settings: QuartzoSharedSettings | null): Promise<void> {
    const wrapper = document.createElement('section'); wrapper.className = 'quartzo-day-dial';
    const title = document.createElement('h3'); title.textContent = 'Day Dial'; wrapper.appendChild(title);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 200 200'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '24 hour Day Dial');
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); ring.setAttribute('cx', '100'); ring.setAttribute('cy', '100'); ring.setAttribute('r', '86'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'currentColor'); ring.setAttribute('stroke-opacity', '0.2'); ring.setAttribute('stroke-width', '2'); svg.appendChild(ring);
    for (const hour of [0, 6, 12, 18]) {
      const point = dialPoint(`${String(hour).padStart(2, '0')}:00`, 75); if (!point) continue;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text'); label.setAttribute('x', point.x.toFixed(2)); label.setAttribute('y', point.y.toFixed(2)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'middle'); label.setAttribute('font-size', '9'); label.textContent = String(hour).padStart(2, '0'); svg.appendChild(label);
    }
    for (const item of items.filter(candidate => candidate.start)) {
      const point = dialPoint(item.start!, 86); if (!point) continue;
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); marker.setAttribute('cx', point.x.toFixed(2)); marker.setAttribute('cy', point.y.toFixed(2)); marker.setAttribute('r', '5');
      const signature = resolveTypeSignature(settings, item.sourceType); marker.setAttribute('fill', isHexColor(signature?.colorHex) ? signature.colorHex : 'var(--interactive-accent)');
      const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title'); tooltip.textContent = `${item.start} ${item.sourceLabel}`; marker.appendChild(tooltip); svg.appendChild(marker);
    }
    wrapper.appendChild(svg); container.appendChild(wrapper);
  }

  private async renderHome(container: HTMLElement): Promise<void> {
    const dateHeading = document.createElement('h2');
    dateHeading.textContent = parseIsoDate(this.selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
    container.appendChild(dateHeading);
    const settings = await this.sharedSettingsRepository.load();
    const { view } = this.presentation(this.selectedDate);
    await this.renderDayDial(container, view.items, settings);

    const nowSection = document.createElement('section'); const nowTitle = document.createElement('h3'); nowTitle.textContent = 'NOW'; nowSection.appendChild(nowTitle);
    if (view.now) this.renderDailyRow(nowSection, view.now); else nowSection.append('Nothing active right now.'); container.appendChild(nowSection);

    const nextSection = document.createElement('section'); const nextTitle = document.createElement('h3'); nextTitle.textContent = 'UP NEXT'; nextSection.appendChild(nextTitle);
    if (view.upNext.length === 0) nextSection.append('No upcoming timed items.'); else view.upNext.forEach(item => this.renderDailyRow(nextSection, item)); container.appendChild(nextSection);

    const today = document.createElement('section'); const todayTitle = document.createElement('h3'); todayTitle.textContent = 'TODAY'; today.appendChild(todayTitle);
    const stats = document.createElement('p'); stats.textContent = `Tasks ${view.taskCompleted} / ${view.taskCount} · Habits ${view.habitCompleted} / ${view.habitCount}`; today.appendChild(stats); container.appendChild(today);

    if (view.overdue.length > 0) { const overdue = document.createElement('section'); const heading = document.createElement('h3'); heading.textContent = 'OVERDUE'; overdue.appendChild(heading); view.overdue.forEach(item => this.renderDailyRow(overdue, item)); container.appendChild(overdue); }

    const quick = document.createElement('section'); const quickTitle = document.createElement('h3'); quickTitle.textContent = 'QUICK ACTIONS'; quick.appendChild(quickTitle);
    for (const [type, label] of [['task', '+ Task'], ['entry', '+ Entry'], ['note', '+ Note'], ['tracker_record', '+ Record']] as Array<[QuickAddType, string]>) {
      const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => new QuickAddModal(this.context, type).open()); quick.appendChild(button);
    }
    container.appendChild(quick);
  }

  private async renderPlanner(container: HTMLElement): Promise<void> {
    const title = document.createElement('h2'); title.textContent = 'Planner'; container.appendChild(title);
    const controls = document.createElement('div'); controls.className = 'quartzo-planner-controls';
    const previous = document.createElement('button'); previous.textContent = '‹'; previous.addEventListener('click', () => { const step = this.plannerMode === 'week' ? -7 : this.plannerMode === 'month' ? -30 : -1; this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step)); void this.render(); }); controls.appendChild(previous);
    const todayButton = document.createElement('button'); todayButton.textContent = 'Today'; todayButton.addEventListener('click', () => { this.selectedDate = isoDate(new Date()); void this.render(); }); controls.appendChild(todayButton);
    const next = document.createElement('button'); next.textContent = '›'; next.addEventListener('click', () => { const step = this.plannerMode === 'week' ? 7 : this.plannerMode === 'month' ? 30 : 1; this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step)); void this.render(); }); controls.appendChild(next);
    for (const mode of ['day', 'week', 'month'] as PlannerMode[]) { const button = document.createElement('button'); button.textContent = labelForType(mode); if (mode === this.plannerMode) button.classList.add('is-active'); button.addEventListener('click', () => { this.plannerMode = mode; void this.render(); }); controls.appendChild(button); }
    container.appendChild(controls);

    if (this.plannerMode === 'day') {
      const lenses = document.createElement('div');
      for (const lens of ['timeline', 'adaptive'] as PlannerLens[]) { const button = document.createElement('button'); button.textContent = labelForType(lens); if (lens === this.plannerLens) button.classList.add('is-active'); button.addEventListener('click', () => { this.plannerLens = lens; void this.render(); }); lenses.appendChild(button); }
      container.appendChild(lenses); const heading = document.createElement('h3'); heading.textContent = this.selectedDate; container.appendChild(heading); this.renderScheduleList(container, this.selectedDate, this.plannerLens); return;
    }

    const selected = parseIsoDate(this.selectedDate);
    if (this.plannerMode === 'week') {
      const settings = await this.sharedSettingsRepository.load(); const startOfWeek = settings?.startOfWeek ?? 1; const delta = (selected.getUTCDay() - startOfWeek + 7) % 7; const start = addDays(selected, -delta);
      const grid = document.createElement('div'); grid.className = 'quartzo-week-grid';
      for (let i = 0; i < 7; i++) { const date = isoDate(addDays(start, i)); const day = document.createElement('section'); const heading = document.createElement('h4'); heading.textContent = date; day.appendChild(heading); this.renderScheduleList(day, date); grid.appendChild(day); }
      container.appendChild(grid); return;
    }

    const year = selected.getUTCFullYear(); const month = selected.getUTCMonth(); const first = new Date(Date.UTC(year, month, 1)); const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); const monthGrid = document.createElement('div'); monthGrid.className = 'quartzo-month-grid';
    for (let padding = 0; padding < first.getUTCDay(); padding++) monthGrid.appendChild(document.createElement('div'));
    for (let day = 1; day <= days; day++) { const date = isoDate(new Date(Date.UTC(year, month, day))); const cell = document.createElement('button'); cell.className = 'quartzo-month-cell'; const count = this.presentation(date).view.items.length; cell.textContent = `${day}\n${count ? `${count} item${count === 1 ? '' : 's'}` : ''}`; cell.addEventListener('click', () => { this.selectedDate = date; this.plannerMode = 'day'; void this.render(); }); monthGrid.appendChild(cell); }
    container.appendChild(monthGrid);
  }

  private renderJournal(container: HTMLElement): void {
    const title = document.createElement('h2'); title.textContent = 'Journal'; container.appendChild(title);
    const date = document.createElement('input'); date.type = 'date'; date.value = this.selectedDate; date.addEventListener('change', () => { this.selectedDate = date.value || isoDate(new Date()); void this.render(); }); container.appendChild(date);
    const add = document.createElement('button'); add.textContent = 'New Entry'; add.addEventListener('click', () => new QuickAddModal(this.context, 'entry').open()); container.appendChild(add);
    const objects = this.getIndex() ? Array.from(this.getIndex()!.objects.values()) : [];
    const relevant = objects.filter(object => ['daily_note', 'entry', 'tracker_record'].includes(object.type) && String(object.frontmatter.date ?? '').startsWith(this.selectedDate));
    if (relevant.length === 0) { const empty = document.createElement('p'); empty.textContent = 'No journal items for this date.'; container.appendChild(empty); return; }
    relevant.forEach(object => this.renderObjectRow(container, object));
  }

  private renderBrowse(container: HTMLElement): void {
    const title = document.createElement('h2'); title.textContent = 'Browse'; container.appendChild(title);
    const objects = this.getIndex() ? Array.from(this.getIndex()!.objects.values()) : [];
    const filter = document.createElement('select'); const all = document.createElement('option'); all.value = ''; all.textContent = 'All types'; filter.appendChild(all);
    for (const type of [...new Set(objects.map(object => object.type))].sort()) { const option = document.createElement('option'); option.value = type; option.textContent = labelForType(type); filter.appendChild(option); }
    container.appendChild(filter); const list = document.createElement('div'); container.appendChild(list);
    const render = () => { list.replaceChildren(); const visible = filter.value ? objects.filter(object => object.type === filter.value) : objects; visible.forEach(object => this.renderObjectRow(list, object)); };
    filter.addEventListener('change', render); render();
  }

  private renderSearch(container: HTMLElement): void {
    const title = document.createElement('h2'); title.textContent = 'Search'; container.appendChild(title);
    const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Search Quartzo objects'; container.appendChild(input);
    const results = document.createElement('div'); container.appendChild(results);
    const renderResults = () => { results.replaceChildren(); const index = this.getIndex(); if (!index || !input.value.trim()) return; VaultIndexEngine.searchObjects(index, input.value).forEach(object => this.renderObjectRow(results, object)); };
    input.addEventListener('input', renderResults); input.focus();
  }

  private async renderSync(container: HTMLElement, conflictsOnly: boolean): Promise<void> {
    const title = document.createElement('h2'); title.textContent = conflictsOnly ? 'Conflicts' : 'Sync'; container.appendChild(title);
    const plugin = this.context.plugin; const coordinator = plugin.driveSyncCoordinator;
    const status = coordinator?.getRuntimeStatus();
    const state = document.createElement('p'); state.textContent = `Status: ${plugin.authState.replace(/_/g, ' ')}`; container.appendChild(state);

    if (plugin.authState === 'disconnected' || plugin.authState === 'authentication_required') { const connect = document.createElement('button'); connect.textContent = plugin.authState === 'authentication_required' ? 'Reconnect Google' : 'Connect Google Drive'; connect.addEventListener('click', async () => { await plugin.startPairingFlow(); await this.render(); }); container.appendChild(connect); return; }
    if (plugin.authState === 'authenticated_unpaired') { const candidates = await plugin.driveAdapter?.listQuartzoVaultCandidates() ?? []; if (candidates.length === 0) { const empty = document.createElement('p'); empty.textContent = 'No existing Quartzo vault was found.'; container.appendChild(empty); const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.addEventListener('click', () => { void this.render(); }); container.appendChild(retry); return; } for (const candidate of candidates) { const button = document.createElement('button'); button.textContent = `Pair with ${candidate.name}`; button.addEventListener('click', async () => { await plugin.confirmPairing(candidate.id, candidate.name, false, false); await this.render(); }); container.appendChild(button); } return; }

    if (!conflictsOnly) {
      const details = document.createElement('div'); details.className = 'quartzo-sync-details';
      details.append(`Vault: ${plugin.settings.googleDriveFolderName ?? 'Quartzo'}`);
      if (status?.lastSuccessfulSync) details.append(` · Last sync: ${new Date(status.lastSuccessfulSync).toLocaleString()}`);
      details.append(` · Pending local changes: ${status?.pendingLocalChanges ?? 0}`);
      details.append(` · Conflicts: ${status?.conflicts ?? 0}`);
      if (status?.lastError) details.append(` · Last error: ${status.lastError}`);
      container.appendChild(details);
      const sync = document.createElement('button'); sync.textContent = 'Sync now'; sync.addEventListener('click', async () => { const result = await coordinator?.triggerManualSync(); if (result) new Notice(`Sync complete: ${result.synced} synced, ${result.conflicts} conflicts`); await this.render(); }); container.appendChild(sync);
      const full = document.createElement('button'); full.textContent = 'Run full reconciliation'; full.addEventListener('click', async () => { const result = await coordinator?.triggerFullReconciliation(); if (result) new Notice(`Full reconciliation: ${result.synced} synced, ${result.conflicts} conflicts`); await this.render(); }); container.appendChild(full);
      const showConflicts = document.createElement('button'); showConflicts.textContent = 'View conflicts'; showConflicts.addEventListener('click', () => { void this.handleAction('conflicts'); }); container.appendChild(showConflicts);
      const disconnect = document.createElement('button'); disconnect.textContent = 'Disconnect this device'; disconnect.addEventListener('click', async () => { await plugin.disconnectDrive(); await this.render(); }); container.appendChild(disconnect);
    }

    const conflicts = coordinator?.getConflicts() ?? [];
    if (conflicts.length === 0) { const empty = document.createElement('p'); empty.textContent = 'No conflicts.'; container.appendChild(empty); return; }
    const decoder = new TextDecoder();
    for (const conflict of conflicts) {
      const card = document.createElement('section'); card.className = 'quartzo-conflict-card';
      const heading = document.createElement('h3'); heading.textContent = conflict.originalPath; card.appendChild(heading);
      const times = document.createElement('p'); times.textContent = `Local: ${conflict.localModifiedTime ? new Date(conflict.localModifiedTime).toLocaleString() : 'unknown'} · Drive: ${conflict.remoteModifiedTime ? new Date(conflict.remoteModifiedTime).toLocaleString() : 'unknown'}`; card.appendChild(times);
      const hashes = document.createElement('p'); hashes.textContent = `Local ${conflict.localSha256.slice(0, 12)} · Drive ${conflict.remoteSha256.slice(0, 12)}`; card.appendChild(hashes);
      if (!conflict.isBinary) { const local = document.createElement('pre'); local.textContent = conflict.localExists ? `Local:\n${decoder.decode(conflict.localContent)}` : 'Local: deleted'; card.appendChild(local); const remote = document.createElement('pre'); remote.textContent = conflict.remoteExists ? `Drive:\n${decoder.decode(conflict.remoteContent)}` : 'Drive: deleted'; card.appendChild(remote); }
      for (const [resolution, label] of [['keep_local', 'Keep local'], ['keep_drive', 'Keep Drive'], ['keep_newest', 'Keep newest']] as const) { const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', async () => { try { await coordinator?.resolveConflict(conflict.originalPath, resolution); await this.render(); } catch (error) { new Notice(`Conflict resolution failed: ${error instanceof Error ? error.message : String(error)}`); } }); card.appendChild(button); }
      container.appendChild(card);
    }
  }

  private renderObjectRow(container: HTMLElement, object: IndexedObject): void { const row = document.createElement('button'); row.className = 'quartzo-object-row'; row.textContent = `${String(object.frontmatter.title ?? 'Untitled')} · ${labelForType(object.type)}`; row.addEventListener('click', () => this.openMarkdown(object)); container.appendChild(row); }
  private openMarkdown(object: IndexedObject): void { void this.context.app.workspace.openLinkText(object.path, '', true); }
}
'''
write('src/ui/shell/view.ts', shell)

styles = r'''/* Quartzo Companion V1 */
.theme-dark { --quartzo-accent: #8b5cf6; --quartzo-bg: #1e1e1e; --quartzo-text: #e0e0e0; }
.theme-light { --quartzo-accent: #7c3aed; --quartzo-bg: #ffffff; --quartzo-text: #1a1a1a; }
.quartzo-ribbon-icon { color: var(--quartzo-accent); }
.quartzo-shell { padding: 16px; color: var(--text-normal); }
.quartzo-shell-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 14px; }
.quartzo-shell-header > strong { color: var(--quartzo-accent); font-size: 1.2rem; }
.quartzo-shell-nav, .quartzo-shell-actions, .quartzo-planner-controls { display: flex; gap: 6px; flex-wrap: wrap; }
.quartzo-shell-actions { margin-left: auto; }
.quartzo-shell button { cursor: pointer; }
.quartzo-shell button.is-active { background: var(--interactive-accent); color: var(--text-on-accent); }
.quartzo-shell-content section { margin: 16px 0; }
.quartzo-day-dial { max-width: 320px; }
.quartzo-day-dial svg { width: min(280px, 100%); height: auto; color: var(--text-muted); display: block; }
.quartzo-daily-row, .quartzo-object-row { display: block; width: 100%; text-align: left; margin: 4px 0; padding: 8px 10px; border-radius: 6px; }
.quartzo-week-grid { display: grid; grid-template-columns: repeat(7, minmax(130px, 1fr)); gap: 8px; overflow-x: auto; }
.quartzo-week-grid > section { min-width: 130px; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 8px; }
.quartzo-month-grid { display: grid; grid-template-columns: repeat(7, minmax(72px, 1fr)); gap: 6px; }
.quartzo-month-cell { min-height: 70px; white-space: pre-line; text-align: left; vertical-align: top; }
.quartzo-input, .modal input, .modal textarea, .modal select { width: 100%; margin: 6px 0; }
.quartzo-record-field { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(140px, 2fr); gap: 10px; align-items: center; margin: 8px 0; }
.quartzo-record-field small { grid-column: 1 / -1; color: var(--text-muted); }
.quartzo-sync-details { margin: 10px 0; color: var(--text-muted); }
.quartzo-conflict-card { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px; }
.quartzo-conflict-card pre { max-height: 260px; overflow: auto; white-space: pre-wrap; background: var(--background-secondary); padding: 8px; border-radius: 6px; }
.quartzo-first-run-modal { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.quartzo-first-run-modal .modal-content { background: var(--background-primary); color: var(--text-normal); padding: 30px; border-radius: 8px; max-width: 420px; text-align: center; }
'''
write('styles.css', styles)

# Coordinator conflict metadata/status/full reconciliation.
coord_path = ROOT / 'src/sync/coordinator/index.ts'
coord = coord_path.read_text(encoding='utf-8')
coord = coord.replace("  remoteExists: boolean;\n}", "  remoteExists: boolean;\n  localModifiedTime: string | null;\n  remoteModifiedTime: string | null;\n}", 1)
coord = coord.replace("  resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive'): Promise<void>;", "  resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive' | 'keep_newest'): Promise<void>;")
coord = coord.replace("  private pendingDeletes: Set<string> = new Set();\n", "  private pendingDeletes: Set<string> = new Set();\n  private lastSyncError: string | null = null;\n")
old_sig = "  async resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive'): Promise<void> {\n    const normalized = normalizeVaultPath(originalPath);\n    const artifact = this.conflicts.get(normalized);\n    if (!artifact) return;\n\n    const effectiveRemoteFileId = artifact.remoteFileId || this.syncState.files.get(normalized)?.remoteFileId || null;\n\n    if (resolution === 'keep_local') {"
new_sig = "  async resolveConflict(originalPath: string, resolution: 'keep_local' | 'keep_drive' | 'keep_newest'): Promise<void> {\n    const normalized = normalizeVaultPath(originalPath);\n    const artifact = this.conflicts.get(normalized);\n    if (!artifact) return;\n\n    const effectiveRemoteFileId = artifact.remoteFileId || this.syncState.files.get(normalized)?.remoteFileId || null;\n    let effectiveResolution: 'keep_local' | 'keep_drive' = resolution === 'keep_newest' ? chooseNewestConflictSide(artifact) : resolution;\n\n    if (effectiveResolution === 'keep_local') {"
if old_sig not in coord: raise RuntimeError('resolveConflict signature anchor not found')
coord = coord.replace(old_sig, new_sig)
coord = coord.replace("    } else {\n      if (!artifact.remoteExists) {\n", "    } else {\n      if (!artifact.remoteExists) {\n", 1)
# Add exported pure chooser before coordinator class.
chooser = r'''
export function chooseNewestConflictSide(artifact: ConflictArtifact): 'keep_local' | 'keep_drive' {
  const localTime = Date.parse(artifact.localModifiedTime ?? artifact.timestamp);
  const remoteTime = Date.parse(artifact.remoteModifiedTime ?? artifact.timestamp);
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime) || localTime === remoteTime) {
    throw new Error('Keep newest is unavailable because the conflict timestamps do not identify a unique newest side.');
  }
  return localTime > remoteTime ? 'keep_local' : 'keep_drive';
}

'''
coord = coord.replace('export class DriveSyncCoordinator implements ConflictRegistry {', chooser + 'export class DriveSyncCoordinator implements ConflictRegistry {', 1)
# Rehydrate JSON metadata fields.
coord = coord.replace("              remoteExists: meta.remote?.exists ?? (meta.remote?.fileId != null)\n            });", "              remoteExists: meta.remote?.exists ?? (meta.remote?.fileId != null),\n              localModifiedTime: meta.local?.modifiedTime ?? meta.timestamp ?? null,\n              remoteModifiedTime: meta.remote?.modifiedTime ?? meta.timestamp ?? null\n            });", 1)
# Legacy conflict sets: add fallback after remoteExists in any remaining conflict artifact set missing times.
coord = re.sub(r"remoteExists: metaRemoteExists\n\s*\}\);", "remoteExists: metaRemoteExists,\n                localModifiedTime: new Date().toISOString(),\n                remoteModifiedTime: new Date().toISOString()\n              });", coord)
# Reconcile status.
coord = coord.replace("      this.backoffMs = 1000;\n    } catch (error) {\n      result.errors.push(`Sync failed: ${error}`);", "      this.backoffMs = 1000;\n      this.lastSyncError = null;\n    } catch (error) {\n      this.lastSyncError = String(error);\n      result.errors.push(`Sync failed: ${error}`);")
# handleConflict timestamps and metadata.
anchor = "    const localSha256 = crypto.createHash('sha256').update(localContent).digest('hex');\n    const remoteSha256 = remoteFile?.quartzoHash || crypto.createHash('sha256').update(remoteContent).digest('hex');\n\n    const conflictBase = `_conflicts/${filePath}`;"
replace = "    const localSha256 = crypto.createHash('sha256').update(localContent).digest('hex');\n    const remoteSha256 = remoteFile?.quartzoHash || crypto.createHash('sha256').update(remoteContent).digest('hex');\n    const conflictTimestamp = new Date().toISOString();\n    const localModifiedTime = fs.existsSync(localFilePath) ? fs.statSync(localFilePath).mtime.toISOString() : conflictTimestamp;\n    const remoteModifiedTime = remoteFile?.modifiedTime || conflictTimestamp;\n\n    const conflictBase = `_conflicts/${filePath}`;"
if anchor not in coord: raise RuntimeError('handleConflict hash anchor not found')
coord = coord.replace(anchor, replace, 1)
coord = coord.replace("local: { sha256: localSha256, size: localContent.length, exists: localFile.exists },", "local: { sha256: localSha256, size: localContent.length, exists: localFile.exists, modifiedTime: localModifiedTime },")
coord = coord.replace("remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || syncFile.remoteFileId || null, exists: remoteFile != null },", "remote: { sha256: remoteSha256, size: remoteContent.length, fileId: remoteFile?.id || syncFile.remoteFileId || null, exists: remoteFile != null, modifiedTime: remoteModifiedTime },")
coord = coord.replace("timestamp: new Date().toISOString()\n      };", "timestamp: conflictTimestamp\n      };")
coord = coord.replace("      timestamp: new Date().toISOString(),\n      localExists: localFile.exists,\n      remoteExists: remoteFile != null\n    });", "      timestamp: conflictTimestamp,\n      localExists: localFile.exists,\n      remoteExists: remoteFile != null,\n      localModifiedTime,\n      remoteModifiedTime\n    });", 1)
# Add status/full reconcile before triggerManualSync.
status_methods = r'''  getRuntimeStatus(): { lastSuccessfulSync: number | null; pendingLocalChanges: number; conflicts: number; lastError: string | null } {
    return {
      lastSuccessfulSync: this.syncState.lastSyncTime > 0 ? this.syncState.lastSyncTime : null,
      pendingLocalChanges: this.pendingRenames.length + this.pendingDeletes.size,
      conflicts: this.conflicts.size,
      lastError: this.lastSyncError,
    };
  }

  async triggerFullReconciliation(): Promise<SyncResult> {
    if (this.syncMutex) throw new Error('Cannot start a full reconciliation while another sync is running.');
    this.syncState.driveChangeToken = null;
    await this.saveSyncState();
    return this.reconcile();
  }

'''
coord = coord.replace('  async triggerManualSync(): Promise<SyncResult> {', status_methods + '  async triggerManualSync(): Promise<SyncResult> {', 1)
write('src/sync/coordinator/index.ts', coord)

# Do not expose placeholder persistence service as production API.
occ_index = ROOT / 'src/core/occurrence_actions/index.ts'
occ = occ_index.read_text(encoding='utf-8').replace("export * from './service';\n", '')
write('src/core/occurrence_actions/index.ts', occ)
service_path = ROOT / 'src/core/occurrence_actions/service.ts'
if service_path.exists(): service_path.unlink()

# Hide manual OAuth client ID when production build has injected one; retain a clearly dev-only override otherwise.
main_path = ROOT / 'src/main.ts'
main = main_path.read_text(encoding='utf-8')
settings_block = r'''    new Setting(containerEl)
      .setName('Google OAuth Client ID')
      .setDesc('Desktop OAuth Client ID from Google Cloud Console (PKCE, no client secret)')
      .addText(text => text
        .setPlaceholder('Enter OAuth Client ID')
        .setValue(this.plugin.settings.oauthClientId)
        .onChange(async (value) => {
          this.plugin.settings.oauthClientId = value;
          await this.plugin.saveSettings();
        }));
'''
replacement = r'''    if (!BUILD_CLIENT_ID) {
      new Setting(containerEl)
        .setName('Google OAuth Client ID (development override)')
        .setDesc('Development-only Desktop OAuth Client ID. Production builds inject the official client ID at build time.')
        .addText(text => text
          .setPlaceholder('Development OAuth Client ID')
          .setValue(this.plugin.settings.oauthClientId)
          .onChange(async (value) => {
            this.plugin.settings.oauthClientId = value;
            await this.plugin.saveSettings();
          }));
    }
'''
if settings_block not in main: raise RuntimeError('OAuth settings block not found')
main = main.replace(settings_block, replacement, 1)
write('src/main.ts', main)

# Tests.
functional_tests = r'''import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/core/object-creation';
import { parseSharedSettings } from '../../src/core/shared-settings';
import { ObjectParser } from '../../src/core/objects';
import { dialPoint, projectDailySchedule } from '../../src/core/daily-presentation';
import { chooseNewestConflictSide, type ConflictArtifact } from '../../src/sync/coordinator';

const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  tracker_record:
    objectType: tracker_record
    markerType: property
    markerValue: "kind: tracker-record"
folder_paths:
  tracker_record: records/custom
---
`)!;

describe('V1 functional surfaces', () => {
  it('creates canonical TrackingRecord with tracker identity and field_values', () => {
    const built = buildQuickAddDocument(settings, 'tracker_record', {
      title: 'Energy record', body: '', date: '2026-09-16', trackerId: 'energy', trackerTitle: 'Energy',
      fieldValues: { score: 4, note: 'good' },
    }, 'record-1');
    expect(built.path).toBe('records/custom/record-1.md');
    const parsed = ObjectParser.parse(built.content).object as Record<string, unknown>;
    expect(parsed.type).toBe('tracker_record');
    expect(parsed.tracker_id).toBe('energy');
    expect(parsed.date).toBe('2026-09-16T00:00:00.000');
    expect(parsed.field_values).toEqual({ score: 4, note: 'good' });
    expect(parsed.kind).toBe('tracker-record');
  });

  it('projects the same daily snapshot into now/up-next/overdue and capability metadata', () => {
    const schedule = {
      kind: 'mixed', count: 3,
      items: [
        { id: 'task:a', sourceId: 'a', occurrenceId: 'a', date: '2026-09-16', start: '10:00', end: '11:00', isTimed: true },
        { id: 'reminder:b', sourceId: 'b', date: '2026-09-16', start: '12:00', end: '12:15', isTimed: true },
        { id: 'habit:c', sourceId: 'c', date: '2026-09-16', isTimed: false },
      ],
    };
    const sources = new Map([
      ['a', { id: 'a', type: 'task', title: 'Task', frontmatter: { title: 'Task' } }],
      ['b', { id: 'b', type: 'reminder', title: 'Reminder', frontmatter: { title: 'Reminder', scheduled_date: '2026-09-15' } }],
      ['c', { id: 'c', type: 'habit', title: 'Habit', frontmatter: { title: 'Habit' } }],
    ]);
    const view = projectDailySchedule(schedule, sources, '2026-09-16', 10 * 60 + 30);
    expect(view.now?.sourceId).toBe('a');
    expect(view.upNext.map(item => item.sourceId)).toEqual(['b']);
    expect(view.overdue.map(item => item.sourceId)).toEqual(['b']);
    expect(view.items[0]).toMatchObject({ sourceType: 'task', sourceLabel: 'Task', occurrenceId: 'a', isCompletable: true, origin: 'vault' });
  });

  it('maps midnight, 6h, noon and 18h to deterministic dial quadrants', () => {
    expect(dialPoint('00:00')).toMatchObject({ x: 100 });
    expect(dialPoint('06:00')!.x).toBeGreaterThan(180);
    expect(dialPoint('12:00')!.y).toBeGreaterThan(180);
    expect(dialPoint('18:00')!.x).toBeLessThan(20);
  });

  it('Keep newest is explicitly deterministic and never guesses ties', () => {
    const base: ConflictArtifact = {
      originalPath: 'task.md', localContent: new Uint8Array(), remoteContent: new Uint8Array(), localSha256: 'a', remoteSha256: 'b',
      remoteFileId: 'r', isBinary: false, timestamp: '2026-09-16T10:00:00.000Z', localExists: true, remoteExists: true,
      localModifiedTime: '2026-09-16T11:00:00.000Z', remoteModifiedTime: '2026-09-16T10:30:00.000Z',
    };
    expect(chooseNewestConflictSide(base)).toBe('keep_local');
    expect(chooseNewestConflictSide({ ...base, localModifiedTime: '2026-09-16T10:00:00.000Z', remoteModifiedTime: '2026-09-16T11:00:00.000Z' })).toBe('keep_drive');
    expect(() => chooseNewestConflictSide({ ...base, localModifiedTime: base.timestamp, remoteModifiedTime: base.timestamp })).toThrow(/unique newest/);
  });
});
'''
write('tests/contracts/v1_functional_surfaces.test.ts', functional_tests)

# Architecture checks for no placeholder occurrence persistence and production OAuth override behavior.
arch_path = ROOT / 'scripts/architecture-check.mjs'
arch = arch_path.read_text(encoding='utf-8')
insert = r'''
function checkNoPlaceholderOccurrencePersistence() {
  const placeholderPath = path.join(rootDir, 'src/core/occurrence_actions/service.ts');
  if (fs.existsSync(placeholderPath)) {
    console.error('FAIL: Placeholder OccurrenceActionService must not ship as a production mutation path');
    return false;
  }
  console.log('PASS: No placeholder occurrence mutation service');
  return true;
}
'''
arch = arch.replace('function main() {', insert + '\nfunction main() {')
arch = arch.replace("  if (!checkNoHardcodedQuickAddFolders()) allPassed = false;\n", "  if (!checkNoHardcodedQuickAddFolders()) allPassed = false;\n  if (!checkNoPlaceholderOccurrencePersistence()) allPassed = false;\n")
write('scripts/architecture-check.mjs', arch)

print('V1 functional repair applied')
