import { Modal, Notice, TFile, normalizePath } from 'obsidian';
import type { ViewContext } from '../types';
import {
  planMerge,
  type MergePlan,
  type PropertyResolution,
} from '../../core/object-organization/merge';
import {
  type BatchOperationReport,
  type BatchProgress,
} from '../../core/object-organization/batch-workbench';
import { ObjectParser } from '../../core/objects';
import { ObjectOrganizationRepository } from '../../vault/object-organization';
import { SharedSettingsRepository, parseObjectWithSharedSettings } from '../../vault/shared-settings';
import { VaultIndexEngine } from '../../vault/index';
import type { IndexChange, IndexedObject } from '../../vault/index/types';
import { isOrganizationIssuePathExcluded } from '../../core/object-organization/issues-projection';

export interface ObjectBatchMergeModalOptions {
  selectedPaths?: string[];
  ignoredFolderPaths?: string[];
  onApplied?: (report: BatchOperationReport) => void | Promise<void>;
}

interface BatchMergeGroupPlan {
  objectId: string;
  paths: string[];
  survivorPath: string;
  plan: MergePlan | null;
  blockers: string[];
}

export class ObjectBatchMergeModal extends Modal {
  private readonly settingsRepository: SharedSettingsRepository;
  private readonly organizationRepository: ObjectOrganizationRepository;
  private groupPlans: BatchMergeGroupPlan[] = [];
  private progress: BatchProgress | null = null;
  private report: BatchOperationReport | null = null;
  private isApplying = false;

  constructor(
    private readonly context: ViewContext,
    private readonly options: ObjectBatchMergeModalOptions = {},
  ) {
    super(context.app);
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
    this.organizationRepository = new ObjectOrganizationRepository(context.app.vault, this.settingsRepository);
  }

