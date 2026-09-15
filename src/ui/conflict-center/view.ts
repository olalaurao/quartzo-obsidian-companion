import { ItemView, WorkspaceLeaf } from 'obsidian';
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
        <button id="scan-conflicts">Scan for Conflicts</button>
      </div>
    `;
    
    this.setupEventListeners();
    this.scanConflicts();
  }

  private setupEventListeners() {
    const scanBtn = this.contentEl.querySelector('#scan-conflicts');
    scanBtn?.addEventListener('click', () => this.scanConflicts());
  }

  private async scanConflicts() {
    const conflictList = this.contentEl.querySelector('#conflict-list');
    if (!conflictList) return;

    conflictList.innerHTML = '<p>Scanning for conflict files...</p>';

    if (!this.context.app.vault) {
      conflictList.innerHTML = '<p>Vault not available</p>';
      return;
    }

    const files = this.context.app.vault.getMarkdownFiles();
    const conflictFiles = files.filter((file: { path: string }) => file.path.endsWith('.conflict'));

    if (conflictFiles.length === 0) {
      conflictList.innerHTML = '<p>No conflicts found.</p>';
      return;
    }

    conflictList.innerHTML = conflictFiles.map((file: { path: string; name: string }) => `
      <div class="conflict-item" data-path="${file.path}">
        <h3>${file.name}</h3>
        <p class="conflict-path">${file.path}</p>
        <div class="conflict-actions">
          <button class="resolve-local" data-path="${file.path}">Keep Local</button>
          <button class="resolve-remote" data-path="${file.path}">Keep Remote</button>
          <button class="resolve-manual" data-path="${file.path}">Resolve Manually</button>
        </div>
      </div>
    `).join('');

    conflictList.querySelectorAll('.resolve-local').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path');
        if (path) this.resolveConflict(path, 'local');
      });
    });

    conflictList.querySelectorAll('.resolve-remote').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path');
        if (path) this.resolveConflict(path, 'remote');
      });
    });

    conflictList.querySelectorAll('.resolve-manual').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = (e.currentTarget as HTMLElement).getAttribute('data-path');
        if (path) this.resolveConflict(path, 'manual');
      });
    });
  }

  private async resolveConflict(conflictPath: string, resolution: 'local' | 'remote' | 'manual') {
    if (!this.context.app.vault) return;

    const originalPath = conflictPath.replace('.conflict', '');
    const conflictFile = this.context.app.vault.getAbstractFileByPath(conflictPath);

    if (!conflictFile) {
      console.error('Conflict file not found:', conflictPath);
      return;
    }

    try {
      const content = await this.context.app.vault.read(conflictFile as { path: string });
      
      switch (resolution) {
        case 'local':
          const localMatch = content.match(/## Local Version[\s\S]*?(?=## Remote Version|$)/);
          if (localMatch) {
            const localContent = localMatch[0].replace(/## Local Version[\s\S]*?\n\n/, '');
            await this.context.app.vault.create(originalPath, localContent);
          }
          break;
        case 'remote':
          const remoteMatch = content.match(/## Remote Version[\s\S]*?$/);
          if (remoteMatch) {
            const remoteContent = remoteMatch[0].replace(/## Remote Version[\s\S]*?\n\n/, '');
            await this.context.app.vault.create(originalPath, remoteContent);
          }
          break;
        case 'manual':
          this.context.app.workspace.openLinkText(conflictPath, '', true);
          return;
      }

      await this.context.app.vault.trash(conflictFile as { path: string });
      this.scanConflicts();
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}