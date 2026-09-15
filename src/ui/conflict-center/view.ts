import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { DriveSyncCoordinator } from '../../sync/coordinator';
import { ViewContext } from '../types';

export class ConflictCenterView extends ItemView {
  private context: ViewContext;
  private syncCoordinator: DriveSyncCoordinator | null = null;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
    this.syncCoordinator = context.plugin.driveSyncCoordinator || null;
  }

  getViewType() { return 'quartzo-conflict-center-view'; }
  getDisplayText() { return 'Conflict Center'; }
  getIcon() { return 'alert-triangle'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-conflict-center">
        <h2>Conflict Center</h2>
        <div id="conflict-list"></div>
      </div>
    `;
    this.scanConflicts();
  }

  private async scanConflicts() {
    const conflictList = this.contentEl.querySelector('#conflict-list');
    if (!conflictList) return;

    if (!this.syncCoordinator) {
      conflictList.innerHTML = '<p>Sync not configured.</p>';
      return;
    }

    const conflicts = this.syncCoordinator.getConflicts();

    if (conflicts.length === 0) {
      conflictList.innerHTML = '<p>No conflicts found.</p>';
      return;
    }

    conflictList.innerHTML = conflicts.map(c => `
      <div class="conflict-item" data-path="${c.originalPath}">
        <h3>${c.originalPath.split('/').pop()}</h3>
        <p class="conflict-path">${c.originalPath}</p>
        <p class="conflict-type">${c.isBinary ? 'Binary' : 'Text'} conflict</p>
        <div class="conflict-actions">
          <button class="resolve-local" data-path="${c.originalPath}">Keep Local</button>
          <button class="resolve-drive" data-path="${c.originalPath}">Keep Drive</button>
        </div>
      </div>
    `).join('');

    conflictList.querySelectorAll('.resolve-local').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path');
        if (path) this.resolveConflict(path, 'keep_local');
      });
    });

    conflictList.querySelectorAll('.resolve-drive').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path');
        if (path) this.resolveConflict(path, 'keep_drive');
      });
    });
  }

  private async resolveConflict(conflictPath: string, resolution: 'keep_local' | 'keep_drive') {
    if (!this.syncCoordinator) return;

    try {
      await this.syncCoordinator.resolveConflict(conflictPath, resolution);
      new Notice(`Conflict resolved: ${resolution === 'keep_local' ? 'kept local' : 'kept Drive'}`);
      this.scanConflicts();
    } catch (error) {
      new Notice(`Failed to resolve conflict: ${error}`);
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}
