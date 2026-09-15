import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VaultIndexEngine } from '../../vault/index';
import { ViewContext } from '../types';

export class JournalView extends ItemView {
  private context: ViewContext;
  private vaultIndex: VaultIndexEngine | null = null;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
    this.vaultIndex = context.plugin.vaultIndexEngine || null;
  }

  getViewType() { return 'quartzo-journal-view'; }
  getDisplayText() { return 'Quartzo Journal'; }
  getIcon() { return 'book'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-journal">
        <div class="journal-header">
          <h2>Journal</h2>
          <button id="new-entry-btn">New Entry</button>
        </div>
        <div id="journal-entries"></div>
      </div>
    `;
    
    this.setupEventListeners();
    this.renderJournalEntries();
  }

  private setupEventListeners() {
    const newEntryBtn = this.contentEl.querySelector('#new-entry-btn');
    if (newEntryBtn) {
      newEntryBtn.addEventListener('click', () => this.createNewEntry());
    }
  }

  private async renderJournalEntries() {
    const entriesContainer = this.contentEl.querySelector('#journal-entries');
    if (!entriesContainer || !this.vaultIndex) return;

    const entries = VaultIndexEngine.getObjectsByType(
      this.vaultIndex.getIndex() || { files: new Map(), objects: new Map(), lastModified: 0 },
      'entry'
    );

    entriesContainer.innerHTML = entries.map(entry => `
      <div class="journal-entry" data-id="${entry.id}">
        <h3>${entry.frontmatter.title as string || 'Untitled'}</h3>
        <p class="entry-date">${entry.frontmatter.date as string || ''}</p>
        <p class="entry-preview">${entry.body?.substring(0, 100) || ''}...</p>
      </div>
    `).join('');

    entriesContainer.querySelectorAll('.journal-entry').forEach(entryEl => {
      entryEl.addEventListener('click', () => {
        const id = entryEl.getAttribute('data-id');
        if (id) this.openEntry(id);
      });
    });
  }

  private async createNewEntry() {
    const today = new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();
    
    const entryContent = `---
id: entry-${Date.now()}
type: entry
title: Journal Entry - ${today}
date: ${today}
time: ${timestamp.split('T')[1].substring(0, 5)}
---

Write your journal entry here...
`;

    const entryPath = `journal/${today}.md`;
    
    if (this.context.app.vault) {
      await this.context.app.vault.create(entryPath, entryContent);
      this.renderJournalEntries();
    }
  }

  private openEntry(id: string) {
    if (this.vaultIndex) {
      const entry = VaultIndexEngine.getObject(
        this.vaultIndex.getIndex() || { files: new Map(), objects: new Map(), lastModified: 0 },
        id
      );
      if (entry && this.context.app.vault) {
        this.context.app.workspace.openLinkText(entry.path, '', true);
      }
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}