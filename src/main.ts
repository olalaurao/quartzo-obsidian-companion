import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, ItemView, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';
import { VaultIndexEngine } from './vault/index';
import { DriveSyncCoordinator } from './sync/coordinator';
import { GoogleDriveAdapter } from './integrations/google/drive';
import { GoogleOAuthDesktop, OAuthConfig } from './integrations/google/auth/loopback';
import { HomeView, PlannerView, DayDialView, JournalView, BrowseView, SearchView, QuickAddView, ConflictCenterView } from './ui';
import { ViewContext } from './ui/types';
import { normalizeVaultPath } from './sync/coordinator/path-utils';
import { ObjectParser } from './core/objects';
import * as path from 'path';
import * as fs from 'fs';

interface QuartzoCompanionSettings {
  googleDriveFolderId: string | null;
  googleDriveFolderName: string | null;
  syncAuto: boolean;
  privacyMode: boolean;
  firstRunCompleted: boolean;
  oauthClientId: string;
  isPaired: boolean;
}

const DEFAULT_SETTINGS: QuartzoCompanionSettings = {
  googleDriveFolderId: null,
  googleDriveFolderName: null,
  syncAuto: false,
  privacyMode: false,
  firstRunCompleted: false,
  oauthClientId: 'PLACEHOLDER_CLIENT_ID',
  isPaired: false,
};

const HOME_VIEW_TYPE = 'quartzo-home-view';
const PLANNER_VIEW_TYPE = 'quartzo-planner-view';
const DAY_DIAL_VIEW_TYPE = 'quartzo-day-dial-view';
const JOURNAL_VIEW_TYPE = 'quartzo-journal-view';
const BROWSE_VIEW_TYPE = 'quartzo-browse-view';
const SEARCH_VIEW_TYPE = 'quartzo-search-view';
const QUICK_ADD_VIEW_TYPE = 'quartzo-quick-add-view';
const SYNC_CENTER_VIEW_TYPE = 'quartzo-sync-center-view';
const CONFLICT_CENTER_VIEW_TYPE = 'quartzo-conflict-center-view';

const BUILD_CLIENT_ID: string = (typeof process !== 'undefined' && process.env && process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID) || '';

const OAUTH_CONFIG: OAuthConfig = {
  clientId: '',
  redirectUri: '',
  scopes: ['https://www.googleapis.com/auth/drive'],
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token'
  // V1 decision: full Drive scope is required because the plugin uses Drive Changes API
  // (global to user's Drive) and must list folders for vault selection.
  // Narrow drive.file scope is insufficient without Google Picker integration.
  // Google verification/testing requirements apply before production listing.
};

