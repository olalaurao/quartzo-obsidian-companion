import { Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type { ViewContext } from '../types';
import { resolveOrganizationScope, describeScopeForDisplay } from '../../core/object-organization/scope-resolver';
import { planOrganize, type OrganizePlan, type PropertyOperation } from '../../core/object-organization/organize';
import { ObjectOrganizationRepository, type ObjectOrganizationResult } from '../../vault/object-organization';
import {
  SharedSettingsRepository,
  canonicalProductType,
  parseObjectWithSharedSettings,
  type QuartzoSharedSettings,
} from '../../vault/shared-settings';
import { createCanonicalObjectId } from '../../platform/object-id';
import { VaultIndexEngine } from '../../vault/index';
import type { IndexChange, IndexedObject } from '../../vault/index/types';

export interface ObjectOrganizationAppliedResult {
  migrated: number;
  remaining: number;
  unresolvedPaths: string[];
}

export interface ObjectOrganizationModalOptions {
  files?: string[];
  folders?: string[];
  onApplied?: (result: ObjectOrganizationAppliedResult) => void | Promise<void>;
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

  // Preview state. These IDs stay stable for the lifetime of this modal so an
  // unidentified Markdown file never receives a new identity on every rerender.
  private readonly generatedObjectIds = new Map<string, string>();
  private readonly sourceMarkdownByPath = new Map<string, string>();

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

    // Set targetType default if a single selected path is already an object.
    // VaultIndex.objects is keyed by object ID, not by path.
    if (this.options.files?.length === 1 && !this.options.folders?.length) {
      const selectedPath = normalizePath(this.options.files[0]);
      const index = this.context.vaultIndexEngine?.getIndex();
      const object = index
        ? Array.from(index.objects.values()).find(candidate => normalizePath(candidate.path) === selectedPath)
        : undefined;
      if (object) this.targetType = object.type;
    }

    await this.refreshPlan(true);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadExactMarkdown(paths: readonly string[], forceReload: boolean): Promise<void> {
    for (const rawPath of paths) {
      const path = normalizePath(rawPath);
      if (!forceReload && this.sourceMarkdownByPath.has(path)) continue;
      const file = this.context.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        this.sourceMarkdownByPath.delete(path);
        continue;
      }
      this.sourceMarkdownByPath.set(path, await this.context.app.vault.read(file));
    }
  }

  private async refreshPlan(forceReload = false): Promise<void> {
    if (!this.sharedSettings) return;

    const vaultFiles = this.context.app.vault.getFiles().map(file => normalizePath(file.path));
    const index = this.context.vaultIndexEngine?.getIndex();
    const indexedByPath = new Map<string, string>();
    if (index) {
      for (const object of index.objects.values()) {
        indexedByPath.set(normalizePath(object.path), object.id);
      }
    }

    const scope = resolveOrganizationScope({
      files: this.options.files,
      folders: this.options.folders,
      includeSubfolders: this.includeSubfolders,
      allVaultPaths: vaultFiles,
      indexedObjectsByPath: indexedByPath,
    });

    await this.loadExactMarkdown(scope.eligibleMarkdownPaths, forceReload);

    const objectIdsByPath = new Map<string, string>();
    for (const path of scope.eligibleMarkdownPaths) {
      const normalizedPath = normalizePath(path);
      const indexedId = indexedByPath.get(normalizedPath);
      if (indexedId) {
        objectIdsByPath.set(path, indexedId);
        continue;
      }
      let generated = this.generatedObjectIds.get(normalizedPath);
      if (!generated) {
        generated = createCanonicalObjectId();
        this.generatedObjectIds.set(normalizedPath, generated);
      }
      objectIdsByPath.set(path, generated);
    }

    this.currentPlan = planOrganize({
      scope,
      targetType: this.targetType || undefined,
      destinationFolder: this.destinationFolder || undefined,
      propertyOperations: this.propertyOperations,
      settingsRevision: Number(this.sharedSettings.objectIdentification.revision) || 0,
      settings: this.sharedSettings,
      objectIdsByPath,
      vaultState: {
        paths: new Set(vaultFiles),
        readMarkdown: path => this.sourceMarkdownByPath.get(normalizePath(path)),
      },
    });
  }

  private async updateCanonicalIndex(plan: OrganizePlan, appliedCount: number): Promise<void> {
    const engine = this.context.vaultIndexEngine ?? this.context.plugin.vaultIndexEngine;
    const currentIndex = engine?.getIndex();
    if (!engine || !currentIndex || !this.sharedSettings || appliedCount <= 0) return;

    const changes: IndexChange[] = [];
    for (const action of plan.actions.slice(0, appliedCount)) {
      const sourcePath = normalizePath(action.sourcePath);
      const destinationPath = normalizePath(action.destinationPath);
      if (action.moves) {
        changes.push({ type: 'deleted', path: sourcePath });
      }

      const persistedFile = this.context.app.vault.getAbstractFileByPath(destinationPath);
      if (!(persistedFile instanceof TFile)) {
        throw new Error(`Organization applied, but the resulting file is missing: ${destinationPath}`);
      }
      const persistedMarkdown = await this.context.app.vault.read(persistedFile);
      const parsed = parseObjectWithSharedSettings(
        persistedMarkdown,
        destinationPath,
        this.sharedSettings,
      );
      const object: IndexedObject = {
        id: parsed.object.id,
        type: parsed.object.type,
        path: destinationPath,
        frontmatter: parsed.object as Record<string, unknown>,
        body: parsed.object.body || '',
        identification: parsed.identification,
      };
      changes.push({ type: 'added', path: destinationPath, object });
    }

    engine.setIndex(VaultIndexEngine.updateIndex(currentIndex, changes));
  }

  private updateSelectedPaths(plan: OrganizePlan, appliedCount: number): void {
    if (!this.options.files || appliedCount <= 0) return;
    const moved = new Map(
      plan.actions
        .slice(0, appliedCount)
        .map(action => [normalizePath(action.sourcePath), normalizePath(action.destinationPath)] as const),
    );
    this.options.files = this.options.files.map(path => moved.get(normalizePath(path)) ?? normalizePath(path));
  }

  private verifyTargetPostcondition(plan: OrganizePlan, appliedCount: number): string[] {
    if (!plan.targetType || !this.sharedSettings || appliedCount <= 0) return [];
    const index = this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex();
    if (!index) return plan.actions.slice(0, appliedCount).map(action => action.destinationPath);

    const targetType = canonicalProductType(this.sharedSettings, plan.targetType);
    const unresolved: string[] = [];
    for (const action of plan.actions.slice(0, appliedCount)) {
      const path = normalizePath(action.destinationPath);
      const object = Array.from(index.objects.values()).find(candidate => normalizePath(candidate.path) === path);
      if (!object || object.type !== targetType) {
        unresolved.push(path);
        continue;
      }
      const matchedTypes = new Set(
        (object.identification?.matchedSignatures ?? []).map(match => match.objectType),
      );
      if (object.identification?.hasConflict || matchedTypes.size > 1) {
        unresolved.push(path);
      }
    }
    return unresolved;
  }

  private async notifyApplied(result: ObjectOrganizationResult, unresolvedPaths: string[]): Promise<void> {
    await this.options.onApplied?.({
      migrated: result.migrated,
      remaining: result.remaining,
      unresolvedPaths,
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
          .onChange(async val => {
            this.includeSubfolders = val;
            await this.refreshPlan();
            this.render();
          }));
    }

    // 2. Reclassify
    contentEl.createEl('h3', { text: 'Type & Location' });
    const types = Object.keys(this.sharedSettings?.typeSignatures || {});
    new Setting(contentEl)
      .setName('Set Object Type')
      .setDesc('Assign canonical identification rules to the selection. Leave blank to preserve existing.')
      .addDropdown(dd => {
        dd.addOption('', '(No change)');
        types.forEach(type => dd.addOption(type, type));
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
        }));

    // 3. Bulk Properties
    contentEl.createEl('h3', { text: 'Bulk Properties' });
    const propList = contentEl.createEl('div', { cls: 'quartzo-bulk-props' });
    for (let i = 0; i < this.propertyOperations.length; i++) {
      const op = this.propertyOperations[i];
      const row = propList.createEl('div', { cls: 'quartzo-prop-row' });

      const kindSelect = row.createEl('select');
      ['set', 'add', 'remove', 'clear'].forEach(kind => {
        const option = kindSelect.createEl('option', { value: kind, text: kind });
        if (kind === op.kind) option.selected = true;
      });
      kindSelect.addEventListener('change', async event => {
        op.kind = (event.target as HTMLSelectElement).value as 'set' | 'add' | 'remove' | 'clear';
        await this.refreshPlan();
        this.render();
      });

      const keyInput = row.createEl('input', { type: 'text', value: op.key, placeholder: 'Property name' });
      keyInput.addEventListener('change', async event => {
        op.key = (event.target as HTMLInputElement).value;
        await this.refreshPlan();
        this.render();
      });

      if (op.kind !== 'clear') {
        const valInput = row.createEl('input', {
          type: 'text',
          value: Array.isArray(op.value) ? op.value.join(',') : (op.value || ''),
          placeholder: 'Value',
        });
        valInput.addEventListener('change', async event => {
          op.value = (event.target as HTMLInputElement).value;
          await this.refreshPlan();
          this.render();
        });
      }

      const removeBtn = row.createEl('button', { text: 'X' });
      removeBtn.setAttribute('aria-label', `Remove property operation ${i + 1}`);
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
    const previewBox = contentEl.createEl('div', {
      cls: 'quartzo-preview-box',
    });

    if (this.currentPlan.blockers.length > 0) {
      previewBox.createEl('div', {
        text: `⚠️ ${this.currentPlan.blockers.length} blocker(s) prevent applying this plan:`,
        cls: 'has-error',
      });
      const list = previewBox.createEl('ul');
      this.currentPlan.blockers.forEach(blocker => list.createEl('li', { text: blocker.message }));
    } else {
      const effectCount = this.currentPlan.actions.length;
      previewBox.createEl('p', { text: `✅ Ready to apply. ${effectCount} item(s) will be modified.` });
      if (effectCount > 0) {
        const sample = this.currentPlan.actions[0];
        previewBox.createEl('small', { text: `Sample: ${sample.sourcePath} → ${sample.destinationPath}` });
      }
      if (effectCount === 0) {
        previewBox.createEl('small', { text: 'The selected files already satisfy the requested changes.' });
      }
    }

    if (this.currentPlan.warnings.length > 0) {
      const warningList = previewBox.createEl('ul');
      for (const warning of this.currentPlan.warnings) warningList.createEl('li', { text: warning });
    }

    // 5. Actions
    const actionsEl = contentEl.createEl('div', { cls: 'modal-button-container' });
    const applyBtn = actionsEl.createEl('button', { text: 'Apply Organization', cls: 'mod-cta' });
    applyBtn.disabled = this.currentPlan.blockers.length > 0 || this.currentPlan.actions.length === 0 || this.isApplying;

    applyBtn.addEventListener('click', async () => {
      if (!this.currentPlan || this.isApplying) return;
      this.isApplying = true;
      applyBtn.textContent = 'Checking current files…';
      applyBtn.disabled = true;

      try {
        // Re-read the exact current bytes immediately before Apply. The repository
        // still performs its own compare-before-write check; this simply makes the
        // visible preview correspond to the same snapshot whenever possible.
        await this.refreshPlan(true);
        const plan = this.currentPlan;
        if (!plan || plan.blockers.length > 0) {
          new Notice('Organization preview changed. Review the blockers before applying.');
          this.isApplying = false;
          this.render();
          return;
        }
        if (plan.actions.length === 0) {
          new Notice('Nothing needs to change for this selection.');
          this.isApplying = false;
          this.render();
          return;
        }

        applyBtn.textContent = `Applying 0/${plan.actions.length}…`;
        const result = await this.orgRepository.applyOrganize(plan);

        // Do not wait for asynchronous Obsidian watcher callbacks before rebuilding
        // Issues. Project the exact persisted post-state into the existing canonical
        // VaultIndex immediately, then let normal watchers remain idempotent.
        await this.updateCanonicalIndex(plan, result.migrated);
        this.updateSelectedPaths(plan, result.migrated);
        const unresolvedPaths = this.verifyTargetPostcondition(plan, result.migrated);
        await this.notifyApplied(result, unresolvedPaths);

        if (result.error) {
          new Notice(
            `Organization stopped after ${result.migrated}/${plan.actions.length}: ${result.error.message}`,
            10000,
          );
          this.sourceMarkdownByPath.clear();
          await this.refreshPlan(true);
          this.isApplying = false;
          this.render();
          return;
        }

        if (unresolvedPaths.length > 0) {
          new Notice(
            `Changes were written, but ${unresolvedPaths.length} file(s) still have an Object Identification conflict. Review the remaining marker or move before considering the Issue resolved.`,
            10000,
          );
          this.sourceMarkdownByPath.clear();
          await this.refreshPlan(true);
          this.isApplying = false;
          this.render();
          return;
        }

        new Notice(`Successfully organized ${result.migrated} item(s).`);
        this.close();
      } catch (error) {
        new Notice(`Organization failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
        this.isApplying = false;
        this.sourceMarkdownByPath.clear();
        await this.refreshPlan(true).catch(() => undefined);
        this.render();
      }
    });

    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
  }
}
