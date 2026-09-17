import {
  assertTrackerCaptureSupported,
  initialTrackerFieldValue,
  normalizeRecordedTrackerValues,
  projectTrackerForCapture,
  type TrackerCaptureDefinition,
  type TrackerCaptureField,
} from '../../core/tracker-capture';
import type { TrackerDefinition } from '../../core/objects/types';

export interface TrackerRecordQuickAddValue {
  trackerId: string;
  trackerTitle: string;
  date: string;
  fieldValues: Record<string, unknown>;
}

export interface TrackerRecordFormController {
  value(): TrackerRecordQuickAddValue;
}

type ValueReader = () => unknown;

function fieldRow(field: TrackerCaptureField, readers: Map<string, ValueReader>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'quartzo-record-field';
  const label = document.createElement('label');
  label.textContent = field.unit ? `${field.title} (${field.unit})` : field.title;
  row.appendChild(label);
  const initial = initialTrackerFieldValue(field);

  if (field.type === 'checkbox') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial === true;
    row.appendChild(input);
    readers.set(field.id, () => input.checked);
    return row;
  }

  if (field.type === 'selection') {
    const input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select…';
    input.appendChild(blank);
    for (const option of field.options ?? []) {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = option;
      item.selected = initial === option;
      input.appendChild(item);
    }
    row.appendChild(input);
    readers.set(field.id, () => input.value);
    return row;
  }

  if (field.type === 'checklist') {
    const input = document.createElement('select');
    input.multiple = true;
    const defaults = Array.isArray(initial) ? initial.map(String) : [];
    for (const option of field.options ?? []) {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = option;
      item.selected = defaults.includes(option);
      input.appendChild(item);
    }
    row.appendChild(input);
    readers.set(field.id, () => Array.from(input.selectedOptions).map(option => option.value));
    return row;
  }

  if (field.type === 'mood') {
    const input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Not set';
    input.appendChild(blank);
    const moods = ['😞', '😕', '😐', '🙂', '😄'];
    for (let index = 0; index < moods.length; index += 1) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = moods[index];
      option.selected = initial === index;
      input.appendChild(option);
    }
    row.appendChild(input);
    readers.set(field.id, () => input.value === '' ? undefined : Number(input.value));
    return row;
  }

  const input = document.createElement('input');
  input.className = 'quartzo-input';
  if (field.type === 'quantity') {
    input.type = 'number';
    input.step = 'any';
  } else if (field.type === 'range') {
    input.type = 'range';
    input.min = String(field.min ?? 0);
    input.max = String(field.max ?? 10);
    input.step = '1';
  } else {
    input.type = 'text';
    if (field.type === 'duration') input.placeholder = '00:00';
  }
  if (initial != null) input.value = String(initial);
  row.appendChild(input);
  readers.set(field.id, () => input.value);
  return row;
}

function renderDefinition(
  container: HTMLElement,
  definition: TrackerCaptureDefinition,
  readers: Map<string, ValueReader>,
): void {
  container.empty?.();
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const section of definition.sections) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'quartzo-record-section';
    if (section.title.trim()) {
      const heading = document.createElement('h4');
      heading.textContent = section.title;
      sectionEl.appendChild(heading);
    }
    for (const field of section.fields) sectionEl.appendChild(fieldRow(field, readers));
    container.appendChild(sectionEl);
  }
}

export function renderTrackerRecordQuickAdd(
  container: HTMLElement,
  trackers: TrackerDefinition[],
  today: string,
): TrackerRecordFormController {
  const wrapper = document.createElement('section');
  wrapper.className = 'quartzo-record-quick-add';
  container.appendChild(wrapper);

  const status = document.createElement('small');
  const select = document.createElement('select');
  select.className = 'quartzo-input';
  select.setAttribute('aria-label', 'Tracker');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = trackers.length === 0 ? 'No trackers available' : 'Select tracker';
  select.appendChild(placeholder);
  for (const tracker of trackers) {
    const option = document.createElement('option');
    option.value = tracker.id;
    option.textContent = tracker.title || tracker.id;
    select.appendChild(option);
  }
  wrapper.appendChild(select);

  const date = document.createElement('input');
  date.type = 'date';
  date.value = today;
  date.max = today;
  date.className = 'quartzo-input';
  wrapper.appendChild(date);

  const fields = document.createElement('div');
  fields.className = 'quartzo-record-fields';
  wrapper.appendChild(fields);
  wrapper.appendChild(status);

  let selected: TrackerCaptureDefinition | null = null;
  const readers = new Map<string, ValueReader>();
  const refresh = (): void => {
    readers.clear();
    selected = null;
    while (fields.firstChild) fields.removeChild(fields.firstChild);
    const tracker = trackers.find(item => item.id === select.value);
    if (!tracker) {
      status.textContent = trackers.length === 0
        ? 'Create a Tracker in Quartzo before logging a Record.'
        : 'Choose a Tracker to show its fields.';
      return;
    }
    try {
      const projected = projectTrackerForCapture(tracker);
      assertTrackerCaptureSupported(projected);
      selected = projected;
      renderDefinition(fields, projected, readers);
      status.textContent = projected.sections.length === 0
        ? 'This Tracker has no fields. The Record will still retain its Tracker and date.'
        : '';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  select.addEventListener('change', refresh);
  refresh();

  return {
    value(): TrackerRecordQuickAddValue {
      if (!selected) throw new Error('Select a supported Tracker before creating a Record.');
      if (!date.value) throw new Error('Record date is required.');
      const rawValues: Record<string, unknown> = {};
      for (const [fieldId, read] of readers) rawValues[fieldId] = read();
      return {
        trackerId: selected.id,
        trackerTitle: selected.title,
        date: `${date.value}T00:00:00.000`,
        fieldValues: normalizeRecordedTrackerValues(selected, rawValues),
      };
    },
  };
}