class SyncCenterView extends ItemView {
  private context: ViewContext;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
  }

  getViewType() { return SYNC_CENTER_VIEW_TYPE; }
  getDisplayText() { return 'Sync Center'; }
  getIcon() { return 'sync'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-sync-center">
        <h2>Sync Center</h2>
        <p>Google Drive synchronization status</p>
        <div id="sync-controls"></div>
        <button id="sync-now-btn">Sync Now</button>
        <div id="sync-status"></div>
      </div>
    `;

    const controlsEl = this.contentEl.querySelector('#sync-controls');
    if (controlsEl) {
      if (!this.context.plugin.settings.isPaired) {
        controlsEl.innerHTML = `
          <button id="connect-google-drive">Connect Google Drive</button>
          <p>Connect your Google Drive to sync Quartzo vault.</p>
        `;
        controlsEl.querySelector('#connect-google-drive')?.addEventListener('click', () => {
          this.context.plugin.startPairingFlow();
        });

        if (this.context.plugin.driveAdapter) {
          const folders = await this.context.plugin.driveAdapter.listRootFolders().catch(() => []);
          if (folders.length > 0) {
            const selectHtml = `
              <div id="folder-selection" style="margin-top: 16px;">
                <label><strong>Select Quartzo vault folder:</strong></label>
                <div id="folder-list" style="margin-top: 8px;"></div>
                <button id="confirm-pairing-btn" style="margin-top: 8px; display: none;">Confirm Pairing</button>
              </div>
            `;
            controlsEl.insertAdjacentHTML('beforeend', selectHtml);
            const folderListEl = controlsEl.querySelector('#folder-list');
            const confirmBtn = controlsEl.querySelector('#confirm-pairing-btn') as HTMLButtonElement;
            let selectedFolderId: string | null = null;
            let selectedFolderName: string | null = null;

            if (folderListEl) {
              for (const folder of folders) {
                const itemEl = document.createElement('div');
                itemEl.className = 'folder-option';
                itemEl.textContent = folder.name;
                itemEl.style.cursor = 'pointer';
                itemEl.style.padding = '4px 8px';
                itemEl.style.borderRadius = '4px';
                itemEl.addEventListener('click', () => {
                  folderListEl.querySelectorAll('.folder-option').forEach(el => el.classList.remove('selected'));
                  itemEl.classList.add('selected');
                  itemEl.style.backgroundColor = 'var(--interactive-accent-hover)';
                  selectedFolderId = folder.id;
                  selectedFolderName = folder.name;
                  if (confirmBtn) confirmBtn.style.display = 'block';
                });
                folderListEl.appendChild(itemEl);
              }
            }

            if (confirmBtn) {
              confirmBtn.addEventListener('click', async () => {
                if (selectedFolderId && selectedFolderName) {
                  await this.context.plugin.confirmPairing(selectedFolderId, selectedFolderName, false, false);
                  this.onOpen();
                }
              });
            }
          }
        }
      } else {
        controlsEl.innerHTML = `
          <p>Connected to: ${this.context.plugin.settings.googleDriveFolderName || 'Google Drive'}</p>
          <button id="disconnect-btn">Disconnect</button>
        `;
        controlsEl.querySelector('#disconnect-btn')?.addEventListener('click', () => {
          this.context.plugin.disconnectDrive();
        });
      }
    }

    const syncBtn = this.contentEl.querySelector('#sync-now-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        if (this.context.plugin.driveSyncCoordinator) {
          try {
            const result = await this.context.plugin.driveSyncCoordinator.triggerManualSync();
            new Notice(`Sync complete: ${result.synced} files synced, ${result.conflicts} conflicts`);
          } catch (error) {
            new Notice(`Sync failed: ${error}`);
          }
        } else {
          new Notice('Sync not configured');
        }
      });
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}

export default class QuartzoCompanionPlugin extends Plugin {
  settings!: QuartzoCompanionSettings;
  vaultIndexEngine: VaultIndexEngine | null = null;
  driveSyncCoordinator: DriveSyncCoordinator | null = null;
  driveAdapter: GoogleDriveAdapter | null = null;
  oauthClient: GoogleOAuthDesktop | null = null;
  viewContext: ViewContext | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];

  async onload() {
    await this.loadSettings();

    this.vaultIndexEngine = new VaultIndexEngine();
    this.driveAdapter = new GoogleDriveAdapter();

    const vaultPath = this.getVaultFileSystemPath();
    const stateStorePath = this.getPluginDataPath();
    this.driveSyncCoordinator = new DriveSyncCoordinator(
      this.driveAdapter,
      vaultPath,
      stateStorePath
    );

    this.viewContext = {
      app: this.app,
      plugin: this,
      state: {
        currentView: HOME_VIEW_TYPE,
        dailyScheduleDate: new Date().toISOString().split('T')[0],
        privacyMode: this.settings.privacyMode
      },
      vaultIndexEngine: this.vaultIndexEngine,
      driveSyncCoordinator: this.driveSyncCoordinator
    };

    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this.viewContext!));
    this.registerView(PLANNER_VIEW_TYPE, (leaf) => new PlannerView(leaf, this.viewContext!));
    this.registerView(DAY_DIAL_VIEW_TYPE, (leaf) => new DayDialView(leaf, this.viewContext!));
    this.registerView(JOURNAL_VIEW_TYPE, (leaf) => new JournalView(leaf, this.viewContext!));
    this.registerView(BROWSE_VIEW_TYPE, (leaf) => new BrowseView(leaf, this.viewContext!));
    this.registerView(SEARCH_VIEW_TYPE, (leaf) => new SearchView(leaf, this.viewContext!));
    this.registerView(QUICK_ADD_VIEW_TYPE, (leaf) => new QuickAddView(leaf, this.viewContext!));
    this.registerView(SYNC_CENTER_VIEW_TYPE, (leaf) => new SyncCenterView(leaf, this.viewContext!));
    this.registerView(CONFLICT_CENTER_VIEW_TYPE, (leaf) => new ConflictCenterView(leaf, this.viewContext!));

    const ribbonIconEl = this.addRibbonIcon('calendar-clock', 'Open Quartzo', () => {
      this.activateView(HOME_VIEW_TYPE);
    });
    ribbonIconEl.addClass('quartzo-ribbon-icon');

    this.addCommand({ id: 'quartzo-open', name: 'Quartzo: Open Home', callback: () => this.activateView(HOME_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-planner', name: 'Quartzo: Open Planner', callback: () => this.activateView(PLANNER_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-day-dial', name: 'Quartzo: Open Day Dial', callback: () => this.activateView(DAY_DIAL_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-sync-center', name: 'Quartzo: Open Sync Center', callback: () => this.activateView(SYNC_CENTER_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-journal', name: 'Quartzo: Open Journal', callback: () => this.activateView(JOURNAL_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-browse', name: 'Quartzo: Browse Objects', callback: () => this.activateView(BROWSE_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-search', name: 'Quartzo: Search Objects', callback: () => this.activateView(SEARCH_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-quick-add', name: 'Quartzo: Quick Add', callback: () => this.activateView(QUICK_ADD_VIEW_TYPE) });
    this.addCommand({ id: 'quartzo-conflict-center', name: 'Quartzo: Open Conflict Center', callback: () => this.activateView(CONFLICT_CENTER_VIEW_TYPE) });
    this.addCommand({
      id: 'quartzo-sync-now',
      name: 'Quartzo: Sync now',
      callback: async () => {
        if (this.driveSyncCoordinator && this.settings.isPaired) {
          try {
            const result = await this.driveSyncCoordinator.triggerManualSync();
            new Notice(`Sync complete: ${result.synced} files synced, ${result.conflicts} conflicts`);
          } catch (error) {
            new Notice(`Sync failed: ${error}`);
          }
        }
      }
    });

    await this.initializeVaultIndex();
    this.registerVaultEvents();

    if (!this.settings.firstRunCompleted) {
      this.showFirstRunDialog();
    } else if (this.settings.isPaired) {
      await this.restoreSessionAndStartSync();
    }

    this.addSettingTab(new QuartzoSettingTab(this.app, this));
  }

  private getVaultFileSystemPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    throw new Error('Desktop-only: FileSystemAdapter required');
  }

  private getPluginDataPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const pluginDir = path.join(adapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id);
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }
      return path.join(pluginDir, 'quartzo-sync-state.json');
    }
    return '';
  }

  private getResolvedClientId(): string {
    return BUILD_CLIENT_ID || this.settings.oauthClientId || '';
  }

  private getSecretStorage() {
    const native = this.app.secretStorage;
    return {
      get: async (key: string) => native.getSecret(key),
      set: async (key: string, value: string) => { native.setSecret(key, value); },
      delete: async (key: string) => { native.setSecret(key, ''); }
    };
  }

  private async initializeVaultIndex() {
    if (!this.vaultIndexEngine) return;
    const files = this.app.vault.getMarkdownFiles();
    const vaultFiles = await Promise.all(files.map(async file => ({
      path: file.path,
      content: await this.app.vault.read(file),
      modified: file.stat.mtime,
      size: file.stat.size
    })));
    const index = VaultIndexEngine.createInitialIndex(vaultFiles);
    this.vaultIndexEngine.setIndex(index);
  }

  private registerVaultEvents() {
    const oncreate = this.app.vault.on('create', (file: TAbstractFile) => {
      if (file instanceof TFile && this.vaultIndexEngine) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.app.vault.read(file).then(content => {
            try {
              const result = ObjectParser.parse(content);
              const object = {
                id: result.object.id,
                type: result.object.type,
                path: file.path,
                frontmatter: result.object as Record<string, unknown>,
                body: (result.object as { body?: string }).body || ''
              };
              this.vaultIndexEngine!.setIndex(
                VaultIndexEngine.updateIndex(idx, [{
                  type: 'added',
                  path: normalizeVaultPath(file.path),
                  object
                }])
              );
            } catch { /* not a valid quartzo object */ }
          }).catch(() => {});
        }
      }
    });
    this.eventRefs.push(oncreate);

    const onmodify = this.app.vault.on('modify', (file: TAbstractFile) => {
      if (file instanceof TFile && this.vaultIndexEngine) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.app.vault.read(file).then(content => {
            try {
              const result = ObjectParser.parse(content);
              const object = {
                id: result.object.id,
                type: result.object.type,
                path: file.path,
                frontmatter: result.object as Record<string, unknown>,
                body: (result.object as { body?: string }).body || ''
              };
              this.vaultIndexEngine!.setIndex(
                VaultIndexEngine.updateIndex(idx, [{
                  type: 'modified',
                  path: normalizeVaultPath(file.path),
                  object
                }])
              );
            } catch { /* not a valid quartzo object */ }
          }).catch(() => {});
        }
      }
    });
    this.eventRefs.push(onmodify);

    const ondelete = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && this.vaultIndexEngine) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.vaultIndexEngine.setIndex(
            VaultIndexEngine.updateIndex(idx, [{
              type: 'deleted',
              path: normalizeVaultPath(file.path)
            }])
          );
        }
      }
    });
    this.eventRefs.push(ondelete);

    const onrename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile && this.vaultIndexEngine) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.vaultIndexEngine.setIndex(
            VaultIndexEngine.updateIndex(idx, [
              { type: 'deleted', path: normalizeVaultPath(oldPath) },
              { type: 'added', path: normalizeVaultPath(file.path) }
            ])
          );
        }
      }
    });
    this.eventRefs.push(onrename);

    const onchange = this.app.vault.on('create', () => {
      if (this.settings.syncAuto && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(onchange);

    const onmodifySync = this.app.vault.on('modify', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.syncAuto && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(onmodifySync);

    const ondeleteSync = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.syncAuto && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(ondeleteSync);

    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile && this.settings.syncAuto && this.settings.isPaired && this.driveSyncCoordinator) {
        this.driveSyncCoordinator.queueRename(oldPath, file.path);
        this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(onrenameSync);
  }

  startAutoSync() {
    if (this.syncIntervalId) return;
    if (!this.settings.syncAuto) return;
    this.syncIntervalId = setInterval(async () => {
      if (this.driveSyncCoordinator && this.settings.isPaired && this.settings.syncAuto) {
        try {
          await this.driveSyncCoordinator.triggerFocusSync();
        } catch (error) {
          console.error('Auto sync failed:', error);
        }
      }
    }, 60000);
  }

  stopAutoSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  private async restoreSessionAndStartSync() {
    if (!this.driveAdapter) return;

    const secretStorage = this.getSecretStorage();
    const refreshToken = await secretStorage.get('quartzo_companion/refresh_token');
    if (!refreshToken) {
      this.settings.isPaired = false;
      await this.saveSettings();
      new Notice('Session expired. Please reconnect Google Drive.');
      return;
    }

    try {
      const config = { ...OAUTH_CONFIG, clientId: this.getResolvedClientId() };
      this.oauthClient = new GoogleOAuthDesktop(config, secretStorage);
      const tokenResponse = await this.oauthClient.refreshAccessToken();
      this.driveAdapter.setAccessToken(tokenResponse.access_token);

      if (this.driveAdapter && this.settings.googleDriveFolderId) {
        await this.driveAdapter.setFolderId(this.settings.googleDriveFolderId);
        await this.driveSyncCoordinator?.setDriveFolderId(this.settings.googleDriveFolderId);
      }

      this.driveAdapter.setTokenRefreshCallback(async () => {
        try {
          const refreshed = await this.oauthClient?.refreshAccessToken();
          return refreshed?.access_token || null;
        } catch {
          return null;
        }
      });

      this.startAutoSync();
    } catch {
      this.settings.isPaired = false;
      await this.saveSettings();
      new Notice('Session expired. Please reconnect Google Drive.');
    }
  }

  async startPairingFlow() {
    const clientId = this.getResolvedClientId();
    if (!clientId || clientId === 'PLACEHOLDER_CLIENT_ID') {
      new Notice('Configure your Google OAuth Client ID in settings first.');
      return;
    }

    const config = { ...OAUTH_CONFIG, clientId };
    const secretStorage = this.getSecretStorage();
    this.oauthClient = new GoogleOAuthDesktop(config, secretStorage);

    try {
      const storedRefresh = await secretStorage.get('quartzo_companion/refresh_token');
      const forceConsent = !storedRefresh;
      const tokenResponse = await this.oauthClient.startAuthLoopback(forceConsent);
      this.driveAdapter?.setAccessToken(tokenResponse.access_token);

      if (!tokenResponse.refresh_token) {
        const storedRefresh = await secretStorage.get('quartzo_companion/refresh_token');
        if (!storedRefresh) {
          new Notice('No refresh token received. Please re-authorize with full access.');
          await this.oauthClient.disconnect();
          return;
        }
      }

      this.driveAdapter?.setTokenRefreshCallback(async () => {
        try {
          const refreshed = await this.oauthClient?.refreshAccessToken();
          return refreshed?.access_token || null;
        } catch {
          return null;
        }
      });

      this.settings.firstRunCompleted = true;
      await this.saveSettings();

      new Notice('Google Drive authenticated. Select your vault folder.');
    } catch (error) {
      new Notice(`Authentication failed: ${error}`);
    }
  }

  async confirmPairing(folderId: string, folderName: string, autoAdopt: boolean, autoPull: boolean): Promise<void> {
    if (!this.driveAdapter || !this.driveSyncCoordinator) {
      new Notice('Drive not initialized.');
      return;
    }

    await this.driveSyncCoordinator.setDriveFolderId(folderId);
    this.settings.googleDriveFolderId = folderId;
    this.settings.googleDriveFolderName = folderName;

    const summary = await this.driveSyncCoordinator.generatePairingSummary();
    const hasDivergent = summary.divergent.length > 0;

    if (hasDivergent) {
      new Notice(`Pairing blocked: ${summary.divergent.length} divergent file(s) require resolution.`);
      return;
    }

    if (autoAdopt || autoPull) {
      await this.driveSyncCoordinator.applyPairingDecisions(summary, { autoAdopt, autoPull });
      this.settings.isPaired = true;
      await this.saveSettings();
      new Notice(`Paired with folder: ${folderName}`);
      this.startAutoSync();
    } else {
      const modal = document.createElement('div');
      modal.className = 'quartzo-pairing-summary-modal';
      modal.innerHTML = `
        <div class="modal-content" style="padding: 20px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;">
          <h2>Pairing Summary</h2>
          <p>Folder: <strong>${folderName}</strong></p>
          <ul>
            <li>Identical files: ${summary.identical.length}</li>
            <li>Remote-only (to pull): ${summary.remoteOnly.length}</li>
            <li>Local-only (to adopt): ${summary.localOnly.length}</li>
          </ul>
          <p>Do you want to adopt local-only files and pull remote-only files?</p>
          <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;">
            <button id="pairing-cancel">Cancel</button>
            <button id="pairing-confirm">Accept & Pair</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#pairing-cancel')?.addEventListener('click', () => {
        modal.remove();
        new Notice('Pairing cancelled.');
      });

      modal.querySelector('#pairing-confirm')?.addEventListener('click', async () => {
        modal.remove();
        try {
          await this.driveSyncCoordinator!.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });
          this.settings.isPaired = true;
          await this.saveSettings();
          new Notice(`Paired with folder: ${folderName}`);
          this.startAutoSync();
        } catch (error) {
          new Notice(`Error applying pairing decisions: ${error}`);
        }
      });
    }
  }

  async disconnectDrive() {
    if (this.oauthClient) {
      await this.oauthClient.disconnect();
    }
    this.stopAutoSync();
    this.settings.isPaired = false;
    this.settings.googleDriveFolderId = null;
    this.settings.googleDriveFolderName = null;
    await this.saveSettings();
    new Notice('Google Drive disconnected.');
  }

  async adoptFile(filePath: string): Promise<void> {
    if (!this.driveSyncCoordinator || !this.settings.isPaired) {
      new Notice('Not connected to Google Drive.');
      return;
    }
    try {
      await this.driveSyncCoordinator.explicitAdopt(filePath);
      new Notice(`File adopted: ${filePath}`);
    } catch (error) {
      new Notice(`Adoption failed: ${error}`);
    }
  }

  async activateView(viewType: string) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      const newLeaf = workspace.getRightLeaf(false);
      if (!newLeaf) return;
      leaf = newLeaf;
    }
    await leaf.setViewState({ type: viewType, active: true });
    workspace.revealLeaf(leaf);
  }

  showFirstRunDialog() {
    const modal = document.createElement('div');
    modal.className = 'quartzo-first-run-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Welcome to Quartzo Companion</h2>
        <p>Set up your Google Drive sync to get started.</p>
        <button id="setup-later">Setup Later</button>
        <button id="setup-now">Setup Now</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#setup-later')?.addEventListener('click', () => {
      this.settings.firstRunCompleted = true;
      this.saveSettings();
      modal.remove();
    });
    modal.querySelector('#setup-now')?.addEventListener('click', () => {
      this.settings.firstRunCompleted = true;
      this.saveSettings();
      modal.remove();
      this.activateView(SYNC_CENTER_VIEW_TYPE);
    });
  }

  onunload() {
    this.stopAutoSync();
    this.oauthClient?.abort();
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class QuartzoSettingTab extends PluginSettingTab {
  plugin: QuartzoCompanionPlugin;

  constructor(app: App, plugin: QuartzoCompanionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Google OAuth Client ID')
      .setDesc('Desktop OAuth Client ID from Google Cloud Console (PKCE, no client secret)')
      .addText(text => text
        .setPlaceholder('Enter OAuth Client ID')
        .setValue(this.plugin.settings.oauthClientId)
        .onChange(async (value) => {
          this.plugin.settings.oauthClientId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Auto Sync')
      .setDesc('Enable automatic background synchronization with Google Drive')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncAuto)
        .onChange(async (value) => {
          this.plugin.settings.syncAuto = value;
          await this.plugin.saveSettings();
          if (value && this.plugin.settings.isPaired) {
            this.plugin.startAutoSync();
          } else {
            this.plugin.stopAutoSync();
          }
        }));

    new Setting(containerEl)
      .setName('Privacy Mode')
      .setDesc('Hide sensitive information in the UI')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.privacyMode)
        .onChange(async (value) => {
          this.plugin.settings.privacyMode = value;
          await this.plugin.saveSettings();
          if (this.plugin.viewContext) {
            this.plugin.viewContext.state.privacyMode = value;
          }
        }));
  }
}
