import { Modal, Notice, Setting, normalizePath } from 'obsidian';
import type { ViewContext } from '../types';
import { resolveOrganizationScope, describeScopeForDisplay } from '../../core/object-organization/scope-resolver';
import { planOrganize, type OrganizePlan, type PropertyOperation } from '../../core/object-organization/organize';
import { ObjectOrganizationRepository } from '../../vault/object-organization';
import { SharedSettingsRepository, type QuartzoSharedSettings } from '../../vault/shared-settings';

export interface ObjectOrganizationModalOptions {
  files?: string[];
  folders?: string[];
}

export class ObjectOrganizationModal extends Modal {
  private settingsRepository: SharedSettingsRepository;
  private orgRepository: ObjectOrganizationRepository;
  private sharedSettings: QuartzoSharedSettings | null = null;
  
  // UI State
  private includeSubfolders = false;
  private targetType: string = '';
  private destinationFolder: string = '';
  private propertyOperations: PropertyOperation[] = [];
  private currentPlan: OrganizePlan | null = null;
  private isApplying = false;

  constructor(
    private readonly context: ViewContext,
    private readonly options: ObjectOrganizationModalOptions,
  ) {
    super(context.app);
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
    this.orgRepository = new ObjectOrganizationRepository(context.app.vault, this.settingsRepository);
  }

