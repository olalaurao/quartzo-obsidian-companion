import { Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type { ViewContext } from '../types';
import {
  parseBatchCreateInput,
  planBatchCreate,
  type BatchCreateDraft,
  type BatchCreatePlan,
  type BatchOperationReport,
} from '../../core/object-organization/batch-workbench';
import { createCanonicalObjectId } from '../../platform/object-id';
import { ObjectOrganizationRepository } from '../../vault/object-organization';
import { SharedSettingsRepository, parseObjectWithSharedSettings } from '../../vault/shared-settings';
import { VaultIndexEngine } from '../../vault/index';
import type { IndexChange, IndexedObject } from '../../vault/index/types';

export interface ObjectBatchCreateModalOptions {
  onApplied?: (report: BatchOperationReport) => void | Promise<void>;
}

export class ObjectBatchCreateModal extends Modal {
  private readonly settingsRepository: SharedSettingsRepository;
  private readonly organizationRepository: ObjectOrganizationRepository;
  private rawInput = '';
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
    this.currentDrafts = parseBatchCreateInput(this.rawInput);
    this.currentPlan = planBatchCreate({
      settings,
      drafts: this.currentDrafts,
      existingPaths: new Set(this.context.app.vault.getFiles().map(file => normalizePath(file.path))),
      createId: (draft, index) => this.idForDraft(draft, index),
    });
  }

  private idForDraft(draft: BatchCreateDraft, index: number): string {
    const key = `${index}:${draft.type}:${draft.title}:${draft.folder ?? ''}`;
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
      text: 'Paste rows as type | title | folder | body | tags | links, or include a header row with those columns plus optional url, platform, and media_type.',
      cls: 'qz-text-muted',
    });

    const input = contentEl.createEl('textarea', {
      cls: 'quartzo-input quartzo-batch-create-input',
      attr: {
        rows: '8',
        placeholder: 'type | title | folder | body | tags | links\narea | Health | organizers/areas | Area body | life | [[pillars/health]]\nproject | Companion | organizers/projects | Project body | work |',
      },
    });
    input.value = this.rawInput;
    input.addEventListener('input', () => {
      this.rawInput = input.value;
      this.currentPlan = null;
      this.report = null;
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
        new Notice(`Batch create preview failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
      } finally {
        this.render();
      }
    });

    const plan = this.currentPlan;
    if (plan) this.renderPlan(contentEl, plan);
    if (this.report) this.renderReport(contentEl, this.report);

    const footer = contentEl.createEl('div', { cls: 'modal-button-container quartzo-modal-actions-row' });
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const create = footer.createEl('button', {
      text: this.isApplying ? 'Creating…' : `Create ${plan?.actions.length ?? 0} object(s)`,
      cls: 'mod-cta',
    });
    create.disabled = this.isApplying || !plan || plan.actions.length === 0 || plan.blockers.length > 0;
    create.addEventListener('click', () => { void this.apply(); });
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
    const box = container.createEl('div', { cls: 'quartzo-preview-box' });
    box.createEl('strong', {
      text: `Batch create report: ${report.applied}/${report.attempted} applied, ${report.failed} failed, ${report.skipped} skipped`,
    });
    if (report.messages.length > 0) {
      const list = box.createEl('ul');
      for (const message of report.messages) list.createEl('li', { text: message });
    }
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
      await this.updateCanonicalIndex(plan, report.applied);
      await this.options.onApplied?.(report);
      if (report.failed > 0) {
        new Notice(`Created ${report.applied}/${report.attempted}; stopped at ${report.failedPath}.`, 10000);
        this.isApplying = false;
        this.render();
        return;
      }
      new Notice(`Created ${report.applied} object(s).`);
      this.close();
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
      engine.setIndex(VaultIndexEngine.updateIndex(currentIndex, changes));
    }
  }
}
