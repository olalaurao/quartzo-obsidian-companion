import { Notice } from 'obsidian';
import type { SafeObjectMutation } from '../../core/object-mutation';
import type { IndexedObject } from '../../vault/index/types';
import {
  editorFieldsForObject,
  fieldDisplayValue,
  parseEditorFieldValue,
  type ObjectEditorField,
} from './editor-schema';

export interface ObjectEditorActions {
  onCancel(): void;
  onSave(patch: SafeObjectMutation): Promise<void>;
}

type EditorControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function createFieldControl(field: ObjectEditorField, value: string | boolean): EditorControl {
  if (field.kind === 'textarea' || field.kind === 'lines') {
    const textarea = document.createElement('textarea');
    textarea.value = String(value);
    textarea.placeholder = field.placeholder ?? '';
    return textarea;
  }
  if (field.kind === 'select') {
    const select = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    select.appendChild(blank);
    for (const optionValue of field.options ?? []) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue;
      select.appendChild(option);
    }
    select.value = String(value);
    return select;
  }
  const input = document.createElement('input');
  input.type = field.kind === 'checkbox' ? 'checkbox' : field.kind;
  if (field.kind === 'checkbox') input.checked = value === true;
  else input.value = String(value);
  input.placeholder = field.placeholder ?? '';
  return input;
}

function currentControlValue(field: ObjectEditorField, control: EditorControl): string | boolean {
  if (field.kind === 'checkbox' && control instanceof HTMLInputElement) return control.checked;
  return control.value;
}

export function renderObjectEditor(
  container: HTMLElement,
  object: IndexedObject,
  actions: ObjectEditorActions,
): void {
  const heading = document.createElement('h2');
  heading.textContent = `Edit ${String(object.frontmatter.title ?? object.id)}`;
  container.appendChild(heading);

  const safety = document.createElement('p');
  safety.className = 'quartzo-detail-edit-safety';
  safety.textContent = 'Only fields you change are written. Other YAML/frontmatter fields are preserved from the current file.';
  container.appendChild(safety);

  const form = document.createElement('form');
  form.className = 'quartzo-detail-editor';

  const dirty = new Set<string>();
  let bodyDirty = false;
  const controls = new Map<string, { field: ObjectEditorField; control: EditorControl }>();

  const addField = (field: ObjectEditorField, value: string | boolean): void => {
    const row = document.createElement('label');
    row.className = 'quartzo-detail-editor-field';
    const label = document.createElement('span');
    label.textContent = field.label;
    row.appendChild(label);
    const control = createFieldControl(field, value);
    control.classList.add('quartzo-input');
    const eventName = field.kind === 'checkbox' || field.kind === 'select' ? 'change' : 'input';
    control.addEventListener(eventName, () => {
      dirty.add(field.key);
      save.disabled = false;
    });
    row.appendChild(control);
    form.appendChild(row);
    controls.set(field.key, { field, control });
  };

  addField({ key: 'title', label: 'Title', kind: 'text', required: true }, String(object.frontmatter.title ?? ''));

  for (const field of editorFieldsForObject(object)) {
    addField(field, fieldDisplayValue(object, field));
  }

  const bodyField = document.createElement('label');
  bodyField.className = 'quartzo-detail-editor-field';
  const bodyLabel = document.createElement('span');
  bodyLabel.textContent = 'Content';
  const body = document.createElement('textarea');
  body.className = 'quartzo-input quartzo-detail-editor-body';
  body.value = object.body;
  body.addEventListener('input', () => {
    bodyDirty = true;
    save.disabled = false;
  });
  bodyField.append(bodyLabel, body);
  form.appendChild(bodyField);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'quartzo-modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', actions.onCancel);

  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  save.className = 'mod-cta';
  save.disabled = true;

  actionsRow.append(cancel, save);
  form.appendChild(actionsRow);

  form.addEventListener('submit', event => {
    event.preventDefault();
    void (async () => {
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      try {
        for (const key of dirty) {
          const entry = controls.get(key);
          if (!entry) continue;
          const parsed = parseEditorFieldValue(entry.field, currentControlValue(entry.field, entry.control));
          if (parsed.action === 'set') set[key] = parsed.value;
          else unset.push(key);
        }
        const patch: SafeObjectMutation = {
          ...(Object.keys(set).length > 0 ? { set } : {}),
          ...(unset.length > 0 ? { unset } : {}),
          ...(bodyDirty ? { body: body.value } : {}),
        };
        save.disabled = true;
        cancel.disabled = true;
        await actions.onSave(patch);
      } catch (error) {
        save.disabled = false;
        cancel.disabled = false;
        new Notice(error instanceof Error ? error.message : String(error));
      }
    })();
  });

  container.appendChild(form);
}
