/**
 * Universal Object Picker (§95)
 *
 * Reusable picker for selecting one or more objects from VaultIndex.
 * Used for: Add to, Relate, merge-into future flows.
 * Does NOT create a new search engine — uses existing VaultIndex/object-query.
 */
import type { ViewContext } from '../types';
import type { IndexedObject } from '../../vault/index/types';
import { queryVaultObjects } from '../../core/object-query';

export interface ObjectPickerOptions {
  allowedTypes?: string[];
  excludedIds?: string[];
  multiple?: boolean;
  placeholder?: string;
  onPick(selected: IndexedObject[]): void;
  onCancel?(): void;
}

export function renderObjectPicker(
  container: HTMLElement,
  context: ViewContext,
  options: ObjectPickerOptions,
): void {
  container.empty();

  const index = context.vaultIndexEngine?.getIndex() ?? context.plugin.vaultIndexEngine?.getIndex();
  if (!index) {
    container.createEl('p', { text: 'Vault index not available.' });
    return;
  }

  let allObjects = queryVaultObjects(index);

  if (options.allowedTypes && options.allowedTypes.length > 0) {
    allObjects = allObjects.filter(o => options.allowedTypes!.includes(o.type));
  }
  if (options.excludedIds && options.excludedIds.length > 0) {
    const excluded = new Set(options.excludedIds);
    allObjects = allObjects.filter(o => !excluded.has(o.id));
  }

  const selected = new Set<string>();

  // Search input
  const searchInput = container.createEl('input', {
    type: 'text',
    placeholder: options.placeholder ?? 'Search objects...',
    cls: 'quartzo-input',
    attr: { 'aria-label': 'Search objects', style: 'width: 100%; margin-bottom: 8px;' }
  });

  const listEl = container.createEl('ul', {
    cls: 'quartzo-object-picker-list',
    attr: { role: 'listbox', style: 'max-height: 300px; overflow-y: auto; list-style: none; padding: 0;' }
  });

  const renderList = (filter: string): void => {
    listEl.empty();
    const filtered = filter
      ? allObjects.filter(o =>
          String(o.frontmatter.title ?? o.id).toLowerCase().includes(filter.toLowerCase()) ||
          o.type.toLowerCase().includes(filter.toLowerCase())
        )
      : allObjects;

    const display = filtered.slice(0, 100);
    for (const obj of display) {
      const li = listEl.createEl('li', {
        attr: {
          role: 'option',
          'aria-selected': selected.has(obj.id) ? 'true' : 'false',
          style: `padding: 6px 8px; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; ${selected.has(obj.id) ? 'background: var(--interactive-accent); color: white;' : ''}`
        }
      });
      li.createEl('span', { text: String(obj.frontmatter.title ?? obj.id) });
      li.createEl('small', { text: obj.type, attr: { style: 'opacity: 0.7; font-size: 0.85em;' } });

      li.addEventListener('click', () => {
        if (options.multiple) {
          if (selected.has(obj.id)) {
            selected.delete(obj.id);
          } else {
            selected.add(obj.id);
          }
          renderList(searchInput.value);
        } else {
          // Single: pick immediately
          options.onPick([obj]);
        }
      });
    }

    if (filtered.length > 100) {
      listEl.createEl('li', {
        text: `${filtered.length - 100} more results. Refine your search.`,
        attr: { style: 'padding: 6px 8px; opacity: 0.6; font-size: 0.85em;' }
      });
    }
  };

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList('');

  if (options.multiple) {
    const footer = container.createEl('div', { attr: { style: 'margin-top: 10px; display: flex; gap: 8px;' } });
    const confirmBtn = footer.createEl('button', { text: 'Add selected', cls: 'mod-cta' });
    confirmBtn.addEventListener('click', () => {
      const picks = allObjects.filter(o => selected.has(o.id));
      options.onPick(picks);
    });
    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => options.onCancel?.());
  }
}
