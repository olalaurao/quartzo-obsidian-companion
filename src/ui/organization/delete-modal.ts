import { Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type { ViewContext } from '../types';
import { ObjectParser } from '../../core/objects';
import { createCanonicalObjectId } from '../../platform/object-id';
import { canonicalRetirementPath } from '../../core/object-organization/retire';
import {
  ObjectOrganizationRepository,
  type CanonicalRetirementRequest,
} from '../../vault/object-organization';
import { SharedSettingsRepository } from '../../vault/shared-settings';
import { VaultIndexEngine } from '../../vault/index';
import type { CanonicalRetirePreflightBlocker } from '../../sync/coordinator';

export interface ObjectBulkDeleteModalOptions {
  files: string[];
  onApplied?: () => void | Promise<void>;
}

interface DeletePreview {
  requests: CanonicalRetirementRequest[];
  blockers: string[];
  syncBlockers: CanonicalRetirePreflightBlocker[];
}

interface DeletePreflightProgress {
  phase: 'checking_files' | 'checking_sync';
  completed: number;
  total: number;
}

export class ObjectBulkDeleteModal extends Modal {
  private readonly settingsRepository: SharedSettingsRepository;
  private readonly organizationRepository: ObjectOrganizationRepository;
  private preview: DeletePreview | null = null;
  private preflightProgress: DeletePreflightProgress | null = null;
  private isApplying = false;

  constructor(
    private readonly context: ViewContext,
    private readonly options: ObjectBulkDeleteModalOptions,
  ) {
    super(context.app);
    this.settingsRepository = new SharedSettingsRepository(context.app.vault);
    this.organizationRepository = new ObjectOrganizationRepository(
      context.app.vault,
      this.settingsRepository,
    );
  }

  async onOpen(): Promise<void> {
    // Render before any vault reads so large selections never open as a blank modal.
    this.render();
    try {
      await this.refreshPreview();
    } catch (error) {
      this.preflightProgress = null;
      this.preview = {
        requests: [],
        blockers: [`Unable to prepare delete: ${error instanceof Error ? error.message : String(error)}`],
        syncBlockers: [],
      };
    }
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async refreshPreview(): Promise<void> {
    const paths = Array.from(new Set(this.options.files.map(normalizePath))).sort((a, b) => a.localeCompare(b));
    const requests: CanonicalRetirementRequest[] = [];
    const blockers: string[] = [];
    const usedTombstonePaths = new Map<string, string>();
    this.preview = null;
    this.preflightProgress = { phase: 'checking_files', completed: 0, total: paths.length };
    this.render();
    const index = this.context.vaultIndexEngine?.getIndex()
      ?? this.context.plugin.vaultIndexEngine?.getIndex()
      ?? null;

    for (let position = 0; position < paths.length; position += 1) {
      const path = paths[position]!;
      try {
        if (path === 'app' || path.startsWith('app/') || path === '_deleted' || path.startsWith('_deleted/')) {
          blockers.push(`${path}: system paths cannot be deleted from Organization Issues.`);
          continue;
        }

        const file = this.context.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
          blockers.push(`${path}: Markdown file no longer exists.`);
          continue;
        }

        const markdown = await this.context.app.vault.read(file);
        const indexedObject = index
          ? Array.from(index.objects.values()).find(object => normalizePath(object.path) === path)
          : undefined;
        const parsed = ObjectParser.parseMarkdown(markdown);
        const explicitId = typeof parsed.frontmatter.id === 'string' ? parsed.frontmatter.id.trim() : '';
        const id = indexedObject?.id || explicitId || createCanonicalObjectId();
        const tombstonePath = normalizePath(canonicalRetirementPath(id));
        const priorSource = usedTombstonePaths.get(tombstonePath);
        if (priorSource && priorSource !== path) {
          blockers.push(
            `${path}: shares object ID ${id} with ${priorSource}; deleting both would collide at ${tombstonePath}. Resolve the duplicate ID first or delete one at a time.`,
          );
          continue;
        }
        usedTombstonePaths.set(tombstonePath, path);

        const occupiedTombstone = this.context.app.vault.getAbstractFileByPath(tombstonePath);
        if (occupiedTombstone) {
          blockers.push(`${path}: tombstone destination already exists at ${tombstonePath}.`);
          continue;
        }

        requests.push({
          path,
          id,
          expectedMarkdown: markdown,
          deletedAt: new Date().toISOString(),
        });
      } finally {
        const completed = position + 1;
        if (completed === paths.length || completed % 25 === 0) {
          this.preflightProgress = { phase: 'checking_files', completed, total: paths.length };
          this.render();
          await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        }
      }
    }

    let syncBlockers: CanonicalRetirePreflightBlocker[] = [];
    if (requests.length > 0 && blockers.length === 0 && this.context.plugin.settings.isPaired) {
      this.preflightProgress = { phase: 'checking_sync', completed: 0, total: requests.length };
      this.render();
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      const coordinator = this.context.driveSyncCoordinator ?? this.context.plugin.driveSyncCoordinator;
      if (!coordinator) {
        blockers.push('Google Drive sync is paired but its coordinator is unavailable. Reopen Obsidian or Sync Center before deleting.');
      } else {
        const result = await coordinator.preflightCanonicalRetire(requests.map(request => request.path));
        syncBlockers = result.blockers;
      }
    }

    this.preview = { requests, blockers, syncBlockers };
    this.preflightProgress = null;
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Delete selected objects?' });

    if (!this.preview) {
      const status = contentEl.createEl('div', { cls: 'qz-empty-state' });
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const progress = this.preflightProgress;
      if (progress?.phase === 'checking_files') {
        status.createEl('p', {
          text: `Checking files ${progress.completed}/${progress.total}…`,
        });
        const progressBar = status.createEl('progress');
        progressBar.max = Math.max(1, progress.total);
        progressBar.value = progress.completed;
        progressBar.setAttribute('aria-label', 'Bulk delete file safety preflight');
      } else if (progress?.phase === 'checking_sync') {
        status.createEl('p', {
          text: `Checking sync safety for ${progress.total} selected file${progress.total === 1 ? '' : 's'}…`,
        });
        status.createEl('small', {
          text: 'Quartzo is verifying the canonical Drive baseline before any deletion is allowed.',
          cls: 'qz-text-muted',
        });
      } else {
        status.createEl('p', { text: 'Checking deletion safety…' });
      }
      return;
    }

    const { requests, blockers, syncBlockers } = this.preview;
    contentEl.createEl('p', {
      text: `Quartzo will retire ${requests.length} selected Markdown file${requests.length === 1 ? '' : 's'} through the canonical _deleted lifecycle.`,
    });
    contentEl.createEl('p', {
      text: 'This is not a raw file delete: each object becomes a tombstone under _deleted/<id>.md. When Drive sync is paired, the same tracked remote file ID is moved to the tombstone path so stale remote copies are not pulled back.',
      cls: 'qz-text-muted',
    });
    contentEl.createEl('p', {
      text: 'If Drive changed an object since the last shared baseline, deletion is blocked or becomes an explicit sync conflict instead of silently discarding the remote edit.',
      cls: 'qz-text-muted',
    });

    const list = contentEl.createEl('ul', { attr: { style: 'max-height: 260px; overflow: auto;' } });
    for (const request of requests.slice(0, 100)) {
      list.createEl('li', { text: `${request.path} → ${canonicalRetirementPath(request.id)}` });
    }
    if (requests.length > 100) {
      contentEl.createEl('small', { text: `…and ${requests.length - 100} more.`, cls: 'qz-text-muted' });
    }

    const allBlockers = [
      ...blockers,
      ...syncBlockers.map(blocker => `${blocker.path}: ${blocker.message}`),
    ];
    if (allBlockers.length > 0) {
      const warning = contentEl.createEl('div', { cls: 'quartzo-warning-state' });
      warning.createEl('strong', { text: 'Delete blocked — nothing has been changed.' });
      const blockerList = warning.createEl('ul');
      for (const blocker of allBlockers) blockerList.createEl('li', { text: blocker });
      warning.createEl('p', {
        text: 'For sync-safety blockers, run Sync now and review any conflict, then retry the delete.',
        cls: 'qz-text-muted',
      });
    }

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(button => {
        button
          .setButtonText(this.isApplying ? 'Deleting…' : `Delete ${requests.length} selected`)
          .setWarning()
          .setDisabled(this.isApplying || requests.length === 0 || allBlockers.length > 0)
          .onClick(() => { void this.apply(); });
      });
  }

  private async apply(): Promise<void> {
    if (this.isApplying) return;
    this.isApplying = true;
    this.render();

    try {
      // Re-read bytes and rerun the Drive preflight immediately before mutation.
      await this.refreshPreview();
      const preview = this.preview;
      if (!preview || preview.requests.length === 0 || preview.blockers.length > 0 || preview.syncBlockers.length > 0) {
        this.isApplying = false;
        this.render();
        return;
      }

      const result = await this.organizationRepository.applyRetirements(preview.requests);
      const engine = this.context.vaultIndexEngine ?? this.context.plugin.vaultIndexEngine;
      const currentIndex = engine?.getIndex() ?? null;
      if (engine && currentIndex && result.retired.length > 0) {
        engine.setIndex(VaultIndexEngine.updateIndex(
          currentIndex,
          result.retired.map(retired => ({ type: 'deleted' as const, path: retired.sourcePath })),
        ));
      }

      for (const retired of result.retired) {
        const source = this.context.app.vault.getAbstractFileByPath(retired.sourcePath);
        const tombstone = this.context.app.vault.getAbstractFileByPath(retired.tombstonePath);
        if (source || !(tombstone instanceof TFile)) {
          throw new Error(`Delete postcondition failed for ${retired.sourcePath}.`);
        }
      }

      if (result.error) {
        new Notice(
          `Deleted ${result.retired.length} object(s), then stopped safely at ${result.failedPath}: ${result.error.message}`,
          10000,
        );
        this.isApplying = false;
        await this.refreshPreview();
        this.render();
        return;
      }

      if (this.context.plugin.settings.isPaired && this.context.plugin.settings.syncMode === 'manual') {
        new Notice(
          `Deleted ${result.retired.length} object(s) locally. The canonical rename is queued; use Sync now to propagate the tombstones to Drive.`,
          8000,
        );
      } else {
        new Notice(`Deleted ${result.retired.length} object(s) through the canonical _deleted lifecycle.`);
      }

      await this.options.onApplied?.();
      this.close();
    } catch (error) {
      this.isApplying = false;
      new Notice(`Bulk delete stopped safely: ${error instanceof Error ? error.message : String(error)}`, 10000);
      await this.refreshPreview();
      this.render();
    }
  }
}
