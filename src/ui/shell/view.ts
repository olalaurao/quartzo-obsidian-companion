import { getIcon, ItemView, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import { addLocalDays, localIsoDate, parseLocalIsoDate, shiftLocalMonth } from '../../core/local-date';
import { chooseNewestConflictResolution, type SyncPendingDiagnostic, type SyncProgress, type SyncStatusSnapshot } from '../../sync/coordinator';
import {
  queryVaultObjects,
  type ObjectQueryArchiveFilter,
  type ObjectQueryConflictFilter,
  type ObjectQuerySort,
} from '../../core/object-query';
import { renderObjectDetail } from '../detail/object-detail';
import { renderObjectEditor } from '../detail/object-editor';
import { renderHomeView } from '../home/view';
import { renderPlannerSurface, type PlannerDayLens } from '../planner/view';
import { monthGridDates, weekDates } from '../planner/calendar-projection';
import { renderScheduleList as renderDailyScheduleList } from '../daily/schedule-list';
import { projectJournalDay } from '../journal/journal-projection';
import { projectOverdueObjects } from '../../core/overdue_projection';
import {
  SharedSettingsRepository,
} from '../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../vault/index/types';
import { QuickAddModal } from '../quick-add/modal';
import type { ViewContext } from '../types';
import { buildConflictDiff, formatConflictDiff } from '../sync/conflict-diff';
import {
  isOrganizationIssuePathExcluded,
  isSystemIssuePath,
  normalizeIssueIgnoredFolders,
  projectOrganizationIssues,
  type IssueCategory,
} from '../../core/object-organization/issues-projection';
import { renderFocusRuntime } from '../focus/view';

export const QUARTZO_VIEW_TYPE = 'quartzo-view';
export type QuartzoSection = 'home' | 'planner' | 'journal' | 'browse' | 'objects' | 'issues';
export type QuartzoAction = 'focus' | 'search' | 'add' | 'sync' | 'conflicts' | 'type-conflicts' | 'settings' | 'organize' | 'folder_review';
function isoDate(date: Date): string {
  return localIsoDate(date);
}

function addDays(date: Date, days: number): Date {
  return addLocalDays(date, days);
}

function parseIsoDate(value: string): Date {
  return parseLocalIsoDate(value);
}

function labelForType(type: string): string {
  if (type === 'tracker_record') return 'Record';
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatSyncProgress(progress: SyncProgress | null): string {
  if (!progress) return 'Sync is active. Waiting for the coordinator to report its current phase…';

  const phaseLabels: Record<SyncProgress['phase'], string> = {
    local_inventory: 'Scanning local vault',
    remote_inventory: 'Listing Google Drive vault',
    resolving_paths: 'Resolving Drive paths',
    hashing_remote: 'Hashing remote files',
    processing_changes: 'Processing Drive changes',
    processing_local_changes: 'Processing local changes',
    reconciling: 'Reconciling files',
    finalizing: 'Finalizing sync',
  };
  const now = Date.now();
  const elapsed = formatDurationSeconds((now - progress.startedAt) / 1000);
  const lastActivity = formatDurationSeconds((now - progress.lastActivityAt) / 1000);
  const amount = progress.total > 0
    ? ` · ${progress.completed}/${progress.total} (${Math.min(100, Math.round((progress.completed / progress.total) * 100))}%)`
    : progress.completed > 0
      ? ` · ${progress.completed} processed`
      : '';
  const current = progress.currentPath ? ` · ${progress.currentPath}` : '';
  return `${phaseLabels[progress.phase]}${amount}${current} · elapsed ${elapsed} · last progress update ${lastActivity} ago`;
}

function formatPendingDiagnostic(diagnostic: SyncPendingDiagnostic): string {
  const reasonLabels: Record<SyncPendingDiagnostic['reason'], string> = {
    local_create: 'local create',
    local_modify: 'local modify',
    pending_delete: 'pending delete',
    pending_rename: 'pending rename',
    adoption_required: 'adoption required',
    conflict: 'conflict',
    quarantined_duplicate_identity: 'quarantined duplicate identity',
  };
  const related = diagnostic.relatedPath ? ` (${diagnostic.relatedPath})` : '';
  return `${diagnostic.path}: ${reasonLabels[diagnostic.reason]}${related}`;
}

function formatSyncDiagnosticsText(input: {
  statusLabel: string;
  snapshot: SyncStatusSnapshot;
  syncMode: 'automatic' | 'manual';
  driveVault: string;
  googleAccountStatus: string;
  companionVersion: string;
}): string {
  const lines = [
    'Quartzo Companion sync diagnostics',
    `Status: ${input.statusLabel}`,
    `Last successful sync: ${input.snapshot.lastSuccessfulSyncAt ?? 'Never'}`,
    `Pending local changes: ${input.snapshot.pendingLocalChanges}`,
    `Sync mode: ${input.syncMode === 'automatic' ? 'Automatic' : 'Manual'}`,
    `Current Google Drive vault: ${input.driveVault}`,
    `Google account: ${input.googleAccountStatus}`,
    `Companion version: ${input.companionVersion}`,
    `Conflicts: ${input.snapshot.conflictCount}`,
  ];
  if (input.snapshot.lastError) lines.push(`Last error: ${input.snapshot.lastError}`);
  if (input.snapshot.pendingDiagnostics.length > 0) {
    lines.push('Pending diagnostics:');
    for (const diagnostic of input.snapshot.pendingDiagnostics) {
      lines.push(`- ${formatPendingDiagnostic(diagnostic)}`);
    }
  }
  return lines.join('\n');
}

function scheduleObjects(index: VaultIndex | null): Array<Record<string, unknown>> {
  if (!index) return [];
  return Array.from(index.objects.values()).map(object => ({
    ...object.frontmatter,
    id: object.id,
    type: object.type,
    body: object.body,
    __path: object.path,
  }));
}

export class QuartzoView extends ItemView {
  private section: QuartzoSection = 'home';
  public action: QuartzoAction | null = null;
  private selectedObjectId: string | null = null;
  public selectedFolder: string | null = null;
  private editingSelectedObject = false;
  private selectedDate = isoDate(new Date());
  private plannerMode: 'day' | 'week' | 'month' = 'day';
  private plannerDayLens: PlannerDayLens = 'timeline';
  private sharedSettingsRepository: SharedSettingsRepository;
  private syncProgressTickerId: number | null = null;
  private renderGeneration = 0;
  private issueCategoryFilter: IssueCategory | 'All' = 'All';
  private issueSearchQuery: string = '';
  private issueActionableFilter: 'All' | 'Actionable' | 'Informational' = 'All';
  private issueIgnoredFoldersExpanded = false;
  private readonly issueSelectedPaths = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly context: ViewContext) {
    super(leaf);
    this.sharedSettingsRepository = new SharedSettingsRepository(context.app.vault);
  }

  getViewType(): string { return QUARTZO_VIEW_TYPE; }
  getDisplayText(): string { return 'Quartzo'; }
  getIcon(): string { return 'calendar-clock'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.stopSyncProgressTicker();
  }

  private stopSyncProgressTicker(): void {
    if (this.syncProgressTickerId !== null) {
      window.clearInterval(this.syncProgressTickerId);
      this.syncProgressTickerId = null;
    }
  }

  private startSyncProgressTicker(
    line: HTMLParagraphElement,
    getProgress: () => SyncProgress | null
  ): void {
    this.stopSyncProgressTicker();
    const refresh = () => {
      if (!line.isConnected) {
        this.stopSyncProgressTicker();
        return;
      }
      line.textContent = formatSyncProgress(getProgress());
    };
    refresh();
    this.syncProgressTickerId = window.setInterval(refresh, 1000);
  }

  private isCurrentRender(container: HTMLElement, generation: number): boolean {
    return generation === this.renderGeneration && container.isConnected;
  }

  async setSection(section: QuartzoSection): Promise<void> {
    this.section = section;
    this.action = null;
    this.selectedObjectId = null;
    this.editingSelectedObject = false;
    if (section === 'home') this.selectedDate = isoDate(new Date());
    await this.render();
  }

  async handleAction(action: QuartzoAction): Promise<void> {
    this.selectedObjectId = null;
    this.editingSelectedObject = false;
    if (action === 'add') {
      new QuickAddModal(this.context).open();
      return;
    }
    if (action === 'settings') {
      this.context.plugin.openSettings();
      return;
    }
    this.action = action;
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  async openObjectById(objectId: string): Promise<boolean> {
    if (this.getIndex()?.objects.has(objectId) !== true) return false;
    this.action = null;
    this.selectedObjectId = objectId;
    this.editingSelectedObject = false;
    await this.render();
    return true;
  }

  private getIndex(): VaultIndex | null {
    return this.context.vaultIndexEngine?.getIndex() ?? this.context.plugin.vaultIndexEngine?.getIndex() ?? null;
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.stopSyncProgressTicker();
    this.contentEl.empty();
    const shell = document.createElement('div');
    shell.className = 'quartzo-shell';
    this.contentEl.appendChild(shell);

    const header = document.createElement('div');
    header.className = 'quartzo-shell-header';
    const brand = document.createElement('strong');
    brand.textContent = 'Quartzo';
    header.appendChild(brand);

    const nav = document.createElement('nav');
    nav.className = 'qz-nav-tabs';
    const sectionIcons: Record<QuartzoSection, string> = {
      home: '🏠', planner: '📅', journal: '📓', browse: '🔍', objects: '🗂', issues: '⚠️'
    };
    for (const section of ['home', 'planner', 'journal', 'browse', 'objects', 'issues'] as QuartzoSection[]) {
      const button = document.createElement('button');
      button.className = 'qz-nav-tab';
      button.textContent = `${sectionIcons[section]} ${labelForType(section)}`;
      if (section === this.section) {
        button.classList.add('is-active');
        button.setAttribute('aria-current', 'page');
      }
      button.addEventListener('click', () => { void this.setSection(section); });
      nav.appendChild(button);
    }
    header.appendChild(nav);

    const actions = document.createElement('div');
    actions.className = 'quartzo-shell-actions';

    const focusSnapshot = this.context.plugin.getFocusRuntimeViewState(new Date());
    const focusButton = document.createElement('button');
    focusButton.className = focusSnapshot.runtime.currentSessionId
      ? 'qz-btn qz-btn-secondary'
      : 'qz-btn qz-btn-ghost';
    focusButton.textContent = focusSnapshot.runtime.currentSessionId
      ? focusSnapshot.canControl
        ? '⏱ Focus · Active'
        : '⏱ Focus · Read-only'
      : '⏱ Focus';
    if (this.action === 'focus') {
      focusButton.classList.add('is-active');
      focusButton.setAttribute('aria-pressed', 'true');
    }
    focusButton.addEventListener('click', () => {
      void this.handleAction('focus');
    });
    actions.appendChild(focusButton);

    const actionDefs: Array<[QuartzoAction, string, string]> = [
      ['search', '🔍', 'Search'],
      ['add', '＋', 'Add'],
      ['type-conflicts', '⚠', 'Type Conflicts'],
      ['sync', '☁', 'Sync'],
      ['settings', '⚙', 'Settings'],
    ];
    for (const [action, icon, label] of actionDefs) {
      const button = document.createElement('button');
      button.className = action === 'add' ? 'qz-btn qz-btn-primary qz-btn-sm' : 'qz-btn qz-btn-ghost qz-btn-sm';
      button.textContent = `${icon} ${label}`;
      if (this.action === action) {
        button.classList.add('is-active');
        button.setAttribute('aria-pressed', 'true');
      }
      button.addEventListener('click', () => { void this.handleAction(action); });
      actions.appendChild(button);
    }
    header.appendChild(actions);
    shell.appendChild(header);

    const content = document.createElement('main');
    content.className = 'quartzo-shell-content';
    shell.appendChild(content);

    const sharedSettingsState = this.context.plugin.getSharedSettingsState();
    if (sharedSettingsState === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'qz-empty-state';
      loading.setAttribute('role', 'status');
      loading.setAttribute('aria-live', 'polite');
      const icon = document.createElement('div');
      icon.className = 'qz-empty-state-icon';
      icon.textContent = '⏳';
      const title = document.createElement('div');
      title.className = 'qz-empty-state-title';
      title.textContent = 'Loading Quartzo vault index…';
      loading.appendChild(icon);
      loading.appendChild(title);
      content.appendChild(loading);
      return;
    }
    if (sharedSettingsState === 'missing') {
      const warning = document.createElement('div');
      warning.className = 'quartzo-warning-state';
      warning.setAttribute('role', 'alert');
      const badge = document.createElement('span');
      badge.className = 'qz-badge qz-badge-warning';
      badge.textContent = '⚠ Settings missing';
      warning.appendChild(badge);
      const msg = document.createElement('span');
      msg.textContent = ' Shared Quartzo settings are missing (app/quartzo_shared_settings.md). Explicitly typed objects remain available; Object Identification-dependent files may be unavailable until Quartzo creates the shared settings file.';
      warning.appendChild(msg);
      content.appendChild(warning);
    }

    if (this.selectedObjectId) {
      const object = this.getIndex()?.objects.get(this.selectedObjectId);
      if (object) {
        if (this.editingSelectedObject) {
          renderObjectEditor(content, object, {
            onCancel: () => {
              this.editingSelectedObject = false;
              void this.render();
            },
            onSave: async patch => {
              await this.context.plugin.mutateObject(object, patch);
              this.editingSelectedObject = false;
              await this.render();
            },
          });
        } else {
          renderObjectDetail(content, object, {
            onBack: () => {
              this.selectedObjectId = null;
              this.editingSelectedObject = false;
              void this.render();
            },
            onOpenMarkdown: () => this.openMarkdown(object),
            onEdit: () => {
              this.editingSelectedObject = true;
              void this.render();
            },
          });
        }
        return;
      }
      this.selectedObjectId = null;
      this.editingSelectedObject = false;
    }

    if (this.action === 'focus') {
      renderFocusRuntime(content, this.context.plugin);
      return;
    }
    if (this.action === 'search') {
      this.renderSearch(content);
      return;
    }
    if (this.action === 'sync' || this.action === 'conflicts') {
      await this.renderSync(content, this.action === 'conflicts', generation);
      return;
    }
    if (this.action === 'type-conflicts') {
      this.renderTypeConflicts(content);
      return;
    }
    if (this.action === 'folder_review') {
      this.renderFolderReview(content);
      return;
    }

    if (this.section === 'home') await this.renderHome(content, generation);
    if (this.section === 'planner') await this.renderPlanner(content, generation);
    if (this.section === 'journal') await this.renderJournal(content, generation);
    if (this.section === 'browse') this.renderBrowse(content);
    if (this.section === 'objects') this.renderObjects(content);
    if (this.section === 'issues') await this.renderIssues(content);
  }

  private renderObjects(container: HTMLElement): void {
    container.empty();
    const wrapper = container.createEl('div', { cls: 'quartzo-page-content' });
    wrapper.createEl('h2', { text: 'Objects Overview' });
    wrapper.createEl('p', { text: 'Breakdown of your identified Quartzo objects (§39).' });

    const index = this.getIndex();
    if (!index) {
      wrapper.createEl('p', { text: 'Vault index not loaded yet.' });
      return;
    }

    const counts = new Map<string, number>();
    for (const obj of index.objects.values()) {
      const type = obj.type;
      counts.set(type, (counts.get(type) || 0) + 1);
    }

    if (counts.size === 0) {
      wrapper.createEl('div', { cls: 'qz-empty-state', text: 'No identified objects found in the vault.' });
      return;
    }

    const table = wrapper.createEl('table', { cls: 'quartzo-data-table' });
    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    headRow.createEl('th', { text: 'Type' });
    headRow.createEl('th', { text: 'Count' });
    headRow.createEl('th', { text: 'Actions' });

    const tbody = table.createEl('tbody');
    const sortedTypes = Array.from(counts.keys()).sort();

    for (const type of sortedTypes) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: type });
      row.createEl('td', { text: String(counts.get(type)) });

      const actionsTd = row.createEl('td');
      const filterBtn = actionsTd.createEl('button', { text: 'Filter', cls: 'qz-btn qz-btn-ghost qz-btn-sm' });
      filterBtn.addEventListener('click', () => {
        new Notice(`Filtering by type: ${type} (Switching to browse)`);
        void this.setSection('browse');
      });
    }
  }

  private async renderIssues(container: HTMLElement): Promise<void> {
    container.empty();
    const wrapper = container.createEl('div', { cls: 'quartzo-page-content' });
    wrapper.createEl('h2', { text: 'Organization Issues' });
    wrapper.createEl('p', { text: 'Actionable items requiring your attention to keep Quartzo organized (§40).' });

    const index = this.getIndex();
    if (!index) return;

    const allFiles = this.context.app.vault.getFiles().filter(file => file.name.endsWith('.md')).map(file => file.path);
    const settings = await this.sharedSettingsRepository.load();
    const ignoredFolderPaths = normalizeIssueIgnoredFolders(this.context.plugin.settings.issueIgnoredFolders);

    const issues = projectOrganizationIssues({
      index,
      settings,
      allMarkdownPaths: new Set(allFiles),
      ignoredFolderPaths,
    });

    const bulkCategories = new Set<IssueCategory>(['unidentified', 'ambiguous', 'mismatch']);
    const isBulkOrganizeIssue = (issue: (typeof issues)[number]): boolean =>
      issue.actionable && bulkCategories.has(issue.category);
    const isDeletableIssue = (issue: (typeof issues)[number]): boolean => {
      if (!issue.actionable || isOrganizationIssuePathExcluded(issue.subjectPath, ignoredFolderPaths)) return false;
      const file = this.context.app.vault.getAbstractFileByPath(issue.subjectPath);
      return file instanceof TFile && file.extension.toLowerCase() === 'md';
    };
    const bulkOrganizePaths = new Set(
      issues.filter(isBulkOrganizeIssue).map(issue => issue.subjectPath),
    );
    const bulkRepairPaths = new Set(
      issues.filter(issue => issue.category === 'repair').map(issue => issue.subjectPath),
    );
    const selectablePaths = new Set(
      issues.filter(isDeletableIssue).map(issue => issue.subjectPath),
    );
    for (const selectedPath of Array.from(this.issueSelectedPaths)) {
      if (!selectablePaths.has(selectedPath)) this.issueSelectedPaths.delete(selectedPath);
    }

    const persistIgnoredFolders = async (nextFolders: readonly string[]): Promise<void> => {
      const normalized = normalizeIssueIgnoredFolders(nextFolders).filter(folder => !isSystemIssuePath(folder));
      this.context.plugin.settings.issueIgnoredFolders = normalized;
      await this.context.plugin.saveSettings();
      await this.renderIssues(container);
    };

    const openOrganization = (files: string[]): void => {
      if (files.length === 0) return;
      const { ObjectOrganizationModal } = require('../organization/modal');
      new ObjectOrganizationModal(this.context, {
        files,
        onApplied: async () => {
          this.issueSelectedPaths.clear();
          await this.render();
        },
      }).open();
    };

    const openBulkDelete = (files: string[]): void => {
      if (files.length === 0) return;
      const { ObjectBulkDeleteModal } = require('../organization/delete-modal');
      new ObjectBulkDeleteModal(this.context, {
        files,
        onApplied: async () => {
          this.issueSelectedPaths.clear();
          await this.render();
        },
      }).open();
    };

    const openIssueMarkdown = (path: string): void => {
      const file = this.context.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        new Notice(`Markdown file no longer exists: ${path}`);
        return;
      }
      void this.context.app.workspace.openLinkText(path, '', true);
    };

    const toolbar = wrapper.createEl('div', {
      cls: 'quartzo-issues-toolbar',
      attr: { style: 'display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;' },
    });

    const catSelect = toolbar.createEl('select', { cls: 'qz-input' });
    catSelect.setAttribute('aria-label', 'Filter Organization Issues by category');
    const categories: Array<IssueCategory | 'All'> = ['All', 'unidentified', 'ambiguous', 'mismatch', 'duplicate', 'broken_relationship', 'repair', 'interrupted'];
    for (const cat of categories) {
      const count = cat === 'All' ? issues.length : issues.filter(issue => issue.category === cat).length;
      const label = cat === 'All' ? 'All Categories' : labelForType(cat);
      catSelect.createEl('option', { value: cat, text: `${label} (${count})` }).selected = this.issueCategoryFilter === cat;
    }

    const actSelect = toolbar.createEl('select', { cls: 'qz-input' });
    actSelect.setAttribute('aria-label', 'Filter Organization Issues by actionability');
    const actionableCounts = {
      All: issues.length,
      Actionable: issues.filter(issue => issue.actionable).length,
      Informational: issues.filter(issue => !issue.actionable).length,
    };
    for (const act of ['All', 'Actionable', 'Informational'] as const) {
      actSelect.createEl('option', { value: act, text: `${act} (${actionableCounts[act]})` }).selected = this.issueActionableFilter === act;
    }

    const searchInput = toolbar.createEl('input', { type: 'search', placeholder: 'Search issues...', cls: 'qz-input' });
    searchInput.setAttribute('aria-label', 'Search Organization Issues');
    searchInput.value = this.issueSearchQuery;

    const clearBtn = toolbar.createEl('button', { text: 'Clear filters', cls: 'qz-btn qz-btn-ghost' });

    const ignoredPanel = wrapper.createEl('details', {
      cls: 'quartzo-issues-ignored-folders',
      attr: { style: 'margin-bottom: 16px; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px;' },
    });
    ignoredPanel.open = this.issueIgnoredFoldersExpanded;
    ignoredPanel.addEventListener('toggle', () => {
      this.issueIgnoredFoldersExpanded = ignoredPanel.open;
    });
    const ignoredSummary = ignoredPanel.createEl('summary', {
      text: `⚙️ Ignored folders (${ignoredFolderPaths.length})`,
      attr: { style: 'cursor: pointer; font-weight: 600;' },
    });
    ignoredSummary.setAttribute('aria-label', 'Manage ignored folders for Organization Issues');
    ignoredPanel.createEl('p', {
      text: 'Ignored folders affect Organization Issues only. They do not change Object Identification, move files, or change sync.',
      cls: 'qz-text-muted',
    });

    const systemRow = ignoredPanel.createEl('div', {
      attr: { style: 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;' },
    });
    systemRow.createEl('span', { text: 'app/**', cls: 'qz-badge qz-badge-neutral' });
    systemRow.createEl('span', { text: 'System exclusion — cannot be removed. Interrupted migration diagnostics may still appear.' });

    const ignoredList = ignoredPanel.createEl('div', {
      attr: { style: 'display: grid; gap: 6px; margin-bottom: 10px;' },
    });
    if (ignoredFolderPaths.length === 0) {
      ignoredList.createEl('small', { text: 'No user folders are ignored.', cls: 'qz-text-muted' });
    } else {
      for (const folderPath of ignoredFolderPaths) {
        const row = ignoredList.createEl('div', {
          attr: { style: 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;' },
        });
        row.createEl('code', { text: `${folderPath}/**` });
        const remove = row.createEl('button', { text: 'Remove', cls: 'qz-btn qz-btn-ghost qz-btn-sm' });
        remove.setAttribute('aria-label', `Stop ignoring ${folderPath}`);
        remove.addEventListener('click', () => {
          void persistIgnoredFolders(ignoredFolderPaths.filter(folder => folder !== folderPath));
        });
      }
    }

    const folderSuggestions = this.context.app.vault.getAllLoadedFiles()
      .filter((entry): entry is TFolder => entry instanceof TFolder && entry.path.length > 0)
      .map(folder => folder.path)
      .filter(path => !isSystemIssuePath(path))
      .sort((left, right) => left.localeCompare(right));
    const normalizedSuggestionPaths = new Map(
      folderSuggestions.map(path => [normalizeIssueIgnoredFolders([path])[0], path] as const),
    );

    const addRow = ignoredPanel.createEl('div', {
      attr: { style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;' },
    });
    const folderInput = addRow.createEl('input', {
      type: 'search',
      placeholder: 'Choose a vault folder...',
      cls: 'qz-input',
      attr: { list: 'quartzo-issue-folder-options' },
    });
    folderInput.setAttribute('aria-label', 'Folder to ignore in Organization Issues');
    const folderOptions = ignoredPanel.createEl('datalist', { attr: { id: 'quartzo-issue-folder-options' } });
    for (const folderPath of folderSuggestions) {
      folderOptions.createEl('option', { value: folderPath });
    }
    const addFolder = addRow.createEl('button', { text: 'Add folder', cls: 'qz-btn qz-btn-secondary qz-btn-sm' });
    addFolder.addEventListener('click', () => {
      const normalizedCandidate = normalizeIssueIgnoredFolders([folderInput.value])[0];
      if (!normalizedCandidate) {
        new Notice('Choose a vault folder to ignore.');
        return;
      }
      if (isSystemIssuePath(normalizedCandidate)) {
        new Notice('app/** is already excluded by the system and cannot be configured here.');
        return;
      }
      const existingFolder = normalizedSuggestionPaths.get(normalizedCandidate);
      if (!existingFolder) {
        new Notice('Choose an existing vault folder.');
        return;
      }
      if (ignoredFolderPaths.includes(normalizedCandidate)) {
        new Notice(`${existingFolder} is already ignored in Organization Issues.`);
        return;
      }
      void persistIgnoredFolders([...ignoredFolderPaths, existingFolder]);
    });

    const resultsHost = wrapper.createEl('div', { cls: 'quartzo-issues-results' });

    const renderFilteredIssues = () => {
      resultsHost.replaceChildren();

      if (issues.length === 0) {
        const success = resultsHost.createEl('div', { cls: 'qz-empty-state' });
        success.createEl('p', { text: '🎉 No organization issues found.' });
        return;
      }

      const filteredIssues = issues.filter(issue => {
        if (this.issueCategoryFilter !== 'All' && issue.category !== this.issueCategoryFilter) return false;
        if (this.issueActionableFilter === 'Actionable' && !issue.actionable) return false;
        if (this.issueActionableFilter === 'Informational' && issue.actionable) return false;
        const query = this.issueSearchQuery.trim().toLowerCase();
        if (query) {
          const subjectId = issue.subjectId?.toLowerCase() ?? '';
          if (!issue.title.toLowerCase().includes(query)
            && !issue.why.toLowerCase().includes(query)
            && !issue.subjectPath.toLowerCase().includes(query)
            && !subjectId.includes(query)) {
            return false;
          }
        }
        return true;
      });

      const showing = resultsHost.createEl('p', { cls: 'qz-text-muted' });
      showing.textContent = `Showing ${filteredIssues.length} of ${issues.length} issues`;

      const matchingSelectablePaths = Array.from(new Set(
        filteredIssues.filter(isDeletableIssue).map(issue => issue.subjectPath),
      )).sort((left, right) => left.localeCompare(right));

      const selectionBar = resultsHost.createEl('div', {
        cls: 'quartzo-issues-selection-bar',
        attr: { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 12px;' },
      });
      const selectedLabel = selectionBar.createEl('strong', {
        text: `${this.issueSelectedPaths.size} selected`,
      });
      selectedLabel.setAttribute('aria-live', 'polite');

      const selectMatching = selectionBar.createEl('button', {
        text: `Select matching (${matchingSelectablePaths.length})`,
        cls: 'qz-btn qz-btn-ghost qz-btn-sm',
      });
      selectMatching.disabled = matchingSelectablePaths.length === 0;
      selectMatching.addEventListener('click', () => {
        for (const path of matchingSelectablePaths) this.issueSelectedPaths.add(path);
        renderFilteredIssues();
      });

      const clearSelection = selectionBar.createEl('button', {
        text: 'Clear selection',
        cls: 'qz-btn qz-btn-ghost qz-btn-sm',
      });
      clearSelection.disabled = this.issueSelectedPaths.size === 0;
      clearSelection.addEventListener('click', () => {
        this.issueSelectedPaths.clear();
        renderFilteredIssues();
      });

      const selectedPaths = Array.from(this.issueSelectedPaths).sort((left, right) => left.localeCompare(right));
      const allSelectedOrganizable = selectedPaths.length > 0
        && selectedPaths.every(path => bulkOrganizePaths.has(path));

      const organizeSelected = selectionBar.createEl('button', {
        text: 'Organize selected…',
        cls: 'qz-btn qz-btn-primary qz-btn-sm',
      });
      organizeSelected.disabled = !allSelectedOrganizable;
      if (!allSelectedOrganizable && selectedPaths.length > 0) {
        organizeSelected.title = 'Organize is available only when every selected path is unidentified, ambiguous, or mismatched.';
      }
      organizeSelected.addEventListener('click', () => {
        if (allSelectedOrganizable) openOrganization(selectedPaths);
      });

      const allSelectedRepairable = selectedPaths.length > 0
        && selectedPaths.every(path => bulkRepairPaths.has(path));

      const repairSelected = selectionBar.createEl('button', {
        text: 'Repair selected…',
        cls: 'qz-btn qz-btn-primary qz-btn-sm',
      });
      repairSelected.disabled = !allSelectedRepairable;
      if (!allSelectedRepairable && selectedPaths.length > 0) {
        repairSelected.title = 'Available only when every selected path is a repairable format issue.';
      }
      repairSelected.addEventListener('click', async () => {
        if (!allSelectedRepairable) return;
        repairSelected.disabled = true;
        repairSelected.textContent = 'Repairing...';
        let errors = 0;
        const { ObjectParser } = require('../../core/objects/parser');
        for (const subjectPath of selectedPaths) {
          try {
            const file = this.context.app.vault.getAbstractFileByPath(subjectPath);
            if (file && 'extension' in file && file.extension === 'md') {
              const content = await this.context.app.vault.read(file as any);
              const repaired = ObjectParser.roundtrip(content);
              await this.context.app.vault.modify(file as any, repaired);
            }
          } catch (e) {
            errors++;
            console.error(`Repair failed for ${subjectPath}`, e);
          }
        }
        if (errors > 0) {
          new Notice(`Repaired ${selectedPaths.length - errors} issues. ${errors} failed.`);
        } else {
          new Notice(`Successfully repaired ${selectedPaths.length} issues.`);
        }
        this.issueSelectedPaths.clear();
        // Wait for Obsidian index/vault events to propagate, then re-render
        setTimeout(() => void this.render(), 300);
      });

      const deleteSelected = selectionBar.createEl('button', {
        text: 'Delete selected…',
        cls: 'qz-btn qz-btn-sm mod-warning',
      });
      deleteSelected.disabled = selectedPaths.length === 0;
      deleteSelected.addEventListener('click', () => {
        openBulkDelete(selectedPaths);
      });

      if (filteredIssues.length === 0) {
        const empty = resultsHost.createEl('div', { cls: 'qz-empty-state' });
        empty.createEl('p', { text: 'No issues match the current filters.' });
        return;
      }

      const table = resultsHost.createEl('table', { cls: 'quartzo-data-table' });
      const thead = table.createEl('thead');
      const headRow = thead.createEl('tr');
      headRow.createEl('th', { text: 'Select' });
      headRow.createEl('th', { text: 'Category' });
      headRow.createEl('th', { text: 'Issue' });
      headRow.createEl('th', { text: 'Action' });

      const tbody = table.createEl('tbody');
      const displayList = filteredIssues.slice(0, 50);

      for (const issue of displayList) {
        const row = tbody.createEl('tr');
        const selectable = isDeletableIssue(issue);

        const selectTd = row.createEl('td');
        if (selectable) {
          const checkbox = selectTd.createEl('input', { type: 'checkbox' });
          checkbox.checked = this.issueSelectedPaths.has(issue.subjectPath);
          checkbox.setAttribute('aria-label', `Select ${issue.subjectPath}`);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) this.issueSelectedPaths.add(issue.subjectPath);
            else this.issueSelectedPaths.delete(issue.subjectPath);
            renderFilteredIssues();
          });
        } else {
          selectTd.createEl('span', { text: '—', cls: 'qz-text-muted' });
        }

        const catTd = row.createEl('td');
        catTd.createEl('span', { cls: 'qz-badge qz-badge-warning', text: issue.category });

        const infoTd = row.createEl('td');
        const titleLink = infoTd.createEl('a', {
          text: issue.title,
          cls: 'internal-link',
          attr: { href: '#', 'data-href': issue.subjectPath, title: 'Open Markdown in Obsidian' },
        });
        titleLink.addEventListener('click', event => {
          event.preventDefault();
          openIssueMarkdown(issue.subjectPath);
        });
        infoTd.createEl('br');
        infoTd.createEl('small', { text: issue.why, cls: 'qz-text-muted' });
        infoTd.createEl('br');
        infoTd.createEl('small', { text: `Path: ${issue.subjectPath}` });

        const actionsTd = row.createEl('td');
        if (isBulkOrganizeIssue(issue)) {
          const orgBtn = actionsTd.createEl('button', { text: 'Organize…', cls: 'qz-btn qz-btn-primary qz-btn-sm' });
          orgBtn.addEventListener('click', () => openOrganization([issue.subjectPath]));
        } else if (issue.category === 'duplicate') {
          const mergeBtn = actionsTd.createEl('button', { text: 'Resolve merge…', cls: 'qz-btn qz-btn-secondary qz-btn-sm' });
          mergeBtn.addEventListener('click', () => {
            const duplicatePaths = Array.from(index.objects.values())
              .filter(object => object.id === issue.subjectId && !isOrganizationIssuePathExcluded(object.path, ignoredFolderPaths))
              .map(object => object.path);
            const { ObjectMergeModal } = require('../organization/merge-modal');
            new ObjectMergeModal(this.context, { files: duplicatePaths }).open();
          });
        } else if (issue.category === 'broken_relationship') {
          const openMarkdown = actionsTd.createEl('button', {
            text: 'Open Markdown',
            cls: 'qz-btn qz-btn-secondary qz-btn-sm',
          });
          openMarkdown.addEventListener('click', () => {
            openIssueMarkdown(issue.subjectPath);
          });
        } else if (issue.category === 'repair') {
          const repairBtn = actionsTd.createEl('button', {
            text: 'Repair format',
            cls: 'qz-btn qz-btn-primary qz-btn-sm',
          });
          repairBtn.addEventListener('click', async () => {
            repairBtn.disabled = true;
            repairBtn.textContent = 'Repairing...';
            try {
              const file = this.context.app.vault.getAbstractFileByPath(issue.subjectPath);
              if (file && 'extension' in file && file.extension === 'md') {
                const content = await this.context.app.vault.read(file as any);
                const { ObjectParser } = require('../../core/objects/parser');
                const repaired = ObjectParser.roundtrip(content);
                await this.context.app.vault.modify(file as any, repaired);
                new Notice('Format repaired successfully.');
                // Wait for Obsidian index/vault events to propagate, then re-render
                setTimeout(() => void this.render(), 300);
              } else {
                new Notice('File not found or not a markdown file.');
              }
            } catch (error) {
              new Notice('Repair failed: ' + String(error));
              repairBtn.disabled = false;
              repairBtn.textContent = 'Repair format';
            }
          });
        } else {
          actionsTd.createEl('span', { text: 'Review required', cls: 'qz-text-muted' });
        }

        if (selectable) {
          const deleteBtn = actionsTd.createEl('button', {
            text: 'Delete…',
            cls: 'qz-btn qz-btn-sm mod-warning',
            attr: { style: 'margin-left: 6px;' },
          });
          deleteBtn.addEventListener('click', () => openBulkDelete([issue.subjectPath]));
        }
      }

      if (filteredIssues.length > 50) {
        resultsHost.createEl('p', {
          text: `Showing first 50 of ${filteredIssues.length} matching issues. Selection actions apply to all matching eligible files, not only the visible 50.`,
          cls: 'qz-text-muted',
        });
      }
    };

    catSelect.addEventListener('change', () => {
      this.issueCategoryFilter = catSelect.value as IssueCategory | 'All';
      renderFilteredIssues();
    });
    actSelect.addEventListener('change', () => {
      this.issueActionableFilter = actSelect.value as 'All' | 'Actionable' | 'Informational';
      renderFilteredIssues();
    });
    searchInput.addEventListener('input', () => {
      this.issueSearchQuery = searchInput.value;
      renderFilteredIssues();
    });
    clearBtn.addEventListener('click', () => {
      this.issueCategoryFilter = 'All';
      this.issueActionableFilter = 'All';
      this.issueSearchQuery = '';
      catSelect.value = 'All';
      actSelect.value = 'All';
      searchInput.value = '';
      renderFilteredIssues();
    });

    renderFilteredIssues();
  }

  private renderFolderReview(container: HTMLElement): void {
    container.empty();
    const wrapper = container.createEl('div', { cls: 'quartzo-page-content' });
    const folderPath = this.selectedFolder || 'Unknown Folder';
    wrapper.createEl('h2', { text: `Review Folder: ${folderPath}` });
    wrapper.createEl('p', { text: 'Files grouped semantically by Quartzo Object Type (§43).' });

    const index = this.getIndex();
    if (!index) return;

    const allObjects = Array.from(index.objects.values());
    const folderObjects = allObjects.filter(object => object.path.startsWith(folderPath + '/') && !object.path.slice(folderPath.length + 1).includes('/'));

    if (folderObjects.length === 0) {
      wrapper.createEl('div', { cls: 'qz-empty-state', text: 'No identified objects found directly in this folder.' });
      return;
    }

    const byType = new Map<string, typeof folderObjects>();
    for (const object of folderObjects) {
      const group = byType.get(object.type) || [];
      group.push(object);
      byType.set(object.type, group);
    }

    const sortedTypes = Array.from(byType.keys()).sort();

    for (const type of sortedTypes) {
      const section = wrapper.createEl('section', { cls: 'quartzo-review-section', attr: { style: 'margin-bottom: 20px;' } });
      const group = byType.get(type)!;

      const header = section.createEl('div', { attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 5px; margin-bottom: 10px;' } });
      header.createEl('h3', { text: `${type} (${group.length})`, attr: { style: 'margin: 0;' } });

      const orgBtn = header.createEl('button', { text: 'Organize this group...', cls: 'qz-btn qz-btn-sm' });
      orgBtn.addEventListener('click', () => {
        const { ObjectOrganizationModal } = require('../organization/modal');
        new ObjectOrganizationModal(this.context, { files: group.map(object => object.path) }).open();
      });

      const list = section.createEl('ul', { attr: { style: 'list-style: none; padding: 0;' } });
      for (const object of group.sort((left, right) => left.path.localeCompare(right.path))) {
        const item = list.createEl('li', { attr: { style: 'padding: 4px 0; display: flex; justify-content: space-between;' } });
        const link = item.createEl('a', { text: object.path.split('/').pop()?.replace('.md', '') || object.path });
        link.addEventListener('click', event => {
          event.preventDefault();
          void this.openObjectById(object.id);
        });
        item.createEl('small', { text: object.id, cls: 'qz-text-muted', attr: { style: 'font-family: monospace; font-size: 0.8em;' } });
      }
    }
  }

  private buildSchedule(date: string, googleEvents: GoogleCalendarProjection[] = []) {
    return DailyScheduleEngine.normalize({
      date,
      today: isoDate(new Date()),
      objects: scheduleObjects(this.getIndex()),
      googleEvents: googleEvents.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        calendarId: event.calendarId,
        colorHex: event.colorHex,
        htmlLink: event.htmlLink,
      })),
      occurrenceResponses: this.context.plugin.getOccurrenceResponses(),
      occurrenceOverrides: this.context.plugin.getOccurrenceOverrides(),
    });
  }

  private buildOverdue(now: Date = new Date()) {
    return projectOverdueObjects(this.getIndex()?.objects.values() ?? [], now);
  }

  private titleForSource(sourceId: string): string {
    const object = this.getIndex()?.objects.get(sourceId);
    return String(object?.frontmatter.title ?? object?.type ?? sourceId);
  }

  private titleForScheduleItem(item: NormalizedItem, googleEvents: GoogleCalendarProjection[] = []): string {
    if (item.origin === 'externalEvent') {
      return googleEvents.find(event => event.id === item.sourceId)?.summary ?? item.sourceLabel;
    }
    return this.titleForSource(item.sourceId);
  }

  private googleEventForScheduleItem(
    item: NormalizedItem,
    googleEvents: GoogleCalendarProjection[],
  ): GoogleCalendarProjection | null {
    if (item.origin !== 'externalEvent') return null;
    return googleEvents.find(event => event.id === item.sourceId) ?? null;
  }

  private canOpenScheduleItem(item: NormalizedItem, googleEvents: GoogleCalendarProjection[]): boolean {
    const external = this.googleEventForScheduleItem(item, googleEvents);
    if (external) return Boolean(external.htmlLink);
    return this.getIndex()?.objects.has(item.sourceId) === true;
  }

  private openScheduleItem(item: NormalizedItem, googleEvents: GoogleCalendarProjection[]): void {
    const external = this.googleEventForScheduleItem(item, googleEvents);
    if (external) {
      void this.context.plugin.openGoogleCalendarEvent(external).catch(error => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const object = this.getIndex()?.objects.get(item.sourceId);
    if (object) this.openObjectDetail(object);
  }

  private renderScheduleList(container: HTMLElement, items: NormalizedItem[], googleEvents: GoogleCalendarProjection[] = []): void {
    renderDailyScheduleList(container, items, {
      app: this.context.app,
      titleForItem: item => this.titleForScheduleItem(item, googleEvents),
      canOpenItem: item => this.canOpenScheduleItem(item, googleEvents),
      onOpenItem: item => this.openScheduleItem(item, googleEvents),
      performOccurrenceAction: (item, action, options) =>
        this.context.plugin.performOccurrenceAction(item, action, options),
      performOccurrenceReschedule: (item, start, end) =>
        this.context.plugin.performOccurrenceReschedule(item, start, end),
      manualExecutionCapability: item =>
        this.context.plugin.getManualExecutionCapability(item),
      startManualExecution: item =>
        this.context.plugin.startManualExecution(item),
    });
  }

  private async renderHome(container: HTMLElement, generation: number): Promise<void> {
    const selectedDate = this.selectedDate;
    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(selectedDate, 1);
    if (!this.isCurrentRender(container, generation)) return;
    const now = new Date();
    const schedule = this.buildSchedule(selectedDate, googleEvents);
    const sharedSettings = await this.sharedSettingsRepository.load();
    if (!this.isCurrentRender(container, generation)) return;

    renderHomeView(container, {
      app: this.context.app,
      selectedDate,
      schedule,
      overdue: selectedDate === isoDate(now) ? this.buildOverdue(now) : [],
      index: this.getIndex(),
      googleEvents,
      sharedSettings,
      now,
      titleForItem: item => this.titleForScheduleItem(item, googleEvents),
      canOpenItem: item => this.canOpenScheduleItem(item, googleEvents),
      onOpenItem: item => this.openScheduleItem(item, googleEvents),
      iconFactory: getIcon,
      onOpenOverdue: projection => this.openObjectDetail(projection.object),
      performOccurrenceAction: (item, action, options) =>
        this.context.plugin.performOccurrenceAction(item, action, options),
      performOccurrenceReschedule: (item, start, end) =>
        this.context.plugin.performOccurrenceReschedule(item, start, end),
      manualExecutionCapability: item =>
        this.context.plugin.getManualExecutionCapability(item),
      startManualExecution: item =>
        this.context.plugin.startManualExecution(item),
      onQuickAdd: type => new QuickAddModal(this.context, type).open(),
    });
  }

  private async renderPlanner(container: HTMLElement, generation: number): Promise<void> {
    const selectedDate = this.selectedDate;
    const plannerMode = this.plannerMode;
    const plannerDayLens = this.plannerDayLens;
    const title = document.createElement('h2');
    title.textContent = 'Planner';
    container.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'quartzo-planner-controls';
    const previous = document.createElement('button');
    previous.textContent = '‹';
    previous.setAttribute('aria-label', `Previous ${plannerMode}`);
    previous.title = `Previous ${plannerMode}`;
    previous.addEventListener('click', () => {
      if (this.plannerMode === 'month') {
        this.selectedDate = shiftLocalMonth(this.selectedDate, -1);
      } else {
        const step = this.plannerMode === 'week' ? -7 : -1;
        this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));
      }
      void this.render();
    });
    controls.appendChild(previous);

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.setAttribute('aria-label', 'Planner date');
    dateInput.value = selectedDate;
    dateInput.addEventListener('change', () => {
      this.selectedDate = dateInput.value || isoDate(new Date());
      void this.render();
    });
    controls.appendChild(dateInput);

    const next = document.createElement('button');
    next.textContent = '›';
    next.setAttribute('aria-label', `Next ${plannerMode}`);
    next.title = `Next ${plannerMode}`;
    next.addEventListener('click', () => {
      if (this.plannerMode === 'month') {
        this.selectedDate = shiftLocalMonth(this.selectedDate, 1);
      } else {
        const step = this.plannerMode === 'week' ? 7 : 1;
        this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));
      }
      void this.render();
    });
    controls.appendChild(next);

    for (const mode of ['day', 'week', 'month'] as const) {
      const button = document.createElement('button');
      button.textContent = labelForType(mode);
      if (mode === plannerMode) {
        button.classList.add('is-active');
        button.setAttribute('aria-pressed', 'true');
      }
      button.addEventListener('click', () => {
        this.plannerMode = mode;
        void this.render();
      });
      controls.appendChild(button);
    }
    container.appendChild(controls);

    const settings = await this.sharedSettingsRepository.load();
    if (!this.isCurrentRender(container, generation)) return;
    let googleEvents: GoogleCalendarProjection[] = [];
    let schedule = this.buildSchedule(selectedDate);
    const schedulesByDate = new Map<string, NormalizedSchedule>();

    if (plannerMode === 'day') {
      googleEvents = await this.context.plugin.listGoogleCalendarEvents(selectedDate, 1);
      if (!this.isCurrentRender(container, generation)) return;
      schedule = this.buildSchedule(selectedDate, googleEvents);
    } else if (plannerMode === 'week') {
      const dates = weekDates(selectedDate, settings?.startOfWeek ?? 1);
      const start = dates[0] ?? selectedDate;
      googleEvents = await this.context.plugin.listGoogleCalendarEvents(start, dates.length);
      if (!this.isCurrentRender(container, generation)) return;
      for (const date of dates) {
        schedulesByDate.set(date, this.buildSchedule(date, googleEvents));
      }
    } else {
      const dates = monthGridDates(selectedDate, settings?.startOfWeek ?? 1);
      const start = dates[0] ?? selectedDate;
      googleEvents = await this.context.plugin.listGoogleCalendarEvents(start, dates.length);
      if (!this.isCurrentRender(container, generation)) return;
      for (const date of dates) {
        schedulesByDate.set(date, this.buildSchedule(date, googleEvents));
      }
    }

    renderPlannerSurface(container, {
      app: this.context.app,
      mode: plannerMode,
      dayLens: plannerDayLens,
      selectedDate,
      now: new Date(),
      schedule,
      schedulesByDate,
      dailyPlanningState: this.context.plugin.getDailyPlanningState(selectedDate),
      sharedSettings: settings,
      titleForItem: item => this.titleForScheduleItem(item, googleEvents),
      canOpenItem: item => this.canOpenScheduleItem(item, googleEvents),
      onOpenItem: item => this.openScheduleItem(item, googleEvents),
      performOccurrenceAction: (item, action, options) =>
        this.context.plugin.performOccurrenceAction(item, action, options),
      performOccurrenceReschedule: (item, start, end) =>
        this.context.plugin.performOccurrenceReschedule(item, start, end),
      manualExecutionCapability: item =>
        this.context.plugin.getManualExecutionCapability(item),
      startManualExecution: item =>
        this.context.plugin.startManualExecution(item),
      onDayLensChange: lens => {
        this.plannerDayLens = lens;
        void this.render();
      },
      onSelectDate: date => {
        this.selectedDate = date;
        this.plannerMode = 'day';
        void this.render();
      },
    });
  }

  private async renderJournal(container: HTMLElement, generation: number): Promise<void> {
    const selectedDate = this.selectedDate;
    const title = document.createElement('h2');
    title.textContent = 'Journal';
    container.appendChild(title);

    const navigation = document.createElement('div');
    navigation.className = 'quartzo-journal-navigation';
    const previous = document.createElement('button');
    previous.textContent = '‹';
    previous.setAttribute('aria-label', 'Previous journal day');
    previous.title = 'Previous journal day';
    previous.addEventListener('click', () => {
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), -1));
      void this.render();
    });
    navigation.appendChild(previous);

    const date = document.createElement('input');
    date.type = 'date';
    date.setAttribute('aria-label', 'Journal date');
    date.value = selectedDate;
    date.addEventListener('change', () => {
      this.selectedDate = date.value || isoDate(new Date());
      void this.render();
    });
    navigation.appendChild(date);

    const today = document.createElement('button');
    today.textContent = 'Today';
    today.addEventListener('click', () => {
      this.selectedDate = isoDate(new Date());
      void this.render();
    });
    navigation.appendChild(today);

    const next = document.createElement('button');
    next.textContent = '›';
    next.setAttribute('aria-label', 'Next journal day');
    next.title = 'Next journal day';
    next.addEventListener('click', () => {
      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), 1));
      void this.render();
    });
    navigation.appendChild(next);
    container.appendChild(navigation);

    const quickActions = document.createElement('div');
    quickActions.className = 'quartzo-journal-actions';
    const addEntry = document.createElement('button');
    addEntry.textContent = '+ Entry';
    addEntry.addEventListener('click', () => new QuickAddModal(this.context, 'entry').open());
    quickActions.appendChild(addEntry);
    const addRecord = document.createElement('button');
    addRecord.textContent = '+ Record';
    addRecord.addEventListener('click', () => new QuickAddModal(this.context, 'tracker_record').open());
    quickActions.appendChild(addRecord);
    container.appendChild(quickActions);

    const now = new Date();
    const projection = projectJournalDay(
      this.getIndex(),
      selectedDate,
      selectedDate === isoDate(now) ? this.buildOverdue(now) : [],
    );

    const dailySection = document.createElement('section');
    const dailyHeading = document.createElement('h3');
    dailyHeading.textContent = 'Daily Note';
    dailySection.appendChild(dailyHeading);
    if (projection.dailyNotes.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No Daily Note exists for this date.';
      dailySection.appendChild(empty);
    } else {
      for (const note of projection.dailyNotes) {
        const row = document.createElement('div');
        row.className = 'quartzo-journal-daily-note';
        const label = document.createElement('span');
        label.textContent = String(note.frontmatter.title ?? note.path);
        row.appendChild(label);
        const open = document.createElement('button');
        open.textContent = 'Open Markdown';
        open.addEventListener('click', () => this.openMarkdown(note));
        row.appendChild(open);
        dailySection.appendChild(row);
      }
      const rawHint = document.createElement('small');
      rawHint.textContent = 'Daily Note stays raw/read-only in Companion V1.';
      dailySection.appendChild(rawHint);
    }
    container.appendChild(dailySection);

    const entriesSection = document.createElement('section');
    const entriesHeading = document.createElement('h3');
    entriesHeading.textContent = 'Entries';
    entriesSection.appendChild(entriesHeading);
    if (projection.entries.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No Journal Entries for this date.';
      entriesSection.appendChild(empty);
    } else {
      for (const entry of projection.entries) {
        const row = document.createElement('div');
        row.className = 'quartzo-journal-entry-row';
        this.renderObjectRow(row, entry);
        if (!this.context.plugin.settings.hideSensitivePreviews && !this.context.plugin.settings.hideJournalPreviewText) {
          const previewText = entry.body.trim().replace(/\s+/g, ' ').slice(0, 180);
          if (previewText) {
            const preview = document.createElement('p');
            preview.className = 'quartzo-journal-entry-preview';
            preview.textContent = previewText;
            row.appendChild(preview);
          }
        }
        entriesSection.appendChild(row);
      }
    }
    container.appendChild(entriesSection);

    const recordsSection = document.createElement('section');
    const recordsHeading = document.createElement('h3');
    recordsHeading.textContent = 'Tracking Records';
    recordsSection.appendChild(recordsHeading);
    if (projection.trackingRecords.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No Tracking Records for this date.';
      recordsSection.appendChild(empty);
    } else {
      for (const record of projection.trackingRecords) this.renderObjectRow(recordsSection, record);
    }
    container.appendChild(recordsSection);

    if (projection.moodEntryCount > 0) {
      const moods = document.createElement('section');
      const moodsHeading = document.createElement('h3');
      moodsHeading.textContent = 'Mood';
      moods.appendChild(moodsHeading);
      const summary = document.createElement('p');
      summary.textContent = String(projection.moodEntryCount) + ' mood ' + (projection.moodEntryCount === 1 ? 'entry' : 'entries') + ' stored in the Daily Note.';
      moods.appendChild(summary);
      container.appendChild(moods);
    }

    const overdue = document.createElement('section');
    const overdueHeading = document.createElement('h3');
    overdueHeading.textContent = 'Overdue';
    overdue.appendChild(overdueHeading);
    if (projection.overdue.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing overdue for today.';
      overdue.appendChild(empty);
    } else {
      for (const item of projection.overdue) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'quartzo-journal-overdue-row';
        row.textContent = String(item.object.frontmatter.title ?? item.object.id);
        row.addEventListener('click', () => this.openObjectDetail(item.object));
        overdue.appendChild(row);
      }
    }
    container.appendChild(overdue);

    const timeline = document.createElement('section');
    const timelineHeading = document.createElement('h3');
    timelineHeading.textContent = 'Timeline';
    timeline.appendChild(timelineHeading);
    const googleEvents = await this.context.plugin.listGoogleCalendarEvents(selectedDate, 1);
    if (!this.isCurrentRender(container, generation)) return;
    const schedule = this.buildSchedule(selectedDate, googleEvents);
    if (schedule.items.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing on the canonical Daily Schedule for this date.';
      timeline.appendChild(empty);
    } else {
      this.renderScheduleList(timeline, schedule.items, googleEvents);
    }
    container.appendChild(timeline);
  }

  private renderBrowse(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Browse';
    container.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'quartzo-browse-controls';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Filter Quartzo objects';
    input.setAttribute('aria-label', 'Filter Quartzo objects');
    input.className = 'quartzo-input';
    controls.appendChild(input);

    const appendOption = (select: HTMLSelectElement, value: string, label: string): void => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    };

    const filter = document.createElement('select');
    filter.className = 'quartzo-input';
    filter.setAttribute('aria-label', 'Filter by object type');
    appendOption(filter, '', 'All types');
    const available = queryVaultObjects(this.getIndex(), {
      archiveFilter: 'include_archived',
      conflictFilter: 'all',
      sort: 'type_asc',
    });
    for (const type of [...new Set(available.map(object => object.type))].sort()) {
      appendOption(filter, type, labelForType(type));
    }
    controls.appendChild(filter);

    const archiveFilter = document.createElement('select');
    archiveFilter.className = 'quartzo-input';
    archiveFilter.setAttribute('aria-label', 'Filter by archive status');
    appendOption(archiveFilter, 'active', 'Active');
    appendOption(archiveFilter, 'include_archived', 'Active + archived');
    appendOption(archiveFilter, 'archived_only', 'Archived only');
    controls.appendChild(archiveFilter);

    const conflictFilter = document.createElement('select');
    conflictFilter.className = 'quartzo-input';
    conflictFilter.setAttribute('aria-label', 'Filter by Object Identification status');
    appendOption(conflictFilter, 'all', 'All identification');
    appendOption(conflictFilter, 'clean', 'No conflicts');
    appendOption(conflictFilter, 'conflicts', 'Conflicts only');
    controls.appendChild(conflictFilter);

    const sort = document.createElement('select');
    sort.className = 'quartzo-input';
    sort.setAttribute('aria-label', 'Sort Quartzo objects');
    appendOption(sort, 'relevance', 'Best match');
    appendOption(sort, 'title_asc', 'Title A-Z');
    appendOption(sort, 'title_desc', 'Title Z-A');
    appendOption(sort, 'type_asc', 'Type A-Z');
    appendOption(sort, 'type_desc', 'Type Z-A');
    appendOption(sort, 'updated_desc', 'Updated newest');
    appendOption(sort, 'updated_asc', 'Updated oldest');
    appendOption(sort, 'created_desc', 'Created newest');
    appendOption(sort, 'created_asc', 'Created oldest');
    appendOption(sort, 'path_asc', 'Path A-Z');
    appendOption(sort, 'path_desc', 'Path Z-A');
    controls.appendChild(sort);
    container.appendChild(controls);

    const summary = document.createElement('p');
    summary.className = 'quartzo-browse-summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    container.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'quartzo-object-results';
    container.appendChild(list);

    const render = () => {
      list.replaceChildren();
      const visible = queryVaultObjects(this.getIndex(), {
        query: input.value,
        types: filter.value ? [filter.value] : undefined,
        archiveFilter: archiveFilter.value as ObjectQueryArchiveFilter,
        conflictFilter: conflictFilter.value as ObjectQueryConflictFilter,
        sort: sort.value as ObjectQuerySort,
      });
      summary.textContent = `${visible.length} ${visible.length === 1 ? 'object' : 'objects'}`;
      if (visible.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'quartzo-empty-state';
        empty.textContent = input.value.trim() ||
          filter.value ||
          archiveFilter.value !== 'active' ||
          conflictFilter.value !== 'all'
          ? 'No matching Quartzo objects.'
          : 'No Quartzo objects yet.';
        list.appendChild(empty);
        return;
      }
      for (const object of visible) this.renderObjectRow(list, object);
    };
    filter.addEventListener('change', render);
    archiveFilter.addEventListener('change', render);
    conflictFilter.addEventListener('change', render);
    sort.addEventListener('change', render);
    input.addEventListener('input', render);
    render();
  }

  private renderSearch(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Search';
    container.appendChild(title);
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search Quartzo objects';
    input.setAttribute('aria-label', 'Search Quartzo objects');
    input.className = 'quartzo-input';
    container.appendChild(input);
    const results = document.createElement('div');
    results.className = 'quartzo-object-results';
    container.appendChild(results);
    const renderResults = () => {
      results.replaceChildren();
      const query = input.value.trim();
      if (!query) {
        const hint = document.createElement('p');
        hint.className = 'quartzo-empty-state';
        hint.textContent = 'Search by title, ID, type, body or object metadata.';
        results.appendChild(hint);
        return;
      }
      const matches = queryVaultObjects(this.getIndex(), { query });
      if (matches.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'quartzo-empty-state';
        empty.textContent = 'No matching Quartzo objects.';
        results.appendChild(empty);
        return;
      }
      for (const object of matches) this.renderObjectRow(results, object);
    };
    input.addEventListener('input', renderResults);
    renderResults();
    input.focus();
  }

  private renderTypeConflicts(container: HTMLElement): void {
    const title = document.createElement('h2');
    title.textContent = 'Type Conflicts';
    container.appendChild(title);

    const conflicts = queryVaultObjects(this.getIndex(), {
      hasTypeConflict: true,
      includeArchived: true,
    });
    if (conflicts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'quartzo-empty-state';
      empty.textContent = 'No type conflicts.';
      container.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'quartzo-object-results';
    for (const object of conflicts) {
      const card = document.createElement('section');
      card.className = 'quartzo-conflict-card';
      const heading = document.createElement('h3');
      heading.textContent = String(object.frontmatter.title ?? object.id);
      card.appendChild(heading);

      const meta = document.createElement('p');
      meta.textContent = `${object.path} · Treated as ${labelForType(object.identification?.resolvedType ?? object.type)}`;
      card.appendChild(meta);

      const details = object.identification?.conflictDetails;
      const explanation = document.createElement('p');
      explanation.textContent = details?.explanation ?? 'This object matches incompatible Object Identification markers.';
      card.appendChild(explanation);

      const detected = document.createElement('ul');
      for (const match of object.identification?.matchedSignatures ?? []) {
        const item = document.createElement('li');
        item.textContent = `${match.source} -> ${labelForType(match.objectType)}`;
        detected.appendChild(item);
      }
      card.appendChild(detected);

      const actions = document.createElement('div');
      actions.className = 'qz-conflict-actions';
      const resolvedType = object.identification?.resolvedType ?? object.type;
      for (const match of object.identification?.matchedSignatures ?? []) {
        if (match.objectType === resolvedType) continue;
        if (match.markerType === 'folder') continue;
        const fix = document.createElement('button');
        fix.textContent = `Keep ${labelForType(resolvedType)} and remove ${match.markerType === 'tag' ? match.source.replace('Tag ', '') : match.source.replace('Property ', '')}`;
        fix.addEventListener('click', async () => {
          try {
            await this.context.plugin.resolveTypeConflictMarker(object, match);
            new Notice('Type conflict marker removed.');
            await this.render();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        });
        actions.appendChild(fix);
      }
      const openMarkdown = document.createElement('button');
      openMarkdown.textContent = 'Open Markdown';
      openMarkdown.addEventListener('click', () => this.openMarkdown(object));
      actions.appendChild(openMarkdown);
      card.appendChild(actions);
      list.appendChild(card);
    }
    container.appendChild(list);
  }

  private async renderSync(container: HTMLElement, conflictsOnly: boolean, generation: number): Promise<void> {
    const headerRow = document.createElement('div');
    headerRow.className = 'qz-section-header';
    const headerIcon = document.createElement('span');
    headerIcon.className = 'qz-section-header-icon';
    headerIcon.textContent = conflictsOnly ? '⚡' : '☁';
    const headerTitle = document.createElement('span');
    headerTitle.className = 'qz-section-header-title';
    headerTitle.textContent = conflictsOnly ? 'Conflicts' : 'Sync Center';
    headerRow.appendChild(headerIcon);
    headerRow.appendChild(headerTitle);
    container.appendChild(headerRow);

    const plugin = this.context.plugin;
    const coordinator = plugin.driveSyncCoordinator;
    const snapshot = coordinator ? await coordinator.getSyncStatusSnapshot() : null;
    if (!this.isCurrentRender(container, generation)) return;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const requiresAuth = plugin.authState === 'disconnected' || plugin.authState === 'authentication_required';
    const statusLabel = requiresAuth
      ? 'Authentication required'
      : offline
        ? 'Offline'
        : snapshot == null
          ? 'Error'
          : ({
              synced: 'Synced',
              local_changes: 'Local changes',
              syncing: 'Syncing…',
              conflict: 'Conflict',
              error: 'Error',
            } as const)[snapshot.status];
    const statusBadgeClass = requiresAuth || snapshot?.status === 'error'
      ? 'qz-badge qz-badge-error'
      : offline
        ? 'qz-badge qz-badge-warning'
        : snapshot?.status === 'synced'
          ? 'qz-badge qz-badge-success'
          : snapshot?.status === 'syncing'
            ? 'qz-badge qz-badge-info'
            : snapshot?.status === 'conflict'
              ? 'qz-badge qz-badge-warning'
              : 'qz-badge qz-badge-neutral';

    const summary = document.createElement('section');
    summary.className = 'quartzo-sync-summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');

    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;';
    const statusBadge = document.createElement('span');
    statusBadge.className = statusBadgeClass;
    statusBadge.textContent = statusLabel;
    statusRow.appendChild(statusBadge);
    const conflictCount = snapshot?.conflictCount ?? coordinator?.getConflicts().length ?? 0;
    if (conflictCount > 0) {
      const conflictBadge = document.createElement('span');
      conflictBadge.className = 'qz-badge qz-badge-warning';
      conflictBadge.textContent = `⚡ ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}`;
      statusRow.appendChild(conflictBadge);
    }
    const pendingCount = snapshot?.pendingLocalChanges ?? 0;
    if (pendingCount > 0) {
      const pendingBadge = document.createElement('span');
      pendingBadge.className = 'qz-badge qz-badge-neutral';
      pendingBadge.textContent = `${pendingCount} pending`;
      statusRow.appendChild(pendingBadge);
    }
    summary.appendChild(statusRow);

    const infoGrid = document.createElement('dl');
    infoGrid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:var(--qz-font-xs);margin-bottom:8px;';
    const infoRows: Array<[string, string]> = [
      ['Last sync', snapshot?.lastSuccessfulSyncAt ? new Date(snapshot.lastSuccessfulSyncAt).toLocaleString() : 'Never'],
      ['Sync mode', `Sync mode: ${plugin.settings.syncMode === 'automatic' ? 'Automatic' : 'Manual'}`],
      ['Drive vault', plugin.settings.googleDriveFolderName ?? 'Not paired'],
      ['Account', plugin.authState.replace(/_/g, ' ')],
      ['Version', plugin.manifest.version],
    ];
    for (const [key, value] of infoRows) {
      const dt = document.createElement('dt');
      dt.style.cssText = 'color:var(--qz-text-secondary);font-weight:600;';
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.style.cssText = 'margin:0;overflow-wrap:anywhere;';
      dd.textContent = key === 'Sync mode' ? value.replace('Sync mode: ', '') : value;
      infoGrid.appendChild(dt);
      infoGrid.appendChild(dd);
    }
    summary.appendChild(infoGrid);

    if (snapshot?.lastError) {
      const lastError = document.createElement('div');
      lastError.className = 'quartzo-warning-state';
      lastError.setAttribute('role', 'alert');
      const errBadge = document.createElement('span');
      errBadge.className = 'qz-badge qz-badge-error';
      errBadge.textContent = 'Error';
      lastError.appendChild(errBadge);
      const errMsg = document.createElement('span');
      errMsg.textContent = ` ${snapshot.lastError}`;
      lastError.appendChild(errMsg);
      summary.appendChild(lastError);
    }

    if (snapshot && snapshot.pendingDiagnostics.length > 0) {
      const pendingHeader = document.createElement('div');
      pendingHeader.className = 'qz-section-header';
      pendingHeader.style.marginTop = '12px';
      const pendingIcon = document.createElement('span');
      pendingIcon.className = 'qz-section-header-icon';
      pendingIcon.textContent = '📋';
      const pendingTitle = document.createElement('span');
      pendingTitle.className = 'qz-section-header-title';
      pendingTitle.textContent = `Pending (${snapshot.pendingDiagnostics.length})`;
      pendingHeader.appendChild(pendingIcon);
      pendingHeader.appendChild(pendingTitle);
      summary.appendChild(pendingHeader);

      const reasonBadgeClass: Record<SyncPendingDiagnostic['reason'], string> = {
        local_create: 'qz-badge qz-badge-info',
        local_modify: 'qz-badge qz-badge-info',
        pending_delete: 'qz-badge qz-badge-error',
        pending_rename: 'qz-badge qz-badge-neutral',
        adoption_required: 'qz-badge qz-badge-warning',
        conflict: 'qz-badge qz-badge-warning',
        quarantined_duplicate_identity: 'qz-badge qz-badge-error',
      };
      const pendingList = document.createElement('div');
      pendingList.className = 'quartzo-sync-pending-diagnostics';
      for (const diagnostic of snapshot.pendingDiagnostics) {
        const row = document.createElement('div');
        row.className = 'qz-diagnostic-row';
        const badge = document.createElement('span');
        badge.className = reasonBadgeClass[diagnostic.reason];
        badge.textContent = diagnostic.reason.replace(/_/g, ' ');
        const pathSpan = document.createElement('span');
        pathSpan.textContent = formatPendingDiagnostic(diagnostic).split(': ').slice(1).join(': ') || diagnostic.path;
        row.appendChild(badge);
        row.appendChild(pathSpan);
        pendingList.appendChild(row);
      }
      summary.appendChild(pendingList);
    }

    if (snapshot) {
      const copyDiagnostics = document.createElement('button');
      copyDiagnostics.className = 'qz-btn qz-btn-ghost qz-btn-sm';
      copyDiagnostics.style.marginTop = '8px';
      copyDiagnostics.textContent = '📋 Copy diagnostics';
      copyDiagnostics.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(formatSyncDiagnosticsText({
            statusLabel,
            snapshot,
            syncMode: plugin.settings.syncMode,
            driveVault: plugin.settings.googleDriveFolderName ?? 'Not paired',
            googleAccountStatus: plugin.authState.replace(/_/g, ' '),
            companionVersion: plugin.manifest.version,
          }));
          new Notice('Sync diagnostics copied.');
        } catch (error) {
          new Notice(`Could not copy sync diagnostics: ${error}`);
        }
      });
      summary.appendChild(copyDiagnostics);
    }

    let syncProgressLine: HTMLParagraphElement | null = null;
    const ensureSyncProgressLine = (): HTMLParagraphElement => {
      if (!syncProgressLine) {
        syncProgressLine = document.createElement('p');
        syncProgressLine.className = 'quartzo-sync-progress';
        syncProgressLine.style.cssText = 'font-weight: 600; word-break: break-word;';
        syncProgressLine.setAttribute('role', 'status');
        syncProgressLine.setAttribute('aria-live', 'polite');
        summary.appendChild(syncProgressLine);
      }
      return syncProgressLine;
    };
    if (snapshot?.status === 'syncing' && coordinator) {
      const progressLine = ensureSyncProgressLine();
      this.startSyncProgressTicker(progressLine, () => coordinator.getSyncProgress());
    }
    container.appendChild(summary);

    if (!conflictsOnly) {
      const localFirstNote = document.createElement('p');
      localFirstNote.className = 'quartzo-sync-note';
      localFirstNote.textContent = 'If this vault already lives in Google Drive Desktop, Companion can stay local-first; Drive pairing is optional for vaults that need Companion to reconcile with a Drive folder directly.';
      container.appendChild(localFirstNote);
    }

    if (requiresAuth) {
      const connect = document.createElement('button');
      const canReconnect = Boolean(plugin.settings.googleDriveFolderId);
      connect.className = 'qz-btn qz-btn-primary';
      connect.textContent = canReconnect ? '🔗 Reconnect Google' : '🔗 Connect Google Drive';
      connect.disabled = offline;
      if (offline) connect.title = 'Google Drive connection requires network access.';
      connect.addEventListener('click', async () => {
        if (canReconnect) await plugin.reconnectGoogle();
        else await plugin.startPairingFlow();
        await this.render();
      });
      container.appendChild(connect);
      return;
    }

    if (plugin.authState === 'authenticated_unpaired') {
      if (coordinator?.isPairingApplyInProgress()) {
        const progress = coordinator.getPairingApplyProgress();
        const active = document.createElement('p');
        active.textContent = 'Pairing is in progress. Keep Obsidian open.';
        container.appendChild(active);

        const detail = document.createElement('p');
        if (!progress) {
          detail.textContent = 'Preparing pairing…';
        } else if (progress.phase === 'revalidating_remote') {
          detail.textContent = 'Revalidating Google Drive vault…';
        } else if (progress.phase === 'baselining') {
          detail.textContent = progress.total > 0
            ? `Establishing baselines ${progress.completed}/${progress.total}`
            : 'Establishing baselines…';
        } else if (progress.phase === 'adopting_local') {
          detail.textContent = progress.total > 0
            ? `Uploading local-only files ${progress.completed}/${progress.total}`
            : 'Checking local-only files…';
        } else if (progress.phase === 'pulling_remote') {
          detail.textContent = progress.total > 0
            ? `Downloading remote-only files ${progress.completed}/${progress.total}`
            : 'Checking remote-only files…';
        } else {
          detail.textContent = 'Finalizing pairing…';
        }
        if (progress?.currentPath) detail.textContent += ` · ${progress.currentPath}`;
        container.appendChild(detail);

        const blocked = document.createElement('button');
        blocked.textContent = 'Pairing in progress…';
        blocked.disabled = true;
        blocked.title = 'Pairing is already running. Keep Obsidian open until it completes.';
        container.appendChild(blocked);
        return;
      }

      const lastPairingError = coordinator?.getPairingLastError() ?? null;
      if (lastPairingError) {
        const failed = document.createElement('p');
        failed.textContent = `Last pairing attempt failed: ${lastPairingError}`;
        failed.style.cssText = 'word-break: break-word;';
        container.appendChild(failed);

        const copyError = document.createElement('button');
        copyError.textContent = 'Copy last pairing error';
        copyError.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(lastPairingError);
            new Notice('Pairing error copied.');
          } catch (error) {
            new Notice(`Could not copy pairing error: ${error}`);
          }
        });
        container.appendChild(copyError);
      }

      const candidates = await plugin.driveAdapter?.listQuartzoVaultCandidates() ?? [];
      if (candidates.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No existing Quartzo vault was found.';
        container.appendChild(empty);

        const retry = document.createElement('button');
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => { void this.render(); });
        container.appendChild(retry);

        const cancelSetup = document.createElement('button');
        cancelSetup.textContent = 'Cancel setup';
        cancelSetup.addEventListener('click', async () => {
          await plugin.useWithoutSync();
          this.action = null;
          await this.render();
        });
        container.appendChild(cancelSetup);
        return;
      }
      for (const candidate of candidates) {
        const button = document.createElement('button');
        button.textContent = `Pair with ${candidate.name}`;
        button.addEventListener('click', async () => {
          const originalLabel = button.textContent || `Pair with ${candidate.name}`;
          button.disabled = true;
          button.textContent = 'Scanning vaults…';
          new Notice('Scanning local and Google Drive vaults for a safe pairing summary…');
          try {
            await plugin.confirmPairing(candidate.id, candidate.name, false, false, progress => {
              if (progress.phase === 'local_inventory') {
                button.textContent = 'Scanning local vault…';
              } else if (progress.phase === 'remote_inventory') {
                button.textContent = 'Listing Drive vault…';
              } else if (progress.phase === 'resolving_ambiguities') {
                button.textContent = progress.total > 0
                  ? `Hashing duplicates ${progress.completed}/${progress.total}…`
                  : 'Hashing duplicate candidates…';
              } else if (progress.total > 0) {
                button.textContent = `Comparing ${progress.completed}/${progress.total}…`;
              } else {
                button.textContent = 'Comparing vaults…';
              }
            });
          } catch (error) {
            new Notice(`Pairing scan failed: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            button.disabled = false;
            button.textContent = originalLabel;
            await this.render();
          }
        });
        container.appendChild(button);
      }
      return;
    }

    if (!conflictsOnly && coordinator) {
      const actions = document.createElement('div');
      actions.className = 'quartzo-sync-actions';
      actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-block:12px;';

      const isSyncing = offline || snapshot?.status === 'syncing';

      const sync = document.createElement('button');
      sync.className = 'qz-btn qz-btn-primary';
      sync.textContent = '☁ Sync now';
      sync.disabled = isSyncing;
      if (sync.disabled) sync.title = offline ? 'Sync requires network access.' : 'A sync operation is already running.';

      const full = document.createElement('button');
      full.className = 'qz-btn qz-btn-secondary';
      full.textContent = '🔄 Full reconciliation';
      full.disabled = isSyncing;
      if (full.disabled) full.title = offline ? 'Full reconciliation requires network access.' : 'A sync operation is already running.';

      const runWithVisibleProgress = async (
        operation: 'incremental' | 'full'
      ): Promise<void> => {
        sync.disabled = true;
        full.disabled = true;
        const progressLine = ensureSyncProgressLine();
        progressLine.textContent = operation === 'full'
          ? 'Starting full reconciliation…'
          : 'Starting sync…';

        this.startSyncProgressTicker(progressLine, () => coordinator.getSyncProgress());

        try {
          const onProgress = (progress: SyncProgress) => {
            if (!this.isCurrentRender(container, generation)) return;
            progressLine.textContent = formatSyncProgress(progress);
          };
          const result = operation === 'full'
            ? await coordinator.triggerFullReconciliation(onProgress)
            : await coordinator.triggerManualSync(onProgress);
          if (!this.isCurrentRender(container, generation)) return;
          if (result.errors.length > 0) {
            new Notice(result.errors[result.errors.length - 1]);
          } else if (operation === 'full') {
            new Notice(`Full reconciliation complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          } else {
            new Notice(`Sync complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          }
        } finally {
          this.stopSyncProgressTicker();
          if (this.isCurrentRender(container, generation)) {
            await this.render();
          }
        }
      };

      sync.addEventListener('click', () => { void runWithVisibleProgress('incremental'); });
      actions.appendChild(sync);

      full.addEventListener('click', () => { void runWithVisibleProgress('full'); });
      actions.appendChild(full);

      const ambiguityPaths = coordinator.getRemoteIdentityAmbiguityPaths();
      if (ambiguityPaths.length > 0) {
        const repairDuplicates = document.createElement('button');
        repairDuplicates.className = 'qz-btn qz-btn-secondary';
        repairDuplicates.textContent = `Review Drive duplicates (${ambiguityPaths.length})`;
        repairDuplicates.disabled = isSyncing;
        if (repairDuplicates.disabled) repairDuplicates.title = offline ? 'Duplicate review requires network access.' : 'Finish the active sync before reviewing duplicates.';
        repairDuplicates.addEventListener('click', async () => {
          await plugin.reviewSyncRemoteDuplicates();
          await this.render();
        });
        actions.appendChild(repairDuplicates);
      }

      const numConflicts = coordinator.getConflicts().length;
      if (numConflicts > 0) {
        const showConflicts = document.createElement('button');
        showConflicts.className = 'qz-btn qz-btn-secondary';
        showConflicts.textContent = `⚡ Conflicts (${numConflicts})`;
        showConflicts.addEventListener('click', () => { void this.handleAction('conflicts'); });
        actions.appendChild(showConflicts);
      }

      const reconnect = document.createElement('button');
      reconnect.className = 'qz-btn qz-btn-ghost qz-btn-sm';
      reconnect.textContent = 'Reconnect Google';
      reconnect.disabled = offline;
      if (offline) reconnect.title = 'Reconnect requires network access.';
      reconnect.addEventListener('click', async () => { await plugin.reconnectGoogle(); await this.render(); });
      actions.appendChild(reconnect);

      const disconnect = document.createElement('button');
      disconnect.className = 'qz-btn qz-btn-danger qz-btn-sm';
      disconnect.textContent = 'Disconnect';
      disconnect.addEventListener('click', async () => { await plugin.disconnectDrive(); await this.render(); });
      actions.appendChild(disconnect);
      container.appendChild(actions);
    }

    const conflicts = coordinator?.getConflicts() ?? [];
    if (conflicts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'qz-empty-state';
      const emptyIcon = document.createElement('div');
      emptyIcon.className = 'qz-empty-state-icon';
      emptyIcon.textContent = '✅';
      const emptyTitle = document.createElement('div');
      emptyTitle.className = 'qz-empty-state-title';
      emptyTitle.textContent = 'No conflicts';
      const emptyBody = document.createElement('div');
      emptyBody.className = 'qz-empty-state-body';
      emptyBody.textContent = 'All files are in sync between local vault and Google Drive.';
      empty.appendChild(emptyIcon);
      empty.appendChild(emptyTitle);
      empty.appendChild(emptyBody);
      container.appendChild(empty);
      return;
    }

    const conflictsHeader = document.createElement('div');
    conflictsHeader.className = 'qz-section-header';
    const conflictIcon = document.createElement('span');
    conflictIcon.className = 'qz-section-header-icon';
    conflictIcon.textContent = '⚡';
    const conflictTitle = document.createElement('span');
    conflictTitle.className = 'qz-section-header-title';
    conflictTitle.textContent = `Conflicts (${conflicts.length})`;
    conflictsHeader.appendChild(conflictIcon);
    conflictsHeader.appendChild(conflictTitle);
    container.appendChild(conflictsHeader);

    const decoder = new TextDecoder();
    for (const conflict of conflicts) {
      const card = document.createElement('section');
      card.className = 'quartzo-conflict-card';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'qz-conflict-header';
      const pathSpan = document.createElement('span');
      pathSpan.className = 'qz-conflict-path';
      pathSpan.textContent = conflict.originalPath;
      pathSpan.title = conflict.originalPath;
      cardHeader.appendChild(pathSpan);
      const newest = chooseNewestConflictResolution(conflict);
      const newestBadge = document.createElement('span');
      newestBadge.className = 'qz-badge qz-badge-neutral';
      newestBadge.textContent = newest === 'keep_local' ? '📱 Local newer' : newest === 'keep_drive' ? '☁ Drive newer' : '≡ Same age';
      cardHeader.appendChild(newestBadge);
      card.appendChild(cardHeader);

      const meta = document.createElement('p');
      meta.style.cssText = 'font-size:var(--qz-font-xs);color:var(--qz-text-secondary);margin-bottom:8px;';
      const localModified = conflict.localModifiedAt ? new Date(conflict.localModifiedAt).toLocaleString() : 'Unknown';
      const driveModified = conflict.remoteModifiedAt ? new Date(conflict.remoteModifiedAt).toLocaleString() : 'Unknown';
      meta.textContent = `Local: ${localModified}  ·  Drive: ${driveModified}  ·  Hashes: ${conflict.localSha256.slice(0, 8)}… vs ${conflict.remoteSha256.slice(0, 8)}…`;
      card.appendChild(meta);

      if (plugin.settings.hideSensitivePreviews) {
        const hidden = document.createElement('p');
        hidden.style.cssText = 'font-size:var(--qz-font-xs);color:var(--qz-text-secondary);';
        hidden.textContent = 'Content hidden by Privacy settings.';
        card.appendChild(hidden);
      } else if (conflict.isBinary) {
        const binary = document.createElement('p');
        binary.style.cssText = 'font-size:var(--qz-font-xs);';
        binary.textContent = `Binary file — Local: ${conflict.localContent.length} bytes · Drive: ${conflict.remoteContent.length} bytes`;
        card.appendChild(binary);
      } else {
        const localText = conflict.localExists ? decoder.decode(conflict.localContent) : '';
        const driveText = conflict.remoteExists ? decoder.decode(conflict.remoteContent) : '';
        const versions = document.createElement('div');
        versions.className = 'qz-conflict-versions';

        for (const [side, text, exists] of [
          ['📱 Local', localText, conflict.localExists],
          ['☁ Drive', driveText, conflict.remoteExists],
        ] as const) {
          const block = document.createElement('div');
          block.className = 'qz-conflict-version-block';
          const label = document.createElement('div');
          label.className = 'qz-conflict-version-label';
          label.textContent = side;
          block.appendChild(label);
          const pre = document.createElement('pre');
          pre.style.cssText = 'font-size:10px;overflow:auto;max-height:120px;margin:0;';
          pre.textContent = exists ? text.slice(0, 500) + (text.length > 500 ? '…' : '') : '(deleted)';
          block.appendChild(pre);
          versions.appendChild(block);
        }
        card.appendChild(versions);

        if (conflict.localExists && conflict.remoteExists) {
          const diff = buildConflictDiff(localText, driveText);
          if (diff != null) {
            const diffWrap = document.createElement('details');
            diffWrap.style.cssText = 'font-size:var(--qz-font-xs);';
            const diffSummary = document.createElement('summary');
            diffSummary.textContent = 'Show diff';
            diffSummary.style.cursor = 'pointer';
            diffWrap.appendChild(diffSummary);
            const diffView = document.createElement('pre');
            diffView.style.cssText = 'font-size:10px;overflow:auto;max-height:180px;margin-top:4px;';
            diffView.textContent = formatConflictDiff(diff);
            diffWrap.appendChild(diffView);
            card.appendChild(diffWrap);
          }
        }
      }

      const actionRow = document.createElement('div');
      actionRow.className = 'qz-conflict-actions';
      const resolutionChoices: Array<['keep_local' | 'keep_drive' | 'keep_newest', string, string]> = [
        ['keep_local', '📱 Keep local', 'qz-btn qz-btn-secondary'],
        ['keep_drive', '☁ Keep Drive', 'qz-btn qz-btn-secondary'],
        ['keep_newest', 'Keep newest', 'qz-btn qz-btn-primary'],
      ];
      for (const [resolution, label, cls] of resolutionChoices) {
        const button = document.createElement('button');
        button.className = cls;
        button.textContent = label;
        if (resolution === 'keep_newest' && newest == null) {
          button.disabled = true;
          button.title = 'Keep newest requires two distinct trustworthy modification times.';
        }
        button.addEventListener('click', async () => {
          try {
            await coordinator?.resolveConflict(conflict.originalPath, resolution);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
          await this.render();
        });
        actionRow.appendChild(button);
      }
      card.appendChild(actionRow);
      container.appendChild(card);
    }
  }

  private renderObjectRow(container: HTMLElement, object: IndexedObject): void {
    const row = document.createElement('button');
    row.className = 'quartzo-object-row';
    row.textContent = `${object.identification?.hasConflict ? '⚠ ' : ''}${String(object.frontmatter.title ?? 'Untitled')} · ${labelForType(object.type)}`;
    row.addEventListener('click', () => this.openObjectDetail(object));
    container.appendChild(row);
  }

  private openObjectDetail(object: IndexedObject): void {
    this.selectedObjectId = object.id;
    this.editingSelectedObject = false;
    void this.render();
  }

  private openMarkdown(object: IndexedObject): void {
    void this.context.app.workspace.openLinkText(object.path, '', true);
  }
}
