import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, ItemView, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';
import { VaultIndexEngine } from './vault/index';
import { DriveSyncCoordinator } from './sync/coordinator';
import { GoogleDriveAdapter } from './integrations/google/drive';
import { GoogleOAuthDesktop, OAuthConfig } from './integrations/google/auth/loopback';
import { HomeView, PlannerView, DayDialView, JournalView, BrowseView, SearchView, QuickAddView, ConflictCenterView } from './ui';
import { ViewContext } from './ui/types';
import { normalizeVaultPath } from './sync/coordinator/path-utils';
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

const OAUTH_CONFIG: OAuthConfig = {
  clientId: '',
  redirectUri: '',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token'
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

  private getSecretsPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const pluginDir = path.join(adapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id);
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }
      return path.join(pluginDir, 'secrets.json');
    }
    return '';
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
            const result = ObjectParser_parse(content);
            const object = result ? {
              id: result.id,
              type: result.type,
              path: file.path,
              frontmatter: result as Record<string, unknown>,
              body: result.body || ''
            } : undefined;
            this.vaultIndexEngine!.setIndex(
              VaultIndexEngine.updateIndex(idx, [{
                type: 'added',
                path: normalizeVaultPath(file.path),
                object
              }])
            );
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
            const result = ObjectParser_parse(content);
            const object = result ? {
              id: result.id,
              type: result.type,
              path: file.path,
              frontmatter: result as Record<string, unknown>,
              body: result.body || ''
            } : undefined;
            this.vaultIndexEngine!.setIndex(
              VaultIndexEngine.updateIndex(idx, [{
                type: 'modified',
                path: normalizeVaultPath(file.path),
                object
              }])
            );
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

    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile) => {
      if (file instanceof TFile && this.settings.syncAuto && this.settings.isPaired && this.driveSyncCoordinator) {
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

    const secrets = await this.loadSecrets();
    const refreshToken = secrets?.oauth_refresh_token;
    if (!refreshToken) {
      this.settings.isPaired = false;
      await this.saveSettings();
      new Notice('Session expired. Please reconnect Google Drive.');
      return;
    }

    try {
      const config = { ...OAUTH_CONFIG, clientId: this.settings.oauthClientId };
      const secretStorage = this.createSecretStorage();
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
    if (this.settings.oauthClientId === 'PLACEHOLDER_CLIENT_ID') {
      new Notice('Configure your Google OAuth Client ID in settings first.');
      return;
    }

    const config = { ...OAUTH_CONFIG, clientId: this.settings.oauthClientId };
    const secretStorage = this.createSecretStorage();
    this.oauthClient = new GoogleOAuthDesktop(config, secretStorage);

    try {
      const tokenResponse = await this.oauthClient.startAuthLoopback();
      this.driveAdapter?.setAccessToken(tokenResponse.access_token);

      this.driveAdapter?.setTokenRefreshCallback(async () => {
        try {
          const refreshed = await this.oauthClient?.refreshAccessToken();
          return refreshed?.access_token || null;
        } catch {
          return null;
        }
      });

      new Notice('Google Drive authenticated. Select your vault folder.');

      this.settings.firstRunCompleted = true;
      await this.saveSettings();

      if (this.driveAdapter && this.driveSyncCoordinator) {
        const folders = await this.driveAdapter.listRootFolders();
        if (folders.length > 0) {
          this.settings.googleDriveFolderId = folders[0].id;
          this.settings.googleDriveFolderName = folders[0].name;
          this.settings.isPaired = true;
          await this.saveSettings();
          await this.driveSyncCoordinator.setDriveFolderId(folders[0].id);
          new Notice(`Paired with folder: ${folders[0].name}`);
        } else {
          new Notice('No folders found in Google Drive. Please create a folder first.');
          return;
        }
      }

      this.startAutoSync();
    } catch (error) {
      new Notice(`Authentication failed: ${error}`);
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
    const state = this.driveSyncCoordinator.getSyncState();
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').replace(/^\//, '');
    const syncFile = state.files.get(normalizedPath);
    if (!syncFile) {
      new Notice('File not found in sync state.');
      return;
    }
    if (syncFile.remoteFileId) {
      new Notice('File already has a remote counterpart.');
      return;
    }
    try {
      await this.driveSyncCoordinator.triggerManualSync();
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

  private createSecretStorage() {
    return {
      get: async (key: string) => {
        const secrets = await this.loadSecrets();
        return secrets?.[key] || null;
      },
      set: async (key: string, value: string) => {
        const secrets = await this.loadSecrets() || {};
        secrets[key] = value;
        await this.saveSecrets(secrets);
      },
      delete: async (key: string) => {
        const secrets = await this.loadSecrets() || {};
        delete secrets[key];
        await this.saveSecrets(secrets);
      }
    };
  }

  private async loadSecrets(): Promise<Record<string, string> | null> {
    const secretsPath = this.getSecretsPath();
    if (!secretsPath) return null;
    try {
      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        const data = await adapter.read(secretsPath);
        return JSON.parse(data);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async saveSecrets(secrets: Record<string, string>): Promise<void> {
    const secretsPath = this.getSecretsPath();
    if (!secretsPath) return;
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      await adapter.write(secretsPath, JSON.stringify(secrets, null, 2));
    }
  }
}

function ObjectParser_parse(content: string): { id: string; type: string; body: string; [key: string]: unknown } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;
  try {
    const yaml = require('yaml');
    const parsed = yaml.parse(frontmatterMatch[1]);
    if (parsed && typeof parsed === 'object') {
      return { ...parsed, id: String(parsed.id || ''), type: String(parsed.type || 'unknown'), body: content.slice(frontmatterMatch[0].length).trim() };
    }
  } catch {}
  return null;
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
