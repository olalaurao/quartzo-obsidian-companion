import type { IndexedObject } from '../../vault/index/types';

export type ObjectEditorFieldKind =
  | 'text'
  | 'textarea'
  | 'date'
  | 'time'
  | 'url'
  | 'color'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'lines';

export interface ObjectEditorField {
  key: string;
  label: string;
  kind: ObjectEditorFieldKind;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

const COMMON_RESOURCE_FIELDS: ObjectEditorField[] = [
  { key: 'media_type', label: 'Media type', kind: 'text', required: true },
  { key: 'source_url', label: 'Source URL', kind: 'url' },
  { key: 'status', label: 'Status', kind: 'select', options: ['toConsume', 'inProgress', 'completed', 'dropped'] },
  { key: 'priority', label: 'Priority', kind: 'select', options: ['none', 'low', 'medium', 'high'] },
  { key: 'rating', label: 'Rating', kind: 'number' },
  { key: 'author', label: 'Author', kind: 'text' },
  { key: 'year', label: 'Year', kind: 'number' },
  { key: 'pages', label: 'Pages', kind: 'number' },
  { key: 'category', label: 'Category', kind: 'text' },
  { key: 'isbn', label: 'ISBN', kind: 'text' },
  { key: 'language', label: 'Language', kind: 'text' },
  { key: 'categories', label: 'Categories', kind: 'lines', placeholder: 'One category per line' },
  { key: 'tags', label: 'Tags', kind: 'lines', placeholder: 'One tag per line' },
  { key: 'links', label: 'Links', kind: 'lines', placeholder: 'One wikilink per line' },
];

export function editorFieldsForObject(object: IndexedObject): ObjectEditorField[] {
  switch (object.type) {
    case 'task':
      return [{ key: 'archived', label: 'Archived', kind: 'checkbox' }];
    case 'habit':
      return [
        { key: 'color', label: 'Color', kind: 'color' },
        { key: 'status', label: 'Status', kind: 'text' },
        { key: 'negative', label: 'Negative habit', kind: 'checkbox' },
      ];
    case 'tracker_definition':
      return [];
    case 'tracker_record':
      return [
        { key: 'tracker_id', label: 'Tracker ID', kind: 'text', required: true },
        { key: 'date', label: 'Date', kind: 'date', required: true },
      ];
    case 'entry':
      return [
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'time', label: 'Time', kind: 'time' },
      ];
    case 'note':
      return [
        { key: 'note_subtype', label: 'Note subtype', kind: 'text' },
        { key: 'links', label: 'Links', kind: 'lines', placeholder: 'One wikilink per line' },
      ];
    case 'reminder':
      return [
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'time', label: 'Time', kind: 'time', required: true },
        { key: 'notes', label: 'Notes', kind: 'textarea' },
      ];
    case 'resource':
      return COMMON_RESOURCE_FIELDS;
    default:
      return [];
  }
}

export function fieldDisplayValue(object: IndexedObject, field: ObjectEditorField): string | boolean {
  const value = object.frontmatter[field.key];
  if (field.kind === 'checkbox') return value === true;
  if (field.kind === 'lines') {
    if (!Array.isArray(value)) return '';
    return value.map(item => String(item)).join('\n');
  }
  return value == null ? '' : String(value);
}

export function parseEditorFieldValue(
  field: ObjectEditorField,
  raw: string | boolean,
): { action: 'set'; value: unknown } | { action: 'unset' } {
  if (field.kind === 'checkbox') return { action: 'set', value: raw === true };
  const text = String(raw).trim();
  if (!text) {
    if (field.required) throw new Error(`${field.label} is required.`);
    return { action: 'unset' };
  }
  if (field.kind === 'number') {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`${field.label} must be a number.`);
    return { action: 'set', value };
  }
  if (field.kind === 'lines') {
    return {
      action: 'set',
      value: String(raw).split(/\r?\n/).map(item => item.trim()).filter(Boolean),
    };
  }
  return { action: 'set', value: String(raw).trim() };
}
