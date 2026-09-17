import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';
import { VaultIndexEngine } from './vault/index';
import { DriveSyncCoordinator } from './sync/coordinator';
import { GoogleDriveAdapter } from './integrations/google/drive';
import { GoogleOAuthDesktop, OAuthConfig } from './integrations/google/auth/loopback';
import { QuartzoView, QUARTZO_VIEW_TYPE, type QuartzoSection, type QuartzoAction } from './ui';
import { ViewContext } from './ui/types';
import { localIsoDate } from './core/local-date';
import { normalizeVaultPath } from './sync/coordinator/path-utils';
import { VaultSyncFilePolicy } from './sync/coordinator/file-policy';
import { SHARED_SETTINGS_PATH, SharedSettingsRepository, parseObjectWithSharedSettings, type QuartzoSharedSettings } from './vault/shared-settings';
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

export default class QuartzoCompanionPlugin extends Plugin {
  settings!: QuartzoCompanionSettings;
  vaultIndexEngine: VaultIndexEngine | null = null;
  driveSyncCoordinator: DriveSyncCoordinator | null = null;
  driveAdapter: GoogleDriveAdapter | null = null;
  oauthClient: GoogleOAuthDesktop | null = null;
  viewContext: ViewContext | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];
  private sharedSettingsRepository: SharedSettingsRepository | null = null;
  private sharedSettings: QuartzoSharedSettings | null = null;
  authState: 'disconnected' | 'authenticating' | 'authenticated_unpaired' | 'paired' | 'authentication_required' = 'disconnected';

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
        currentView: 'home',
        dailyScheduleDate: localIsoDate(new Date()),
        privacyMode: this.settings.privacyMode
      },
      vaultIndexEngine: this.vaultIndexEngine,
      driveSyncCoordinator: this.driveSyncCoordinator
    };

    this.registerView(QUARTZO_VIEW_TYPE, (leaf) => new QuartzoView(leaf, this.viewContext!));

    const ribbonIconEl = this.addRibbonIcon('calendar-clock', 'Open Quartzo', () => {
      void this.activateQuartzo('home');
    });
    ribbonIconEl.addClass('quartzo-ribbon-icon');

    this.addCommand({ id: 'quartzo-open', name: 'Quartzo: Open', callback: () => { void this.activateQuartzo('home'); } });
    this.addCommand({ id: 'quartzo-planner', name: 'Quartzo: Planner', callback: () => { void this.activateQuartzo('planner'); } });
    this.addCommand({ id: 'quartzo-day-dial', name: 'Quartzo: Day Dial', callback: () => { void this.activateQuartzo('home'); } });
    this.addCommand({ id: 'quartzo-journal', name: 'Quartzo: Journal', callback: () => { void this.activateQuartzo('journal'); } });
    this.addCommand({ id: 'quartzo-browse', name: 'Quartzo: Browse', callback: () => { void this.activateQuartzo('browse'); } });
    this.addCommand({ id: 'quartzo-search', name: 'Quartzo: Search', callback: () => { void this.activateQuartzo('browse', 'search'); } });
    this.addCommand({ id: 'quartzo-quick-add', name: 'Quartzo: Quick Add', callback: () => { void this.activateQuartzo('home', 'add'); } });
    this.addCommand({ id: 'quartzo-sync-center', name: 'Quartzo: Sync', callback: () => { void this.activateQuartzo('home', 'sync'); } });
    this.addCommand({ id: 'quartzo-conflict-center', name: 'Quartzo: Conflicts', callback: () => { void this.activateQuartzo('home', 'conflicts'); } });
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

    this.sharedSettingsRepository = new SharedSettingsRepository(this.app.vault);
    this.sharedSettings = await this.sharedSettingsRepository.load();
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

  private shouldIndexPath(rawPath: string): boolean {
    const normalized = normalizeVaultPath(rawPath);
    if (normalized === '_deleted' || normalized.startsWith('_deleted/')) return false;
    return VaultSyncFilePolicy.shouldSyncFile(normalized);
  }

  private async initializeVaultIndex() {
    if (!this.vaultIndexEngine) return;
    const files = this.app.vault.getMarkdownFiles().filter(file => this.shouldIndexPath(file.path));
    const vaultFiles = await Promise.all(files.map(async file => ({
      path: file.path,
      content: await this.app.vault.read(file),
      modified: file.stat.mtime,
      size: file.stat.size
    })));
    const index = VaultIndexEngine.createInitialIndex(
      vaultFiles,
      (content, filePath) => parseObjectWithSharedSettings(content, filePath, this.sharedSettings),
    );
    this.vaultIndexEngine.setIndex(index);
  }

  private registerVaultEvents() {
    const oncreate = this.app.vault.on('create', (file: TAbstractFile) => {
      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }
      if (file instanceof TFile && this.vaultIndexEngine && this.shouldIndexPath(file.path)) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.app.vault.read(file).then(content => {
            try {
              const result = parseObjectWithSharedSettings(content, file.path, this.sharedSettings);
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
      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }
      if (file instanceof TFile && this.vaultIndexEngine && this.shouldIndexPath(file.path)) {
        const idx = this.vaultIndexEngine.getIndex();
        if (idx) {
          this.app.vault.read(file).then(content => {
            try {
              const result = parseObjectWithSharedSettings(content, file.path, this.sharedSettings);
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
      if (file instanceof TFile && this.vaultIndexEngine && this.shouldIndexPath(file.path)) {
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
      if (normalizeVaultPath(oldPath) === SHARED_SETTINGS_PATH || normalizeVaultPath(file.path) === SHARED_SETTINGS_PATH) { void this.reloadSharedSettingsAndIndex(); return; }
      if (!(file instanceof TFile) || !this.vaultIndexEngine) return;
      const idx = this.vaultIndexEngine.getIndex();
      if (!idx) return;
      const changes: Array<{ type: 'deleted'; path: string } | { type: 'added'; path: string; object: { id: string; type: string; path: string; frontmatter: Record<string, unknown>; body: string } }> = [];
      if (this.shouldIndexPath(oldPath)) changes.push({ type: 'deleted', path: normalizeVaultPath(oldPath) });
      if (!this.shouldIndexPath(file.path)) {
        if (changes.length > 0) this.vaultIndexEngine.setIndex(VaultIndexEngine.updateIndex(idx, changes));
        return;
      }
      this.app.vault.read(file).then(content => {
        try {
          const result = parseObjectWithSharedSettings(content, file.path, this.sharedSettings);
          changes.push({
            type: 'added',
            path: normalizeVaultPath(file.path),
            object: {
              id: result.object.id,
              type: result.object.type,
              path: file.path,
              frontmatter: result.object as Record<string, unknown>,
              body: (result.object as { body?: string }).body || ''
            }
          });
          this.vaultIndexEngine!.setIndex(VaultIndexEngine.updateIndex(idx, changes));
        } catch {
          if (changes.length > 0) this.vaultIndexEngine!.setIndex(VaultIndexEngine.updateIndex(idx, changes));
        }
      }).catch(() => {
        if (changes.length > 0) this.vaultIndexEngine!.setIndex(VaultIndexEngine.updateIndex(idx, changes));
      });
    });
    this.eventRefs.push(onrename);

    const onchange = this.app.vault.on('create', (file: TAbstractFile) => {
      if (file instanceof TFile && VaultSyncFilePolicy.shouldSyncFile(file.path) && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes))) return;
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onchange);

    const onmodifySync = this.app.vault.on('modify', (file: TAbstractFile) => {
      if (file instanceof TFile && VaultSyncFilePolicy.shouldSyncFile(file.path) && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes))) return;
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onmodifySync);

    const ondeleteSync = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && VaultSyncFilePolicy.shouldSyncFile(file.path) && this.settings.isPaired && this.driveSyncCoordinator) {
        if (this.driveSyncCoordinator.consumeExpectedWatcherEvent(file.path, null)) return;
        this.driveSyncCoordinator.queueDelete(file.path);
        if (this.settings.syncAuto) this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
      }
    });
    this.eventRefs.push(ondeleteSync);

    const onrenameSync = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile) || !this.settings.isPaired || !this.driveSyncCoordinator) return;
      const oldSyncable = VaultSyncFilePolicy.shouldSyncFile(oldPath);
      const newSyncable = VaultSyncFilePolicy.shouldSyncFile(file.path);
      if (!oldSyncable && !newSyncable) return;

      if (oldSyncable && !newSyncable) {
        if (this.driveSyncCoordinator.consumeExpectedWatcherEvent(oldPath, null)) return;
        this.driveSyncCoordinator.queueDelete(oldPath);
        if (this.settings.syncAuto) this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
        return;
      }

      this.app.vault.readBinary(file).then(bytes => {
        const content = new Uint8Array(bytes);
        if (!oldSyncable && newSyncable) {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, content)) return;
          if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
          return;
        }
        const oldSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(oldPath, null) ?? false;
        const newSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, content) ?? false;
        if (oldSuppressed && newSuppressed) return;
        this.driveSyncCoordinator?.queueRename(oldPath, file.path);
        if (this.settings.syncAuto) this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
      }).catch(() => {});
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
      this.authState = 'authentication_required';
      new Notice('Session expired. Please reconnect Google Drive.');
      return;
    }

    try {
      const config = { ...OAUTH_CONFIG, clientId: this.getResolvedClientId() };
      this.oauthClient = new GoogleOAuthDesktop(config, secretStorage);
      const tokenResponse = await this.oauthClient.refreshAccessToken();
      this.driveAdapter.setAccessToken(tokenResponse.access_token);
      this.authState = this.settings.isPaired ? 'paired' : 'authenticated_unpaired';

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
      this.authState = 'disconnected';
      new Notice('Configure your Google OAuth Client ID in settings first.');
      return;
    }

    this.authState = 'authenticating';
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
          this.driveAdapter?.setAccessToken('');
          this.authState = 'disconnected';
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

      this.authState = 'authenticated_unpaired';
      new Notice('Google Drive authenticated. Select your vault folder.');
    } catch (error) {
      this.authState = 'disconnected';
      new Notice(`Authentication failed: ${error}`);
    }
  }

  async confirmPairing(folderId: string, folderName: string, autoAdopt: boolean, autoPull: boolean): Promise<void> {
    if (!this.driveAdapter || !this.driveSyncCoordinator) {
      new Notice('Drive not initialized.');
      return;
    }

    const candidates = await this.driveAdapter.listQuartzoVaultCandidates();
    const selected = candidates.find(candidate => candidate.id === folderId);
    if (!selected) {
      new Notice('Pairing blocked: the selected folder is no longer a valid Quartzo vault.');
      return;
    }

    await this.driveSyncCoordinator.setDriveFolderId(folderId);
    this.settings.googleDriveFolderId = folderId;
    this.settings.googleDriveFolderName = selected.name || folderName;

    const summary = await this.driveSyncCoordinator.generatePairingSummary();
    const hasDivergent = summary.divergent.length > 0;
    const hasAmbiguous = summary.ambiguous.length > 0;

    if (hasDivergent || hasAmbiguous) {
      new Notice(`Pairing blocked: ${summary.divergent.length} divergent and ${summary.ambiguous.length} ambiguous file(s) require resolution.`);
      return;
    }

    if (autoAdopt || autoPull) {
      const pairingResult = await this.driveSyncCoordinator.applyPairingDecisions(summary, { autoAdopt, autoPull });
      if (pairingResult.errors.length > 0) {
        new Notice(`Pairing incomplete: ${pairingResult.errors.join('; ')}`);
        return;
      }
      this.settings.isPaired = true;
      this.settings.firstRunCompleted = true;
      this.authState = 'paired';
      await this.saveSettings();
      new Notice(`Paired with folder: ${folderName}`);
      this.startAutoSync();
    } else {
      const modal = document.createElement('div');
      modal.className = 'quartzo-pairing-summary-modal';
      const modalContent = document.createElement('div');
      modalContent.className = 'modal-content';
      modalContent.style.cssText = 'padding: 20px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;';
      const modalTitle = document.createElement('h2');
      modalTitle.textContent = 'Pairing Summary';
      modalContent.appendChild(modalTitle);
      const folder = document.createElement('p');
      folder.textContent = `Folder: ${folderName}`;
      modalContent.appendChild(folder);
      const counts = document.createElement('ul');
      for (const text of [
        `Identical files: ${summary.identical.length}`,
        `Remote-only (to pull): ${summary.remoteOnly.length}`,
        `Local-only (to adopt): ${summary.localOnly.length}`,
        `Ambiguous (blocked): ${summary.ambiguous.length}`,
      ]) {
        const item = document.createElement('li');
        item.textContent = text;
        counts.appendChild(item);
      }
      modalContent.appendChild(counts);
      const question = document.createElement('p');
      question.textContent = 'Do you want to adopt local-only files and pull remote-only files?';
      modalContent.appendChild(question);
      const actions = document.createElement('div');
      actions.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;';
      const cancelButton = document.createElement('button');
      cancelButton.id = 'pairing-cancel';
      cancelButton.textContent = 'Cancel';
      actions.appendChild(cancelButton);
      const confirmButton = document.createElement('button');
      confirmButton.id = 'pairing-confirm';
      confirmButton.textContent = 'Accept & Pair';
      actions.appendChild(confirmButton);
      modalContent.appendChild(actions);
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      modal.querySelector('#pairing-cancel')?.addEventListener('click', () => {
        modal.remove();
        new Notice('Pairing cancelled.');
      });

      modal.querySelector('#pairing-confirm')?.addEventListener('click', async () => {
        modal.remove();
        try {
          const pairingResult = await this.driveSyncCoordinator!.applyPairingDecisions(summary, { autoAdopt: true, autoPull: true });
          if (pairingResult.errors.length > 0) {
            new Notice(`Pairing incomplete: ${pairingResult.errors.join('; ')}`);
            return;
          }
          this.settings.isPaired = true;
          this.settings.firstRunCompleted = true;
          this.authState = 'paired';
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
    this.authState = 'disconnected';
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

  async activateQuartzo(section: QuartzoSection = 'home', action?: QuartzoAction) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (!leaf) {
      const newLeaf = workspace.getRightLeaf(false);
      if (!newLeaf) return;
      leaf = newLeaf;
    }
    await leaf.setViewState({ type: QUARTZO_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
    if (leaf.view instanceof QuartzoView) {
      await leaf.view.setSection(section);
      if (action) await leaf.view.handleAction(action);
    }
  }

  openSettings(): void {
    const appWithSettings = this.app as App & { setting?: { open(): void; openTabById(id: string): void } };
    appWithSettings.setting?.open();
    appWithSettings.setting?.openTabById(this.manifest.id);
  }

  private async reloadSharedSettingsAndIndex(): Promise<void> {
    this.sharedSettings = await this.sharedSettingsRepository?.load() ?? null;
    await this.initializeVaultIndex();
    const leaf = this.app.workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (leaf?.view instanceof QuartzoView) await leaf.view.refresh();
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
      void this.activateQuartzo('home', 'sync');
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