  async onOpen(): Promise<void> {
    this.render();
    await this.refreshPlans();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async refreshPlans(): Promise<void> {
    const settings = await this.settingsRepository.load();
    if (!settings) {
      this.groupPlans = [{
        objectId: 'settings',
        paths: [],
        survivorPath: '',
        plan: null,
        blockers: ['Shared settings not found.'],
      }];
      return;
    }

    const groups = this.duplicateGroups();
    this.groupPlans = [];
    this.progress = { phase: 'checking_files', completed: 0, total: groups.length };
    this.render();

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index]!;
      const loaded = [];
      const blockers: string[] = [];
      for (const path of group.paths) {
        const file = this.context.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          blockers.push(`${path}: file no longer exists.`);
          continue;
        }
        const markdown = await this.context.app.vault.read(file);
        const parsed = ObjectParser.parseMarkdown(markdown);
        loaded.push({
          id: String(parsed.frontmatter.id || group.objectId),
          path,
          markdown,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
      }

      const survivorPath = group.survivorPath;
      const survivor = loaded.find(item => item.path === survivorPath) ?? loaded[0];
      if (!survivor || loaded.length < 2) {
        blockers.push(`${group.objectId}: fewer than two readable objects remain.`);
        this.groupPlans.push({ ...group, plan: null, blockers });
      } else {
        const losers = loaded.filter(item => item.path !== survivor.path);
        const plan = planMerge({
          survivorId: survivor.id,
          survivorMarkdown: survivor.markdown,
          survivorPath: survivor.path,
          targetType: String(survivor.frontmatter.type || ''),
          losers,
          propertyResolutions: defaultPropertyResolutions(loaded),
          bodyResolution: 'combine',
          settingsRevision: Number(settings.objectIdentification.revision) || 0,
          settings,
        });
        this.groupPlans.push({
          ...group,
          survivorPath: survivor.path,
          plan,
          blockers: [...blockers, ...plan.blockers.map(blocker => blocker.message)],
        });
      }

      const completed = index + 1;
      if (completed === groups.length || completed % 10 === 0) {
        this.progress = { phase: 'checking_files', completed, total: groups.length };
        this.render();
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
    }
    this.progress = null;
  }

  private duplicateGroups(): Array<{ objectId: string; paths: string[]; survivorPath: string }> {
    const index = this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex();
    if (!index) return [];
    const selected = new Set((this.options.selectedPaths ?? []).map(normalizePath));
    const ignored = this.options.ignoredFolderPaths ?? [];
    const byId = new Map<string, string[]>();
    for (const object of index.objects.values()) {
      const path = normalizePath(object.path);
      if (isOrganizationIssuePathExcluded(path, ignored)) continue;
      const paths = byId.get(object.id) ?? [];
      paths.push(path);
      byId.set(object.id, paths);
    }
    return Array.from(byId.entries())
      .filter(([, paths]) => paths.length > 1)
      .filter(([, paths]) => selected.size === 0 || paths.some(path => selected.has(path)))
      .map(([objectId, paths]) => {
        const sorted = paths.slice().sort(compareSurvivorPath);
        return { objectId, paths: sorted, survivorPath: sorted[0]! };
      })
      .sort((left, right) => left.objectId.localeCompare(right.objectId));
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Merge Duplicate Groups' });

    if (this.progress) {
      const status = contentEl.createEl('div', { cls: 'qz-empty-state' });
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.createEl('p', {
        text: `Checking duplicate groups ${this.progress.completed}/${this.progress.total}…`,
      });
      const progressBar = status.createEl('progress');
      progressBar.max = Math.max(1, this.progress.total);
      progressBar.value = this.progress.completed;
      return;
    }

    const safeGroups = this.groupPlans.filter(group => group.plan && group.blockers.length === 0);
    const blockedGroups = this.groupPlans.filter(group => group.blockers.length > 0);
    contentEl.createEl('p', {
      text: `${safeGroups.length} duplicate group(s) ready to merge. ${blockedGroups.length} group(s) blocked or pending review.`,
    });

    const list = contentEl.createEl('div', { cls: 'quartzo-preview-box' });
    if (this.groupPlans.length === 0) {
      list.createEl('p', { text: 'No duplicate object IDs found for the current scope.' });
    }
    for (const group of this.groupPlans.slice(0, 30)) {
      const row = list.createEl('section', { cls: 'quartzo-review-section' });
      row.createEl('strong', { text: group.objectId });
      row.createEl('p', {
        text: `Survivor: ${group.survivorPath || 'n/a'} · ${group.paths.length} files`,
        cls: 'qz-text-muted',
      });
      if (group.blockers.length > 0) {
        const blockers = row.createEl('ul');
        for (const blocker of group.blockers) blockers.createEl('li', { text: blocker });
      }
    }
    if (this.groupPlans.length > 30) {
      list.createEl('small', { text: `…and ${this.groupPlans.length - 30} more duplicate groups.`, cls: 'qz-text-muted' });
    }

    if (this.report) this.renderReport(contentEl, this.report);

    const actions = contentEl.createEl('div', { cls: 'modal-button-container quartzo-modal-actions-row' });
    const refresh = actions.createEl('button', { text: 'Refresh preview', cls: 'qz-btn qz-btn-secondary' });
    refresh.disabled = this.isApplying;
    refresh.addEventListener('click', async () => {
      await this.refreshPlans();
      this.render();
    });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const apply = actions.createEl('button', {
      text: this.isApplying ? 'Merging…' : `Merge ${safeGroups.length} group(s)`,
      cls: 'mod-cta mod-warning',
    });
    apply.disabled = this.isApplying || safeGroups.length === 0;
    apply.addEventListener('click', () => { void this.apply(); });
  }

  private renderReport(container: HTMLElement, report: BatchOperationReport): void {
    const box = container.createEl('div', { cls: 'quartzo-preview-box' });
    box.createEl('strong', {
      text: `Merge report: ${report.applied}/${report.attempted} applied, ${report.failed} failed, ${report.skipped} skipped`,
    });
    if (report.messages.length > 0) {
      const list = box.createEl('ul');
      for (const message of report.messages) list.createEl('li', { text: message });
    }
  }

  private async apply(): Promise<void> {
    if (this.isApplying) return;
    this.isApplying = true;
    this.progress = { phase: 'checking_files', completed: 0, total: this.groupPlans.length };
    this.render();

    await this.refreshPlans();
    const safeGroups = this.groupPlans.filter((group): group is BatchMergeGroupPlan & { plan: MergePlan } =>
      group.plan !== null && group.blockers.length === 0,
    );

    let applied = 0;
    const messages: string[] = [];
    this.progress = { phase: 'applying', completed: 0, total: safeGroups.length };
    this.render();

    for (let index = 0; index < safeGroups.length; index += 1) {
      const group = safeGroups[index]!;
      try {
        await this.organizationRepository.applyMerge(group.plan);
        await this.updateCanonicalIndex(group.plan);
        applied++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push(`${group.objectId}: ${message}`);
        this.report = {
          attempted: safeGroups.length,
          applied,
          skipped: safeGroups.length - applied - 1,
          failed: 1,
          failedPath: group.survivorPath,
          messages,
        };
        this.progress = null;
        this.isApplying = false;
        await this.options.onApplied?.(this.report);
        this.render();
        return;
      }

      const completed = index + 1;
      if (completed === safeGroups.length || completed % 5 === 0) {
        this.progress = { phase: 'applying', completed, total: safeGroups.length };
        this.render();
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
    }

    this.report = {
      attempted: safeGroups.length,
      applied,
      skipped: this.groupPlans.length - safeGroups.length,
      failed: 0,
      messages: this.groupPlans
        .filter(group => group.blockers.length > 0)
        .map(group => `${group.objectId}: ${group.blockers.join('; ')}`),
    };
    this.progress = null;
    this.isApplying = false;
    await this.options.onApplied?.(this.report);
    new Notice(`Merged ${applied} duplicate group(s).`);
    this.close();
  }

  private async updateCanonicalIndex(plan: MergePlan): Promise<void> {
    const engine = this.context.vaultIndexEngine ?? this.context.plugin.vaultIndexEngine;
    const currentIndex = engine?.getIndex();
    const settings = await this.settingsRepository.load();
    if (!engine || !currentIndex) return;

    const changes: IndexChange[] = plan.action.losersToRetire.map(loser => ({
      type: 'deleted' as const,
      path: loser.path,
    }));
    const survivorFile = this.context.app.vault.getAbstractFileByPath(plan.action.survivorPath);
    if (survivorFile instanceof TFile) {
      const markdown = await this.context.app.vault.read(survivorFile);
      const parsed = parseObjectWithSharedSettings(markdown, plan.action.survivorPath, settings);
      const object: IndexedObject = {
        id: parsed.object.id,
        type: parsed.object.type,
        path: plan.action.survivorPath,
        frontmatter: parsed.object as Record<string, unknown>,
        body: parsed.object.body || '',
        identification: parsed.identification,
      };
      changes.push({ type: 'added', path: plan.action.survivorPath, object });
    }
    engine.setIndex(VaultIndexEngine.updateIndex(currentIndex, changes));
  }
}

function defaultPropertyResolutions(objects: Array<{ frontmatter: Record<string, unknown> }>): PropertyResolution[] {
  const keys = new Set<string>();
  for (const object of objects) {
    for (const key of Object.keys(object.frontmatter)) {
      if (!['id', 'type'].includes(key)) keys.add(key);
    }
  }
  return Array.from(keys).map(field => ({
    field,
    strategy: objects.some(object => Array.isArray(object.frontmatter[field]))
      ? 'union_dedupe'
      : 'use_survivor',
  }));
}

function compareSurvivorPath(left: string, right: string): number {
  const leftDeleted = left === '_deleted' || left.startsWith('_deleted/');
  const rightDeleted = right === '_deleted' || right.startsWith('_deleted/');
  if (leftDeleted !== rightDeleted) return leftDeleted ? 1 : -1;
  return left.length - right.length || left.localeCompare(right);
}
