import { hasFullObjectMutationSupport } from '../../core/object-mutation';
import type { IndexedObject } from '../../vault/index/types';

export interface ObjectDetailProperty {
  key: string;
  label: string;
  value: string;
}

export interface ObjectDetailModel {
  title: string;
  type: string;
  path: string;
  properties: ObjectDetailProperty[];
  relationships: ObjectDetailProperty[];
  schedule: string | null;
  reminders: string | null;
  body: string;
}

const BASE_KEYS = new Set(['id', 'type', 'title']);
const RELATIONSHIP_KEYS = new Set(['links', 'organizers', 'categories', 'tags']);
const SCHEDULE_KEYS = new Set(['scheduler', 'schedulers']);

function labelForKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function stableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildObjectDetailModel(object: IndexedObject): ObjectDetailModel {
  const properties: ObjectDetailProperty[] = [];
  const relationships: ObjectDetailProperty[] = [];
  let schedule: string | null = null;
  let reminders: string | null = null;

  for (const [key, rawValue] of Object.entries(object.frontmatter)) {
    if (BASE_KEYS.has(key)) continue;
    const value = stableValue(rawValue);
    if (!value) continue;
    const property = { key, label: labelForKey(key), value };
    if (RELATIONSHIP_KEYS.has(key)) {
      relationships.push(property);
    } else if (SCHEDULE_KEYS.has(key)) {
      schedule = value;
    } else if (key === 'reminders') {
      reminders = value;
    } else {
      properties.push(property);
    }
  }

  properties.sort((left, right) => left.label.localeCompare(right.label));
  relationships.sort((left, right) => left.label.localeCompare(right.label));

  return {
    title: String(object.frontmatter.title ?? 'Untitled'),
    type: object.type,
    path: object.path,
    properties,
    relationships,
    schedule,
    reminders,
    body: object.body,
  };
}

export interface ObjectDetailActions {
  onBack(): void;
  onOpenMarkdown(): void;
  onEdit?(): void;
}

function appendPropertySection(
  container: HTMLElement,
  title: string,
  properties: ObjectDetailProperty[],
): void {
  if (properties.length === 0) return;
  const section = document.createElement('section');
  section.className = 'quartzo-detail-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);
  const list = document.createElement('dl');
  for (const property of properties) {
    const term = document.createElement('dt');
    term.textContent = property.label;
    const description = document.createElement('dd');
    description.textContent = property.value;
    list.append(term, description);
  }
  section.appendChild(list);
  container.appendChild(section);
}

function appendTextSection(container: HTMLElement, title: string, value: string | null): void {
  if (!value) return;
  const section = document.createElement('section');
  section.className = 'quartzo-detail-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const content = document.createElement('pre');
  content.textContent = value;
  section.append(heading, content);
  container.appendChild(section);
}

export function renderObjectDetail(
  container: HTMLElement,
  object: IndexedObject,
  actions: ObjectDetailActions,
): void {
  const model = buildObjectDetailModel(object);

  const toolbar = document.createElement('div');
  toolbar.className = 'quartzo-detail-toolbar';
  const back = document.createElement('button');
  back.textContent = 'Back';
  back.addEventListener('click', actions.onBack);
  const openMarkdown = document.createElement('button');
  openMarkdown.textContent = 'Open Markdown';
  openMarkdown.addEventListener('click', actions.onOpenMarkdown);
  toolbar.appendChild(back);
  if (actions.onEdit && hasFullObjectMutationSupport(object.type)) {
    const edit = document.createElement('button');
    edit.textContent = 'Edit';
    edit.className = 'mod-cta';
    edit.addEventListener('click', actions.onEdit);
    toolbar.appendChild(edit);
  }
  toolbar.appendChild(openMarkdown);
  container.appendChild(toolbar);

  const title = document.createElement('h2');
  title.textContent = model.title;
  container.appendChild(title);
  const metadata = document.createElement('p');
  metadata.textContent = `${labelForKey(model.type)} · ${model.path}`;
  container.appendChild(metadata);

  appendPropertySection(container, 'Properties', model.properties);
  appendPropertySection(container, 'Relationships', model.relationships);
  appendTextSection(container, 'Schedule', model.schedule);
  appendTextSection(container, 'Reminders', model.reminders);
  appendTextSection(container, 'Content', model.body.trim() || null);
}
