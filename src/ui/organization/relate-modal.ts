/**
 * Relate / Add to Modal (§36)
 *
 * Allows the user to relate one or more selected objects to an existing object.
 * Reuses the canonical universal object picker (§95).
 * Writes via SafeObjectMutationRepository — NOT via companion_relations.
 */
import { Modal, Notice } from 'obsidian';
import type { ViewContext } from '../types';
import { renderObjectPicker } from './object-picker';
import type { IndexedObject } from '../../vault/index/types';
import { SharedSettingsRepository } from '../../vault/shared-settings';
import { SafeObjectMutationRepository } from '../../vault/object-mutation';

export interface RelateModalOptions {
  sourceFiles: string[];
}

const RELATIONSHIP_FIELDS = ['related_to', 'links', 'organizer'] as const;
type RelationshipField = typeof RELATIONSHIP_FIELDS[number];

export class RelateModal extends Modal {
  private settingsRepository: SharedSettingsRepository;
  private mutationRepository: SafeObjectMutationRepository;
  private targetObject: IndexedObject | null = null;
  private relationshipField: RelationshipField = 'related_to';

  constructor(
    private readonly context: ViewContext,
    private readonly options: RelateModalOptions,
  ) {
    super(context.app);
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
    this.mutationRepository = new SafeObjectMutationRepository(context.app.vault);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const count = this.options.sourceFiles.length;
    contentEl.createEl('h2', { text: `Add ${count} object${count !== 1 ? 's' : ''} to...` });
    contentEl.createEl('p', {
      text: 'Select an existing object to relate these to.',
      attr: { style: 'color: var(--text-muted); margin-bottom: 12px;' }
    });

    // Relationship field selector
    const fieldRow = contentEl.createEl('div', { attr: { style: 'margin-bottom: 12px;' } });
    fieldRow.createEl('label', { text: 'Relationship field:', attr: { style: 'margin-right: 8px;' } });
    const fieldSelect = fieldRow.createEl('select', { cls: 'quartzo-input' });
    for (const field of RELATIONSHIP_FIELDS) {
      const opt = fieldSelect.createEl('option', { value: field, text: field });
      if (field === this.relationshipField) opt.selected = true;
    }
    fieldSelect.addEventListener('change', (e) => {
      this.relationshipField = (e.target as HTMLSelectElement).value as RelationshipField;
    });

    // Object picker area
    const pickerContainer = contentEl.createEl('div');

    // Show current selection
    const selectedPreview = contentEl.createEl('div', {
      attr: { style: 'margin-top: 12px; padding: 8px; background: var(--background-secondary); border-radius: 4px; min-height: 40px;' }
    });
    selectedPreview.createEl('em', { text: 'No target object selected.' });

    renderObjectPicker(pickerContainer, this.context, {
      multiple: false,
      excludedIds: [],
      placeholder: 'Search for target object...',
      onPick: (picked) => {
        this.targetObject = picked[0] ?? null;
        selectedPreview.empty();
        if (this.targetObject) {
          selectedPreview.createEl('strong', { text: `Target: ${String(this.targetObject.frontmatter.title ?? this.targetObject.id)}` });
          selectedPreview.createEl('span', { text: ` (${this.targetObject.type})` });
        }
      },
    });

    // Apply button
    const actionsEl = contentEl.createEl('div', { cls: 'modal-button-container', attr: { style: 'margin-top: 16px;' } });

    const applyBtn = actionsEl.createEl('button', { text: 'Add relationship', cls: 'mod-cta' });
    applyBtn.addEventListener('click', async () => {
      if (!this.targetObject) {
        new Notice('Select a target object first.');
        return;
      }
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying...';

      const wikilinkTarget = `[[${this.targetObject.path.replace(/\.md$/, '')}]]`;
      let successCount = 0;
      let errorCount = 0;

      for (const filePath of this.options.sourceFiles) {
        try {
          const settings = await this.settingsRepository.load();
          if (!settings) throw new Error('Settings not available');

          await this.mutationRepository.mutate(filePath, (currentMarkdown) => {
            // Parse and add the relationship field
            const lines = currentMarkdown.split('\n');
            const fmStart = lines.indexOf('---');
            const fmEnd = lines.indexOf('---', fmStart + 1);

            if (fmStart === -1 || fmEnd === -1) {
              // No frontmatter — just append
              return currentMarkdown;
            }

            const fieldLine = this.relationshipField + ':';
            let existingFieldIdx = -1;
            for (let i = fmStart + 1; i < fmEnd; i++) {
              if (lines[i].startsWith(fieldLine)) {
                existingFieldIdx = i;
                break;
              }
            }

            if (existingFieldIdx >= 0) {
              // Try to append to existing array field
              const existingValue = lines[existingFieldIdx].slice(fieldLine.length).trim();
              if (existingValue.startsWith('[') && existingValue.endsWith(']')) {
                const inner = existingValue.slice(1, -1);
                const parts = inner ? inner.split(',').map(s => s.trim()) : [];
                if (!parts.includes(wikilinkTarget)) {
                  parts.push(wikilinkTarget);
                }
                lines[existingFieldIdx] = `${fieldLine} [${parts.join(', ')}]`;
              } else {
                // Convert to array
                const existing = existingValue || '';
                const parts = existing ? [existing] : [];
                if (!parts.includes(wikilinkTarget)) parts.push(wikilinkTarget);
                lines[existingFieldIdx] = `${fieldLine} [${parts.join(', ')}]`;
              }
            } else {
              // Insert new field before closing ---
              lines.splice(fmEnd, 0, `${fieldLine} [${wikilinkTarget}]`);
            }

            return lines.join('\n');
          });
          successCount++;
        } catch (e) {
          errorCount++;
          console.error(`Relate failed for ${filePath}:`, e);
        }
      }

      if (errorCount === 0) {
        new Notice(`✓ Related ${successCount} object${successCount !== 1 ? 's' : ''} to "${String(this.targetObject.frontmatter.title ?? this.targetObject.id)}".`);
      } else {
        new Notice(`${successCount} succeeded, ${errorCount} failed. Check console.`);
      }
      this.close();
    });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
  }
}
