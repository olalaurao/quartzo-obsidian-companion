import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VaultIndexEngine } from '../../vault/index';
import { ViewContext } from '../types';

export class BrowseView extends ItemView {
  private context: ViewContext;
  private vaultIndex: VaultIndexEngine | null = null;
  private currentFilter: string = 'all';

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
    this.vaultIndex = context.plugin.vaultIndexEngine || null;
  }

  getViewType() { return 'quartzo-browse-view'; }
  getDisplayText() { return 'Browse Objects'; }
  getIcon() { return 'folder'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-browse">
        <div class="browse-header">
          <h2>Browse Objects</h2>
          <div class="filter-controls">
            <select id="type-filter">
              <option value="all">All Types</option>
              <option value="task">Tasks</option>
              <option value="habit">Habits</option>
              <option value="reminder">Reminders</option>
              <option value="goal">Goals</option>
              <option value="entry">Journal Entries</option>
            </select>
            <input type="text" id="search-input" placeholder="Search objects...">
          </div>
        </div>
        <div id="objects-grid"></div>
      </div>
    `;
    
    this.setupEventListeners();
    this.renderObjects();
  }

  private setupEventListeners() {
    const typeFilter = this.contentEl.querySelector('#type-filter');
    const searchInput = this.contentEl.querySelector('#search-input');

    typeFilter?.addEventListener('change', (e) => {
      this.currentFilter = (e.target as HTMLSelectElement).value;
      this.renderObjects();
    });

    searchInput?.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value;
      this.renderObjects(query);
    });
  }

  private renderObjects(searchQuery: string = '') {
    const grid = this.contentEl.querySelector('#objects-grid');
    if (!grid || !this.vaultIndex) return;

    const index = this.vaultIndex.getIndex() || { files: new Map(), objects: new Map(), lastModified: 0 };
    let objects = Array.from(index.objects.values());

    if (this.currentFilter !== 'all') {
      objects = objects.filter(obj => obj.type === this.currentFilter);
    }

    if (searchQuery) {
      objects = VaultIndexEngine.searchObjects(index, searchQuery);
    }

    grid.innerHTML = objects.map(obj => `
      <div class="object-card" data-id="${obj.id}" data-type="${obj.type}">
        <div class="object-type">${obj.type}</div>
        <h3>${obj.frontmatter.title as string || 'Untitled'}</h3>
        <p class="object-path">${obj.path}</p>
      </div>
    `).join('');

    grid.querySelectorAll('.object-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        if (id) this.openObject(id);
      });
    });
  }

  private openObject(id: string) {
    if (this.vaultIndex) {
      const obj = VaultIndexEngine.getObject(
        this.vaultIndex.getIndex() || { files: new Map(), objects: new Map(), lastModified: 0 },
        id
      );
      if (obj && this.context.app.vault) {
        this.context.app.workspace.openLinkText(obj.path, '', true);
      }
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}