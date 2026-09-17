import type { TrackerDefinition } from './objects/types';

export type TrackerFieldType =
  | 'text'
  | 'selection'
  | 'quantity'
  | 'checklist'
  | 'checkbox'
  | 'media'
  | 'mood'
  | 'range'
  | 'duration';

export interface TrackerCaptureField {
  id: string;
  title: string;
  type: TrackerFieldType;
  defaultValue?: unknown;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  optionsSourceCollectionSlug?: string;
}

export interface TrackerCaptureSection {
  title: string;
  fields: TrackerCaptureField[];
}

export interface TrackerCaptureDefinition {
  id: string;
  title: string;
  sections: TrackerCaptureSection[];
}

const FIELD_TYPES = new Set<TrackerFieldType>([
  'text',
  'selection',
  'quantity',
  'checklist',
  'checkbox',
  'media',
  'mood',
  'range',
  'duration',
]);

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be numeric.`);
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const parsed = String(value).trim();
  return parsed || undefined;
}

function parseField(raw: unknown): TrackerCaptureField {
  const field = asRecord(raw, 'Tracker field');
  const id = optionalString(field.id ?? field.slug);
  const title = optionalString(field.title ?? field.name);
  const rawType = optionalString(field.type) ?? 'text';
  if (!id || !title) throw new Error('Tracker fields require id and title.');
  if (!FIELD_TYPES.has(rawType as TrackerFieldType)) {
    throw new Error(`Unsupported tracker field type: ${rawType}`);
  }

  const options = field.options == null
    ? undefined
    : Array.isArray(field.options)
      ? field.options.map(option => String(option))
      : (() => { throw new Error(`Tracker field ${id} options must be a list.`); })();
  const min = optionalNumber(field.min, `Tracker field ${id} min`);
  const max = optionalNumber(field.max, `Tracker field ${id} max`);
  if (min != null && max != null && min > max) {
    throw new Error(`Tracker field ${id} min cannot exceed max.`);
  }

  return {
    id,
    title,
    type: rawType as TrackerFieldType,
    defaultValue: field.default_value,
    unit: optionalString(field.unit),
    min,
    max,
    options,
    optionsSourceCollectionSlug: optionalString(field.options_source_collection_slug),
  };
}

export function projectTrackerForCapture(tracker: TrackerDefinition): TrackerCaptureDefinition {
  const sections = tracker.sections ?? [];
  return {
    id: tracker.id,
    title: tracker.title,
    sections: sections.map((section, sectionIndex) => ({
      title: section.title ?? '',
      fields: (section.input_fields ?? []).map((field, fieldIndex) => {
        try {
          return parseField(field);
        } catch (error) {
          throw new Error(
            `Tracker ${tracker.title || tracker.id}, section ${sectionIndex + 1}, field ${fieldIndex + 1}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    })),
  };
}

export function assertTrackerCaptureSupported(definition: TrackerCaptureDefinition): void {
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.type === 'media') {
        throw new Error(`Tracker field “${field.title}” uses media, which is not safely writable in Companion yet.`);
      }
      if ((field.type === 'selection' || field.type === 'checklist') && field.optionsSourceCollectionSlug) {
        throw new Error(
          `Tracker field “${field.title}” uses collection-backed options, which are not safely writable in Companion yet.`,
        );
      }
    }
  }
}

export function initialTrackerFieldValue(field: TrackerCaptureField): unknown {
  if (field.type === 'checkbox') return typeof field.defaultValue === 'boolean' ? field.defaultValue : false;
  if (field.type === 'range') return field.defaultValue ?? field.min ?? 0;
  if (field.type === 'quantity') return field.defaultValue ?? 0;
  return field.defaultValue;
}

export function normalizeRecordedTrackerValues(
  definition: TrackerCaptureDefinition,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (!Object.prototype.hasOwnProperty.call(values, field.id)) continue;
      const value = values[field.id];
      switch (field.type) {
        case 'checkbox':
          result[field.id] = value === true;
          break;
        case 'quantity':
        case 'range': {
          const parsed = typeof value === 'number' ? value : Number(value);
          if (Number.isFinite(parsed)) result[field.id] = parsed;
          break;
        }
        case 'duration':
        case 'text':
        case 'selection': {
          const text = value == null ? '' : String(value).trim();
          if (text) result[field.id] = text;
          break;
        }
        case 'checklist':
          if (Array.isArray(value)) {
            const selected = value.map(item => String(item).trim()).filter(Boolean);
            if (selected.length > 0) result[field.id] = selected;
          }
          break;
        case 'mood':
          if (typeof value === 'number' && Number.isFinite(value)) result[field.id] = Math.trunc(value);
          break;
        case 'media':
          if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0) {
            result[field.id] = { ...(value as Record<string, unknown>) };
          }
          break;
      }
    }
  }
  return result;
}
