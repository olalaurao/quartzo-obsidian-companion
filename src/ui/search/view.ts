import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VaultIndexEngine } from '../../vault/index';
import { ViewContext } from '../types';

export class SearchView extends ItemView {
  private context: ViewContext;
  private vaultIndex: VaultIndexEngine | null = null;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
    this.vaultIndex = context.plugin.vaultIndexEngine || null;
  }

  getViewType() { return 'quartzo-search-view'; }
  getDisplayText() { return 'Search'; }
  getIcon() { return 'search'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-search">
        <div class="search-header">
          <h2>Search Objects</h2>
          <input type="text" id="search-input" placeholder="Search by title, content, or tags..." autofocus>
        </div>
        <div id="search-results"></div>
      </div>
    `;
    
    this.setupEventListeners();
  }

  private setupEventListeners() {
    const searchInput = this.contentEl.querySelector('#search-input');
    searchInput?.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value;
      this.performSearch(query);
    });
  }

  private performSearch(query: string) {
    const resultsContainer = this.contentEl.querySelector('#search-results');
    if (!resultsContainer || !this.vaultIndex) return;

    if (!query.trim()) {
      resultsContainer.innerHTML = '<p class="no-results">Enter a search query to find objects.</p>';
      return;
    }

    const index = this.vaultIndex.getIndex() || { files: new Map(), objects: new Map(), lastModified: 0 };
    const results = VaultIndexEngine.searchObjects(index, query);

    if (results.length === 0) {
      resultsContainer.innerHTML = '<p class="no-results">No objects found matching your search.</p>';
      return;
    }

    resultsContainer.innerHTML = results.map(obj => `
      <div class="search-result" data-id="${obj.id}">
        <div class="result-type">${obj.type}</div>
        <h3>${obj.frontmatter.title as string || 'Untitled'}</h3>
        <p class="result-preview">${obj.body?.substring(0, 150) || ''}...</p>
        <p class="result-path">${obj.path}</p>
      </div>
    `).join('');

    resultsContainer.querySelectorAll('.search-result').forEach(result => {
      result.addEventListener('click', () => {
        const id = result.getAttribute('data-id');
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