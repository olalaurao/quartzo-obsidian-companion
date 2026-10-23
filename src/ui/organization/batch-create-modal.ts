import { Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type { ViewContext } from '../types';
import {
  parseBatchCreateInput,
  batchDraftsFromNames,
  BATCH_CREATE_TYPES,
  type BatchCreatableType,
  planBatchCreate,
  type BatchCreateDraft,
  type BatchCreatePlan,
  type BatchOperationReport,
} from '../../core/object-organization/batch-workbench';
import { createCanonicalObjectId } from '../../platform/object-id';
import { ObjectOrganizationRepository } from '../../vault/object-organization';
import { SharedSettingsRepository, parseObjectWithSharedSettings } from '../../vault/shared-settings';
import type { IndexChange, IndexedObject } from '../../vault/index/types';
import { resourceMediaTypeSuggestions, resourceStatusLabel, type ResourceStatus } from '../../core/resource-capture/policy';
import { renderActionReport } from '../action-report';
import { queryVaultObjects } from '../../core/object-query';

export interface ObjectBatchCreateModalOptions {
  onApplied?: (report: BatchOperationReport) => void | Promise<void>;
}

export class ObjectBatchCreateModal extends Modal {
  private readonly settingsRepository: SharedSettingsRepository;
  private readonly organizationRepository: ObjectOrganizationRepository;
  private rawInput = '';
  private tableMode = false;
  private shared: Omit<BatchCreateDraft, 'title'> = { type: 'resource', mediaType: 'Movie' };
  private retryDrafts: BatchCreateDraft[] | null = null;
  private previewError: string | null = null;
  private currentPlan: BatchCreatePlan | null = null;
  private currentDrafts: BatchCreateDraft[] = [];
  private report: BatchOperationReport | null = null;
  private isApplying = false;
  private readonly generatedIds = new Map<string, string>();

  constructor(
    private readonly context: ViewContext,
    private readonly options: ObjectBatchCreateModalOptions = {},
  ) {
    super(context.app);
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
    this.organizationRepository = new ObjectOrganizationRepository(context.app.vault, this.settingsRepository);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async refreshPlan(): Promise<void> {
    const settings = await this.settingsRepository.load();
    this.currentDrafts = this.retryDrafts ?? (this.tableMode ? parseBatchCreateInput(this.rawInput) : batchDraftsFromNames(this.rawInput, this.shared));
    this.currentPlan = planBatchCreate({
      settings,
      drafts: this.currentDrafts,
      existingPaths: new Set(this.context.app.vault.getFiles().map(file => normalizePath(file.path))),
      createId: (draft, index) => this.idForDraft(draft, index),
    });
  }

  private idForDraft(draft: BatchCreateDraft, _index: number): string {
    const key = `${draft.type}:${draft.title}:${draft.folder ?? ''}`;
    let id = this.generatedIds.get(key);
    if (!id) {
      id = createCanonicalObjectId();
      this.generatedIds.set(key, id);
    }
    return id;
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Batch Create Objects' });
    contentEl.createEl('p', {
      text: 'Choose shared properties once, then enter one name per line. Preview before creating. You can keep adding more names with the same properties.',
      cls: 'qz-text-muted',
    });

    new Setting(contentEl).setName('Advanced table import').addToggle(toggle => toggle.setValue(this.tableMode).setDisabled(this.isApplying || this.retryDrafts !== null).onChange(value => {
      this.tableMode = value; this.rawInput = ''; this.invalidatePlan(); this.render();
    }));
    if (!this.tableMode) this.renderSharedProperties(contentEl);

    const input = contentEl.createEl('textarea', {
      cls: 'quartzo-input quartzo-batch-create-input',
      attr: {
        rows: '8',
        placeholder: 'type | title | folder | body | tags | links\narea | Health | organizers/areas | Area body | life | [[pillars/health]]\nproject | Companion | organizers/projects | Project body | work |',
      },
    });
    input.value = this.rawInput;
    input.disabled = this.isApplying || this.retryDrafts !== null;
    input.placeholder = this.tableMode ? 'type | title | folder | body | tags | links' : 'Arrival\nInterstellar\nThe Matrix';
    input.addEventListener('input', () => {
      this.rawInput = input.value;
      this.invalidatePlan();
    });

    const actions = contentEl.createEl('div', { cls: 'modal-button-container quartzo-modal-actions-row' });
    const preview = actions.createEl('button', { text: 'Preview batch', cls: 'qz-btn qz-btn-secondary' });
    preview.disabled = this.isApplying;
    preview.addEventListener('click', async () => {
      preview.disabled = true;
      preview.textContent = 'Checking…';
      try {
        await this.refreshPlan();
      } catch (error) {
        this.previewError = `Batch create preview failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        this.render();
      }
    });

    if (this.retryDrafts) {
      const discard = actions.createEl('button', { text: 'Discard remaining names' });
      discard.disabled = this.isApplying;
      discard.addEventListener('click', () => { this.retryDrafts = null; this.rawInput = ''; this.invalidatePlan(); this.render(); });
    }
    const plan = this.currentPlan;
    if (plan) this.renderPlan(contentEl, plan);
    if (this.report) this.renderReport(contentEl, this.report);
    if (this.previewError) contentEl.createEl('p', { text: this.previewError, cls: 'quartzo-warning-state' });

    const footer = contentEl.createEl('div', { cls: 'modal-button-container quartzo-modal-actions-row' });
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    cancel.disabled = this.isApplying;
    const create = footer.createEl('button', {
      text: this.isApplying ? 'Creating…' : `Create ${plan?.actions.length ?? 0} object(s)`,
      cls: 'mod-cta',
    });
    create.disabled = this.isApplying || !plan || plan.actions.length === 0 || plan.blockers.length > 0;
    create.addEventListener('click', () => { void this.apply(); });
  }

  private invalidatePlan(): void {
    this.currentPlan = null; this.report = null; this.previewError = null;
  }

  private renderSharedProperties(container: HTMLElement): void {
    new Setting(container).setName('Object type').addDropdown(dropdown => {
      for (const type of BATCH_CREATE_TYPES) dropdown.addOption(type, type.replace(/_/g, ' '));
      dropdown.setValue(this.shared.type).setDisabled(this.isApplying || this.retryDrafts !== null).onChange(value => {
        this.shared = { type: value as BatchCreatableType }; this.invalidatePlan(); this.render();
      });
    });
    const text = (label: string, value: string, change: (value: string) => void): void => {
      new Setting(container).setName(label).addText(field => field.setValue(value).setDisabled(this.isApplying || this.retryDrafts !== null).onChange(value => { change(value); this.invalidatePlan(); }));
    };
    const list = (key: 'tags' | 'categories' | 'links', label: string): void => text(label, this.shared[key]?.join('; ') ?? '', value => { this.shared[key] = value.split(';').map(item => item.trim()).filter(Boolean); });
    if (this.shared.type === 'resource') {
      new Setting(container).setName('Media type (custom values allowed)').addText(field => {
        field.setValue(this.shared.mediaType ?? 'General').setDisabled(this.isApplying || this.retryDrafts !== null).onChange(value => { this.shared.mediaType = value; this.invalidatePlan(); });
        field.inputEl.addEventListener('change', () => this.render());
      });
      const index = this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex();
      const resources = index ? queryVaultObjects(index, { types: ['resource'] }).map(object => object.frontmatter.media_type).filter((value): value is string => typeof value === 'string') : [];
      container.createEl('small', { text: resourceMediaTypeSuggestions({ existing: resources }).join(', '), cls: 'qz-text-muted' });
      new Setting(container).setName('Consumption status').addDropdown(dropdown => {
        for (const status of ['toConsume', 'inProgress', 'completed', 'dropped'] as ResourceStatus[]) dropdown.addOption(status, resourceStatusLabel(status, this.shared.mediaType ?? 'General'));
        dropdown.setValue(this.shared.resource?.status ?? 'toConsume').setDisabled(this.isApplying || this.retryDrafts !== null).onChange(value => { this.shared.resource = { ...this.shared.resource, status: value as ResourceStatus }; this.invalidatePlan(); });
      });
      new Setting(container).setName('Priority').addDropdown(dropdown => {
        for (const priority of ['none', 'low', 'medium', 'high'] as const) dropdown.addOption(priority, priority);
        dropdown.setValue(this.shared.resource?.priority ?? 'none').setDisabled(this.isApplying || this.retryDrafts !== null).onChange(value => { this.shared.resource = { ...this.shared.resource, priority: value as 'none' | 'low' | 'medium' | 'high' }; this.invalidatePlan(); });
      });
      text('Author / creator (optional)', this.shared.resource?.author ?? '', value => { this.shared.resource = { ...this.shared.resource, author: value }; });
    }
    list('tags', 'Tags (separated by ;)'); list('categories', 'Categories (separated by ;)'); list('links', 'Links (separated by ;)');
    text('Shared body (optional)', this.shared.body ?? '', value => { this.shared.body = value; });
    if (['resource', 'recipe', 'social_post'].includes(this.shared.type)) text('Source URL (optional; required for Social Post)', this.shared.sourceUrl ?? '', value => { this.shared.sourceUrl = value; });
  }

  private renderPlan(container: HTMLElement, plan: BatchCreatePlan): void {
    const previewBox = container.createEl('div', { cls: 'quartzo-preview-box' });
    previewBox.createEl('strong', { text: `Preview: ${plan.actions.length} object(s) ready` });
    if (plan.actions.length > 0) {
      const list = previewBox.createEl('ul', { cls: 'quartzo-scroll-list' });
      for (const action of plan.actions.slice(0, 20)) {
        list.createEl('li', { text: `${action.type}: ${action.title} → ${action.path}` });
      }
      if (plan.actions.length > 20) {
        previewBox.createEl('small', { text: `…and ${plan.actions.length - 20} more.`, cls: 'qz-text-muted' });
      }
    }
    if (plan.blockers.length > 0) {
      const blockers = previewBox.createEl('div', { cls: 'quartzo-warning-state' });
      blockers.createEl('strong', { text: 'Blocked rows' });
      const list = blockers.createEl('ul');
      for (const blocker of plan.blockers) list.createEl('li', { text: blocker });
    }
    if (plan.warnings.length > 0) {
      const warnings = previewBox.createEl('ul');
      for (const warning of plan.warnings) warnings.createEl('li', { text: warning });
    }
  }

  private renderReport(container: HTMLElement, report: BatchOperationReport): void {
    renderActionReport(container, {
      kind: 'organization.batch_create', title: 'Batch create result',
      summary: `${report.applied}/${report.attempted} created. ${report.failed > 0 ? 'Preview and retry the remaining names, or discard them.' : 'Enter more names to continue with the same properties.'}`,
      status: report.failed > 0 ? 'error' : report.messages.length > 0 ? 'warning' : 'success',
      ...report,
      copyText: JSON.stringify(report, null, 2),
    });
  }

  private async apply(): Promise<void> {
    if (this.isApplying) return;
    this.isApplying = true;
    this.render();

    try {
      await this.refreshPlan();
      const plan = this.currentPlan;
      if (!plan || plan.actions.length === 0 || plan.blockers.length > 0) {
        this.isApplying = false;
        this.render();
        return;
      }

      const report = await this.organizationRepository.applyBatchCreate(plan);
      this.report = report;
      this.retryDrafts = report.failed > 0 ? this.currentDrafts.slice(report.applied) : null;
      const rows = this.rawInput.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
      if (!this.tableMode) this.rawInput = rows.slice(report.applied).join('\n');
      else if (report.failed === 0) this.rawInput = '';
      this.currentPlan = null;
      try {
        await this.updateCanonicalIndex(plan, report.applied);
        await this.options.onApplied?.(report);
      } catch (error) {
        report.messages.push(`Objects committed; view refresh failed: ${String(error)}. Reopen the view to reload.`);
      }
      if (report.failed > 0) {
        new Notice(`Created ${report.applied}/${report.attempted}; stopped at ${report.failedPath}.`, 10000);
        this.isApplying = false;
        this.render();
        return;
      }
      new Notice(`Created ${report.applied} object(s).`);
      this.isApplying = false;
      this.render();
    } catch (error) {
      this.report = {
        attempted: this.currentPlan?.actions.length ?? 0,
        applied: 0,
        skipped: 0,
        failed: 1,
        messages: [error instanceof Error ? error.message : String(error)],
      };
      this.isApplying = false;
      this.render();
    }
  }

  private async updateCanonicalIndex(plan: BatchCreatePlan, appliedCount: number): Promise<void> {
    const engine = this.context.vaultIndexEngine ?? this.context.plugin.vaultIndexEngine;
    const currentIndex = engine?.getIndex();
    const settings = await this.settingsRepository.load();
    if (!engine || !currentIndex || appliedCount <= 0) return;

    const changes: IndexChange[] = [];
    for (const action of plan.actions.slice(0, appliedCount)) {
      const file = this.context.app.vault.getAbstractFileByPath(action.path);
      if (!(file instanceof TFile)) continue;
      const markdown = await this.context.app.vault.read(file);
      const parsed = parseObjectWithSharedSettings(markdown, action.path, settings);
      const object: IndexedObject = {
        id: parsed.object.id,
        type: parsed.object.type,
        path: action.path,
        frontmatter: parsed.object as Record<string, unknown>,
        body: parsed.object.body || '',
        identification: parsed.identification,
      };
      changes.push({ type: 'added', path: action.path, object });
    }
    if (changes.length > 0) {
      engine.applyChanges(changes);
    }
  }
}
