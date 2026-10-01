import { Modal, Notice, Setting, TFile } from 'obsidian';
import type { ViewContext } from '../types';
import { planMerge, type MergePlan, type PropertyResolution, type PropertyResolutionStrategy } from '../../core/object-organization/merge';
import { ObjectOrganizationRepository } from '../../vault/object-organization';
import { SharedSettingsRepository, type QuartzoSharedSettings } from '../../vault/shared-settings';
import { ObjectParser } from '../../core/objects';

export interface ObjectMergeModalOptions {
  files: string[];
}

interface LoadedObject {
  id: string;
  path: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export class ObjectMergeModal extends Modal {
  private settingsRepository: SharedSettingsRepository;
  private orgRepository: ObjectOrganizationRepository;
  private sharedSettings: QuartzoSharedSettings | null = null;
  
  // Loaded Data
  private loadedObjects: LoadedObject[] = [];
  
  // UI State
  private targetType: string = '';
  private survivorId: string = '';
  private propertyResolutions: PropertyResolution[] = [];
  private bodyResolution: 'keep_survivor' | 'combine' = 'combine';
  private currentPlan: MergePlan | null = null;
  private isApplying = false;

  constructor(
    private readonly context: ViewContext,
    private readonly options: ObjectMergeModalOptions,
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

    if (this.options.files.length < 2) {
      new Notice('Merge requires at least two objects.');
      this.close();
      return;
    }

    // Load actual markdown for the selected files
    for (const path of this.options.files) {
      const file = this.context.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const markdown = await this.context.app.vault.read(file);
        const parsed = ObjectParser.parseMarkdown(markdown);
        this.loadedObjects.push({
          id: String(parsed.frontmatter.id || path),
          path,
          markdown,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
      }
    }

    if (this.loadedObjects.length < 2) {
       new Notice('Failed to load objects for merge.');
       this.close();
       return;
    }

    // Default heuristics
    this.survivorId = this.loadedObjects[0].id;
    this.targetType = String(this.loadedObjects[0].frontmatter.type || '');
    this.buildDefaultPropertyResolutions();

    await this.refreshPlan();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private buildDefaultPropertyResolutions(): void {
    const allKeys = new Set<string>();
    this.loadedObjects.forEach(obj => {
      Object.keys(obj.frontmatter).forEach(k => {
        if (!['id', 'type'].includes(k)) allKeys.add(k);
      });
    });

    this.propertyResolutions = Array.from(allKeys).map(field => {
       // Check if field is an array to default to union_dedupe
       let isArray = false;
       for (const obj of this.loadedObjects) {
          if (Array.isArray(obj.frontmatter[field])) isArray = true;
       }
       return {
         field,
         strategy: isArray ? 'union_dedupe' : 'use_survivor'
       };
    });
  }

  private async refreshPlan(): Promise<void> {
    if (!this.sharedSettings) return;

    const survivor = this.loadedObjects.find(o => o.id === this.survivorId);
    if (!survivor) return;
    const losers = this.loadedObjects.filter(o => o.id !== this.survivorId);

    this.currentPlan = planMerge({
      survivorId: this.survivorId,
      survivorMarkdown: survivor.markdown,
      survivorPath: survivor.path,
      targetType: this.targetType,
      losers,
      propertyResolutions: this.propertyResolutions,
      bodyResolution: this.bodyResolution,
      settingsRevision: Number(this.sharedSettings.objectIdentification.revision) || 0,
      settings: this.sharedSettings,
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    
    if (!this.currentPlan) {
      contentEl.createEl('p', { text: 'Loading merge plan...' });
      return;
    }

    contentEl.createEl('h2', { text: `Merge ${this.loadedObjects.length} Objects` });

    // 1. Core Config
    contentEl.createEl('h3', { text: '1. Survivor & Target Type' });
    
    new Setting(contentEl)
      .setName('Survivor Object')
      .setDesc('Which object preserves its path and primary identity?')
      .addDropdown(dd => {
        this.loadedObjects.forEach(obj => {
          dd.addOption(obj.id, `${obj.frontmatter.title || obj.id} (${obj.path})`);
        });
        dd.setValue(this.survivorId);
        dd.onChange(async val => {
          this.survivorId = val;
          await this.refreshPlan();
          this.render();
        });
      });

    const types = Object.keys(this.sharedSettings?.typeSignatures || {});
    new Setting(contentEl)
      .setName('Target Final Type')
      .setDesc('What will be the type of the merged object?')
      .addDropdown(dd => {
        types.forEach(t => dd.addOption(t, t));
        dd.setValue(this.targetType);
        dd.onChange(async val => {
          this.targetType = val;
          await this.refreshPlan();
          this.render();
        });
      });

    // 2. Property Reconciliation
    contentEl.createEl('h3', { text: '2. Field Reconciliation' });
    const propsEl = contentEl.createEl('div', { cls: 'quartzo-merge-props', attr: { style: 'max-height: 250px; overflow-y: auto;' } });
    
    for (const res of this.propertyResolutions) {
       const row = propsEl.createEl('div', { attr: { style: 'display: flex; justify-content: space-between; margin-bottom: 8px;' } });
       row.createEl('strong', { text: res.field, attr: { style: 'flex: 1' } });
       
       const stratSelect = row.createEl('select', { attr: { style: 'flex: 1' } });
       stratSelect.createEl('option', { value: 'use_survivor', text: 'Use Survivor' });
       stratSelect.createEl('option', { value: 'union_dedupe', text: 'Union / Combine' });
       stratSelect.createEl('option', { value: 'explicit_choice', text: 'Explicit Value' });
       stratSelect.value = res.strategy;

       const explicitInput = row.createEl('input', { type: 'text', placeholder: 'Value', attr: { style: 'flex: 1; display: none;' } });
       if (res.strategy === 'explicit_choice') {
         explicitInput.style.display = 'block';
         explicitInput.value = String(res.chosenValue || '');
       }

       stratSelect.addEventListener('change', async (e) => {
          const val = (e.target as HTMLSelectElement).value as PropertyResolutionStrategy;
          res.strategy = val;
          await this.refreshPlan();
          this.render();
       });

       explicitInput.addEventListener('input', async (e) => {
          res.chosenValue = (e.target as HTMLInputElement).value;
          await this.refreshPlan();
          this.render();
       });
    }

    // 3. Body Reconciliation
    contentEl.createEl('h3', { text: '3. Body Content' });
    new Setting(contentEl)
      .setName('Body merge strategy')
      .addDropdown(dd => {
         dd.addOption('combine', 'Append loser content');
         dd.addOption('keep_survivor', 'Discard loser content');
         dd.setValue(this.bodyResolution);
         dd.onChange(async val => {
            this.bodyResolution = val as 'combine' | 'keep_survivor';
            await this.refreshPlan();
            this.render();
         });
      });

    // 4. Preview / Apply
    contentEl.createEl('h3', { text: 'Preview' });
    const previewBox = contentEl.createEl('div', { cls: 'quartzo-preview-box', attr: { style: 'background: var(--background-secondary); padding: 10px;' } });
    
    if (this.currentPlan.blockers.length > 0) {
      previewBox.createEl('div', { text: `⚠️ Blockers:`, cls: 'has-error' });
      const ul = previewBox.createEl('ul');
      this.currentPlan.blockers.forEach(b => ul.createEl('li', { text: b.message }));
    } else {
      previewBox.createEl('p', { text: `✅ Ready to merge.` });
      previewBox.createEl('small', { text: `${this.currentPlan.action.losersToRetire.length} objects will be safely retired.` });
    }

    const actionsEl = contentEl.createEl('div', { cls: 'modal-button-container', attr: { style: 'margin-top: 15px;' } });
    const applyBtn = actionsEl.createEl('button', { text: 'Merge Objects', cls: 'mod-cta mod-warning' });
    applyBtn.disabled = this.currentPlan.blockers.length > 0 || this.isApplying;
    
    applyBtn.addEventListener('click', async () => {
       if (!this.currentPlan) return;
       this.isApplying = true;
       applyBtn.textContent = 'Merging...';
       applyBtn.disabled = true;
       try {
         await this.orgRepository.applyMerge(this.currentPlan);
         new Notice('Merge successful.');
         this.close();
       } catch (e) {
         new Notice(`Merge failed: ${e}`);
         this.isApplying = false;
         this.render();
       }
    });
  }
}