  async onOpen(): Promise<void> {
    this.sharedSettings = await this.settingsRepository.load();
    if (!this.sharedSettings) {
      new Notice('Shared settings not found.');
      this.close();
      return;
    }
    
    // Set targetType default if single selection is already an object
    if (this.options.files?.length === 1 && !this.options.folders?.length) {
       const index = this.context.vaultIndexEngine?.getIndex();
       const obj = index?.objects.get(this.options.files[0]);
       if (obj) this.targetType = obj.type;
    }

    await this.refreshPlan();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async refreshPlan(): Promise<void> {
    if (!this.sharedSettings) return;

    const vaultFiles = this.context.app.vault.getFiles().map(f => f.path);
    const index = this.context.vaultIndexEngine?.getIndex();
    const indexedByPath = new Map<string, string>();
    if (index) {
      for (const obj of index.objects.values()) {
        indexedByPath.set(obj.path, obj.id);
      }
    }

    const scope = resolveOrganizationScope({
      files: this.options.files,
      folders: this.options.folders,
      includeSubfolders: this.includeSubfolders,
      allVaultPaths: vaultFiles,
      indexedObjectsByPath: indexedByPath,
    });

    const vaultState = {
      paths: new Set(vaultFiles),
      readMarkdown: (path: string) => {
        // Fast path: if it's indexed, we have the body. If not, we have to read it.
        // For synchronous planner, we assume the index is fresh enough or we preload.
        // In reality, we'd need to async load unindexed files. For UI speed, we use indexed data.
        const objId = indexedByPath.get(path);
        if (objId && index) {
          const obj = index.objects.get(objId);
          if (obj) {
             const frontmatter = { ...obj.frontmatter };
             delete frontmatter.position;
             // Serialize mocked version
             return `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${obj.body}`; 
          }
        }
        return ''; // Stub for missing async read
      }
    };

    this.currentPlan = planOrganize({
      scope,
      targetType: this.targetType || undefined,
      destinationFolder: this.destinationFolder || undefined,
      propertyOperations: this.propertyOperations,
      settingsRevision: Number(this.sharedSettings.objectIdentification.revision) || 0,
      settings: this.sharedSettings,
      vaultState,
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    
    if (!this.currentPlan) {
      contentEl.createEl('p', { text: 'Loading...' });
      return;
    }

    contentEl.createEl('h2', { text: 'Organize Objects' });

    // 1. Scope Summary
    const summary = describeScopeForDisplay(this.currentPlan.scope);
    const scopeEl = contentEl.createEl('div', { cls: 'quartzo-org-scope' });
    scopeEl.createEl('p', { text: summary.summary });
    
    if (this.options.folders?.length) {
      new Setting(scopeEl)
        .setName('Include subfolders')
        .addToggle(toggle => toggle
          .setValue(this.includeSubfolders)
          .onChange(async (val) => {
            this.includeSubfolders = val;
            await this.refreshPlan();
            this.render();
          })
        );
    }

    // 2. Reclassify
    contentEl.createEl('h3', { text: 'Type & Location' });
    const types = Object.keys(this.sharedSettings?.typeSignatures || {});
    new Setting(contentEl)
      .setName('Set Object Type')
      .setDesc('Assign canonical identification rules to the selection. Leave blank to preserve existing.')
      .addDropdown(dd => {
        dd.addOption('', '(No change)');
        types.forEach(t => dd.addOption(t, t));
        dd.setValue(this.targetType);
        dd.onChange(async val => {
          this.targetType = val;
          await this.refreshPlan();
          this.render();
        });
      });

    new Setting(contentEl)
      .setName('Move to Folder')
      .setDesc('Optionally move selected items into a specific folder.')
      .addText(text => text
        .setValue(this.destinationFolder)
        .onChange(async val => {
          this.destinationFolder = val;
          await this.refreshPlan();
          this.render();
        })
      );

    // 3. Bulk Properties
    contentEl.createEl('h3', { text: 'Bulk Properties' });
    const propList = contentEl.createEl('div', { cls: 'quartzo-bulk-props' });
    for (let i = 0; i < this.propertyOperations.length; i++) {
      const op = this.propertyOperations[i];
      const row = propList.createEl('div', { cls: 'quartzo-prop-row' });
      
      const kindSelect = row.createEl('select');
      ['set', 'add', 'remove', 'clear'].forEach(k => {
        const opt = kindSelect.createEl('option', { value: k, text: k });
        if (k === op.kind) opt.selected = true;
      });
      kindSelect.addEventListener('change', async (e) => {
        op.kind = (e.target as HTMLSelectElement).value as any;
        await this.refreshPlan();
        this.render();
      });

      const keyInput = row.createEl('input', { type: 'text', value: op.key, placeholder: 'Property name' });
      keyInput.addEventListener('input', async (e) => {
        op.key = (e.target as HTMLInputElement).value;
        await this.refreshPlan();
        this.render();
      });

      if (op.kind !== 'clear') {
         const valInput = row.createEl('input', { type: 'text', value: Array.isArray(op.value) ? op.value.join(',') : (op.value || ''), placeholder: 'Value' });
         valInput.addEventListener('input', async (e) => {
           op.value = (e.target as HTMLInputElement).value;
           await this.refreshPlan();
           this.render();
         });
      }

      const removeBtn = row.createEl('button', { text: 'X' });
      removeBtn.addEventListener('click', async () => {
         this.propertyOperations.splice(i, 1);
         await this.refreshPlan();
         this.render();
      });
    }

    const addPropBtn = contentEl.createEl('button', { text: '+ Add Property Operation' });
    addPropBtn.addEventListener('click', async () => {
       this.propertyOperations.push({ kind: 'set', key: '' });
       await this.refreshPlan();
       this.render();
    });

    // 4. Preview / Preflight Warnings
    contentEl.createEl('h3', { text: 'Preview' });
    const previewBox = contentEl.createEl('div', { cls: 'quartzo-preview-box', attr: { style: 'max-height: 200px; overflow-y: auto; background: var(--background-secondary); padding: 10px;' } });
    
    if (this.currentPlan.blockers.length > 0) {
      previewBox.createEl('div', { text: `⚠️ ${this.currentPlan.blockers.length} Blockers prevent applying this plan:`, cls: 'has-error' });
      const ul = previewBox.createEl('ul');
      this.currentPlan.blockers.forEach(b => ul.createEl('li', { text: b.message }));
    } else {
      const effectCount = this.currentPlan.actions.length;
      previewBox.createEl('p', { text: `✅ Ready to apply. ${effectCount} items will be modified.` });
      // Brief sample
      if (effectCount > 0) {
        const sample = this.currentPlan.actions[0];
        previewBox.createEl('small', { text: `Sample: ${sample.sourcePath} -> ${sample.destinationPath}` });
      }
    }

    // 5. Actions
    const actionsEl = contentEl.createEl('div', { cls: 'modal-button-container' });
    const applyBtn = actionsEl.createEl('button', { text: 'Apply Organization', cls: 'mod-cta' });
    applyBtn.disabled = this.currentPlan.blockers.length > 0 || this.isApplying;
    
    applyBtn.addEventListener('click', async () => {
       if (!this.currentPlan) return;
       this.isApplying = true;
       applyBtn.textContent = 'Applying...';
       applyBtn.disabled = true;
       try {
         const result = await this.orgRepository.applyOrganize(this.currentPlan);
         if (result.error) {
            new Notice(`Organization partially failed: ${result.error.message}`);
         } else {
            new Notice(`Successfully organized ${result.migrated} items.`);
         }
         this.close();
       } catch (e) {
         new Notice(`Organization failed: ${e}`);
         this.isApplying = false;
         this.render();
       }
    });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
  }
}
