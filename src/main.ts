import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, ItemView } from 'obsidian';
import { DailyScheduleEngine } from './core/daily_schedule';
import { VaultIndexEngine } from './vault/index';
import { DriveSyncCoordinator } from './sync/coordinator';
import { GoogleDriveAdapter } from './integrations/google/drive';
import { HomeView, PlannerView, DayDialView } from './ui';
import { ViewContext } from './ui/types';

interface QuartzoCompanionSettings {
  googleDriveFolderId: string | null;
  syncAuto: boolean;
  privacyMode: boolean;
  firstRunCompleted: boolean;
}

const DEFAULT_SETTINGS: QuartzoCompanionSettings = {
  googleDriveFolderId: null,
  syncAuto: false,
  privacyMode: false,
  firstRunCompleted: false,
}

const HOME_VIEW_TYPE = 'quartzo-home-view';
const PLANNER_VIEW_TYPE = 'quartzo-planner-view';
const DAY_DIAL_VIEW_TYPE = 'quartzo-day-dial-view';
const SYNC_CENTER_VIEW_TYPE = 'quartzo-sync-center-view';

class SyncCenterView extends ItemView {
  getViewType() { return SYNC_CENTER_VIEW_TYPE; }
  getDisplayText() { return 'Sync Center'; }
  getIcon() { return 'sync'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-sync-center">
        <h2>Sync Center</h2>
        <p>Google Drive synchronization status</p>
        <button id="sync-now-btn">Sync Now</button>
        <div id="sync-status"></div>
      </div>
    `;
    
    const syncBtn = this.contentEl.querySelector('#sync-now-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        new Notice('Sync triggered (mock)');
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
  viewContext: ViewContext | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize vault runtime
    this.vaultIndexEngine = new VaultIndexEngine();
    
    // Initialize Drive adapter (will be connected when OAuth is configured)
    this.driveAdapter = new GoogleDriveAdapter();
    
    // Initialize sync coordinator
    this.driveSyncCoordinator = new DriveSyncCoordinator(
      this.driveAdapter,
      this.app.vault.adapter.getResourcePath('')
    );

    // Create view context
    this.viewContext = {
      app: this.app,
      plugin: this,
      state: {
        currentView: HOME_VIEW_TYPE,
        dailyScheduleDate: new Date().toISOString().split('T')[0],
        privacyMode: this.settings.privacyMode
      }
    };

    // Register views using canonical UI layer
    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this.viewContext!));
    this.registerView(PLANNER_VIEW_TYPE, (leaf) => new PlannerView(leaf, this.viewContext!));
    this.registerView(DAY_DIAL_VIEW_TYPE, (leaf) => new DayDialView(leaf, this.viewContext!));
    this.registerView(SYNC_CENTER_VIEW_TYPE, (leaf) => new SyncCenterView(leaf));

    // Register ribbon icon
    const ribbonIconEl = this.addRibbonIcon('calendar-clock', 'Open Quartzo', () => {
      this.activateView(HOME_VIEW_TYPE);
    });
    ribbonIconEl.addClass('quartzo-ribbon-icon');

    // Register commands
    this.addCommand({
      id: 'quartzo-open',
      name: 'Quartzo: Open Home',
      callback: () => this.activateView(HOME_VIEW_TYPE)
    });

    this.addCommand({
      id: 'quartzo-planner',
      name: 'Quartzo: Open Planner',
      callback: () => this.activateView(PLANNER_VIEW_TYPE)
    });

    this.addCommand({
      id: 'quartzo-day-dial',
      name: 'Quartzo: Open Day Dial',
      callback: () => this.activateView(DAY_DIAL_VIEW_TYPE)
    });

    this.addCommand({
      id: 'quartzo-sync-center',
      name: 'Quartzo: Open Sync Center',
      callback: () => this.activateView(SYNC_CENTER_VIEW_TYPE)
    });

    this.addCommand({
      id: 'quartzo-sync-now',
      name: 'Quartzo: Sync now',
      callback: async () => {
        if (this.driveSyncCoordinator) {
          try {
            const result = await this.driveSyncCoordinator.reconcile();
            new Notice(`Sync complete: ${result.synced} files synced, ${result.conflicts} conflicts`);
            if (result.errors.length > 0) {
              console.error('Sync errors:', result.errors);
            }
          } catch (error) {
            new Notice(`Sync failed: ${error}`);
          }
        }
      }
    });

    // Initialize vault index
    await this.initializeVaultIndex();

    // Show first-run pairing if needed
    if (!this.settings.firstRunCompleted) {
      this.showFirstRunDialog();
    }

    // Settings tab
    this.addSettingTab(new QuartzoSettingTab(this.app, this));
  }

  private async initializeVaultIndex() {
    if (!this.vaultIndexEngine) return;

    // Scan vault files
    const files = this.app.vault.getMarkdownFiles();
    const vaultFiles = await Promise.all(files.map(async file => ({
      path: file.path,
      content: await this.app.vault.read(file),
      modified: file.stat.mtime,
      size: file.stat.size
    })));

    // Create initial index
    const index = VaultIndexEngine.createInitialIndex(vaultFiles);
    console.log('Vault index initialized with', index.objects.size, 'objects');
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
    console.log('Quartzo Companion unloaded');
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
    const {containerEl} = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Google Drive Folder ID')
      .setDesc('Folder ID for Google Drive synchronization')
      .addText(text => text
        .setPlaceholder('Enter folder ID')
        .setValue(this.plugin.settings.googleDriveFolderId || '')
        .onChange(async (value) => {
          this.plugin.settings.googleDriveFolderId = value || null;
          await this.plugin.saveSettings();
          if (this.plugin.driveSyncCoordinator) {
            await this.plugin.driveSyncCoordinator.setDriveFolderId(value || '');
          }
        }));

    new Setting(containerEl)
      .setName('Auto Sync')
      .setDesc('Enable automatic background synchronization with Google Drive')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncAuto)
        .onChange(async (value) => {
          this.plugin.settings.syncAuto = value;
          await this.plugin.saveSettings();
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
