import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';
import { VaultIndexEngine } from './vault/index';
import { DriveSyncCoordinator } from './sync/coordinator';
import { GoogleDriveAdapter } from './integrations/google/drive';
import { GoogleCalendarAdapter, GoogleCalendarAuthorizationError, type GoogleCalendarProjection } from './integrations/google/calendar';
import { GoogleOAuthDesktop, type OAuthConfig } from './integrations/google/auth/loopback';
import { GOOGLE_COMPANION_SCOPES } from './integrations/google/auth/scopes';
import { QuartzoView, QUARTZO_VIEW_TYPE, type QuartzoSection, type QuartzoAction } from './ui';
import { ViewContext } from './ui/types';
import { addLocalDays, localIsoDate, parseLocalIsoDate } from './core/local-date';
import { ReminderService, type ReminderMode, type ReminderSourceObject } from './core/reminders';
import { FileNotificationDeliveryRegistry } from './local-state/notification-delivery-registry';
import { ObsidianReminderDeliveryGateway } from './platform/notifications';
import { ElectronBrowserOpener } from './platform/browser-opener';
import { GOOGLE_OAUTH_CLIENT_SECRET_ID, GOOGLE_REFRESH_TOKEN_SECRET_ID } from './platform/secret-ids';
import { normalizeVaultPath } from './sync/coordinator/path-utils';
import { VaultSyncFilePolicy } from './sync/coordinator/file-policy';
import { SHARED_SETTINGS_PATH, SharedSettingsRepository, parseObjectWithSharedSettings, type QuartzoSharedSettings } from './vault/shared-settings';
import * as path from 'path';
import * as fs from 'fs';

type GoogleCalendarStatus = 'disconnected' | 'ready' | 'authorization_required' | 'error';
type SyncMode = 'manual' | 'automatic';

interface CalendarCacheEntry {
  expiresAt: number;
  events: GoogleCalendarProjection[];
}

interface QuartzoCompanionSettings {
  googleDriveFolderId: string | null;
  googleDriveFolderName: string | null;
  syncMode: SyncMode;
  syncPollingIntervalSeconds: number;
  hideSensitivePreviews: boolean;
  hideJournalPreviewText: boolean;
  hideNotificationBody: boolean;
  firstRunCompleted: boolean;
  oauthClientId: string;
  isPaired: boolean;
  reminderDelivery: ReminderMode;
}

const DEFAULT_SETTINGS: QuartzoCompanionSettings = {
  googleDriveFolderId: null,
  googleDriveFolderName: null,
  syncMode: 'manual',
  syncPollingIntervalSeconds: 60,
  hideSensitivePreviews: false,
  hideJournalPreviewText: false,
  hideNotificationBody: false,
  firstRunCompleted: false,
  oauthClientId: 'PLACEHOLDER_CLIENT_ID',
  isPaired: false,
  reminderDelivery: 'in_obsidian_only',
};


const BUILD_CLIENT_ID: string = (typeof process !== 'undefined' && process.env && process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID) || '';
const BUILD_CLIENT_SECRET: string = (typeof process !== 'undefined' && process.env && process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET) || '';

const OAUTH_CONFIG: OAuthConfig = {
  clientId: '',
  clientSecret: '',
  redirectUri: '',
  scopes: [...GOOGLE_COMPANION_SCOPES],
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
  googleCalendarAdapter: GoogleCalendarAdapter | null = null;
  oauthClient: GoogleOAuthDesktop | null = null;
  reminderService: ReminderService | null = null;
  reminderDeliveryGateway: ObsidianReminderDeliveryGateway | null = null;
  viewContext: ViewContext | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];
  private sharedSettingsRepository: SharedSettingsRepository | null = null;
  private sharedSettings: QuartzoSharedSettings | null = null;
  private googleAccessRefreshInFlight: Promise<string | null> | null = null;
  private readonly calendarCache = new Map<string, CalendarCacheEntry>();
  private readonly browserOpener = new ElectronBrowserOpener();
  calendarStatus: GoogleCalendarStatus = 'disconnected';
  authState: 'disconnected' | 'authenticating' | 'authenticated_unpaired' | 'paired' | 'authentication_required' = 'disconnected';

  async onload() {
    await this.loadSettings();

    this.vaultIndexEngine = new VaultIndexEngine();
    this.driveAdapter = new GoogleDriveAdapter();
    this.googleCalendarAdapter = new GoogleCalendarAdapter();

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
        privacyMode: this.settings.hideSensitivePreviews
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
    this.addCommand({ id: 'quartzo-open-today', name: 'Quartzo: Open Today', callback: () => { void this.activateQuartzo('home'); } });
    this.addCommand({ id: 'quartzo-planner', name: 'Quartzo: Planner', callback: () => { void this.activateQuartzo('planner'); } });
    this.addCommand({ id: 'quartzo-day-dial', name: 'Quartzo: Day Dial', callback: () => { void this.activateQuartzo('home'); } });
    this.addCommand({ id: 'quartzo-journal', name: 'Quartzo: Journal', callback: () => { void this.activateQuartzo('journal'); } });
    this.addCommand({ id: 'quartzo-browse', name: 'Quartzo: Browse', callback: () => { void this.activateQuartzo('browse'); } });
    this.addCommand({ id: 'quartzo-search', name: 'Quartzo: Search', callback: () => { void this.activateQuartzo('browse', 'search'); } });
    this.addCommand({ id: 'quartzo-quick-add', name: 'Quartzo: Quick Add', callback: () => { void this.activateQuartzo('home', 'add'); } });
    this.addCommand({ id: 'quartzo-sync-center', name: 'Quartzo: View sync status', callback: () => { void this.activateQuartzo('home', 'sync'); } });
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
    this.registerDomEvent(window, 'focus', () => {
      if (this.settings.syncMode !== 'automatic' || !this.settings.isPaired || !this.driveSyncCoordinator) return;
      void this.driveSyncCoordinator.triggerFocusSync().catch(error => {
        console.error('Focus sync failed:', error);
      });
    });
    this.reminderDeliveryGateway = new ObsidianReminderDeliveryGateway(
      () => this.settings.hideNotificationBody,
      () => { void this.activateQuartzo('home'); },
    );
    this.reminderService = new ReminderService({
      getObjects: () => this.getReminderSourceObjects(),
      getMode: () => this.settings.reminderDelivery,
      registry: new FileNotificationDeliveryRegistry(
        path.join(this.getPluginDirectoryPath(), 'quartzo-notification-delivery.json'),
      ),
      gateway: this.reminderDeliveryGateway,
    });
    await this.reminderService.start();
    this.registerInterval(window.setInterval(() => {
      void this.reminderService?.poll(new Date()).catch(error => {
        console.error('Reminder delivery poll failed:', error instanceof Error ? error.message : String(error));
      });
    }, 15_000));

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

  private getPluginDirectoryPath(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error('Desktop-only: FileSystemAdapter required');
    }
    const pluginDir = path.join(adapter.getBasePath(), this.app.vault.configDir, 'plugins', this.manifest.id);
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
    return pluginDir;
  }

  private getPluginDataPath(): string {
    return path.join(this.getPluginDirectoryPath(), 'quartzo-sync-state.json');
  }

  private getResolvedClientId(): string {
    return BUILD_CLIENT_ID || this.settings.oauthClientId || '';
  }

  private async getResolvedOAuthConfig(): Promise<OAuthConfig | null> {
    const clientId = this.getResolvedClientId();
    if (!clientId || clientId === 'PLACEHOLDER_CLIENT_ID') return null;
    const clientSecret = BUILD_CLIENT_SECRET || await this.getSecretStorage().get(GOOGLE_OAUTH_CLIENT_SECRET_ID) || '';
    if (!clientSecret) return null;
    return { ...OAUTH_CONFIG, clientId, clientSecret };
  }

  async setOAuthClientSecret(value: string): Promise<void> {
    const storage = this.getSecretStorage();
    if (value.trim()) await storage.set(GOOGLE_OAUTH_CLIENT_SECRET_ID, value.trim());
    else await storage.delete(GOOGLE_OAUTH_CLIENT_SECRET_ID);
  }

  private getSecretStorage() {
    const native = this.app.secretStorage;
    return {
      get: async (key: string) => native.getSecret(key),
      set: async (key: string, value: string) => { native.setSecret(key, value); },
      delete: async (key: string) => { native.setSecret(key, ''); }
    };
  }

  private configureGoogleAccessToken(token: string): void {
    this.driveAdapter?.setAccessToken(token);
    this.googleCalendarAdapter?.setAccessToken(token);
    const refresh = () => this.refreshGoogleAccessToken();
    this.driveAdapter?.setTokenRefreshCallback(refresh);
    this.googleCalendarAdapter?.setTokenRefreshCallback(refresh);
    this.calendarCache.clear();
  }

  private async refreshGoogleAccessToken(): Promise<string | null> {
    if (!this.oauthClient) return null;
    if (this.googleAccessRefreshInFlight) return this.googleAccessRefreshInFlight;
    this.googleAccessRefreshInFlight = (async () => {
      try {
        const refreshed = await this.oauthClient!.refreshAccessToken();
        this.configureGoogleAccessToken(refreshed.access_token);
        return refreshed.access_token;
      } catch {
        return null;
      } finally {
        this.googleAccessRefreshInFlight = null;
      }
    })();
    return this.googleAccessRefreshInFlight;
  }

  async listGoogleCalendarEvents(startDate: string, days: number): Promise<GoogleCalendarProjection[]> {
    if (!this.googleCalendarAdapter || this.authState === 'disconnected' || this.authState === 'authentication_required') {
      this.calendarStatus = 'disconnected';
      return [];
    }
    const safeDays = Math.max(1, Math.min(62, Math.trunc(days)));
    const start = parseLocalIsoDate(startDate);
    const end = addLocalDays(start, safeDays);
    const key = `${startDate}:${safeDays}`;
    const cached = this.calendarCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.events;

    try {
      const events = await this.googleCalendarAdapter.listVisibleEvents(start, end);
      this.calendarCache.set(key, { expiresAt: Date.now() + 60_000, events });
      this.calendarStatus = 'ready';
      return events;
    } catch (error) {
      this.calendarCache.delete(key);
      if (error instanceof GoogleCalendarAuthorizationError) {
        this.calendarStatus = 'authorization_required';
      } else {
        this.calendarStatus = 'error';
        console.error('Google Calendar read failed:', error);
      }
      return [];
    }
  }

  async reauthorizeGoogleCalendar(): Promise<void> {
    const config = await this.getResolvedOAuthConfig();
    if (!config) {
      new Notice('Google OAuth credentials are incomplete. Update Quartzo Companion or configure both Client ID and Client Secret in Settings.');
      return;
    }
    const previousAuthState = this.authState;
    this.authState = 'authenticating';
    const secretStorage = this.getSecretStorage();
    this.oauthClient = new GoogleOAuthDesktop(config, secretStorage, this.browserOpener);
    try {
      const tokenResponse = await this.oauthClient.startAuthLoopback(true);
      this.configureGoogleAccessToken(tokenResponse.access_token);
      this.calendarStatus = 'ready';
      this.authState = this.settings.isPaired ? 'paired' : 'authenticated_unpaired';
      new Notice('Google Calendar read-only access authorized.');
    } catch (error) {
      this.authState = previousAuthState;
      this.calendarStatus = 'authorization_required';
      new Notice(`Google Calendar authorization failed: ${error}`);
    }
  }
  private getReminderSourceObjects(): ReminderSourceObject[] {
    const index = this.vaultIndexEngine?.getIndex();
    if (!index) return [];
    return Array.from(index.objects.values()).map(object => ({
      ...object.frontmatter,
      id: object.id,
      type: object.type,
      title: String(object.frontmatter.title ?? object.type),
      body: object.body,
      __path: object.path,
    } as ReminderSourceObject));
  }

  async setReminderDelivery(mode: ReminderMode): Promise<void> {
    let nextMode = mode;
    if (mode === 'desktop_notifications') {
      const granted = await this.reminderDeliveryGateway?.requestDesktopPermission() ?? false;
      if (!granted) {
        nextMode = 'in_obsidian_only';
        new Notice('Desktop notification permission was not granted. Reminder delivery remains In-Obsidian only.');
      }
    }
    this.settings.reminderDelivery = nextMode;
    await this.saveSettings();
    this.reminderService?.resetWindow(new Date());
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
          if (this.settings.syncMode === 'automatic') this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onchange);

    const onmodifySync = this.app.vault.on('modify', (file: TAbstractFile) => {
      if (file instanceof TFile && VaultSyncFilePolicy.shouldSyncFile(file.path) && this.settings.isPaired && this.driveSyncCoordinator) {
        this.app.vault.readBinary(file).then(bytes => {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, new Uint8Array(bytes))) return;
          if (this.settings.syncMode === 'automatic') this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
        }).catch(() => {});
      }
    });
    this.eventRefs.push(onmodifySync);

    const ondeleteSync = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && VaultSyncFilePolicy.shouldSyncFile(file.path) && this.settings.isPaired && this.driveSyncCoordinator) {
        if (this.driveSyncCoordinator.consumeExpectedWatcherEvent(file.path, null)) return;
        this.driveSyncCoordinator.queueDelete(file.path);
        if (this.settings.syncMode === 'automatic') this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
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
        if (this.settings.syncMode === 'automatic') this.driveSyncCoordinator.triggerFocusSync().catch(() => {});
        return;
      }

      this.app.vault.readBinary(file).then(bytes => {
        const content = new Uint8Array(bytes);
        if (!oldSyncable && newSyncable) {
          if (this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, content)) return;
          if (this.settings.syncMode === 'automatic') this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
          return;
        }
        const oldSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(oldPath, null) ?? false;
        const newSuppressed = this.driveSyncCoordinator?.consumeExpectedWatcherEvent(file.path, content) ?? false;
        if (oldSuppressed && newSuppressed) return;
        this.driveSyncCoordinator?.queueRename(oldPath, file.path);
        if (this.settings.syncMode === 'automatic') this.driveSyncCoordinator?.triggerFocusSync().catch(() => {});
      }).catch(() => {});
    });
    this.eventRefs.push(onrenameSync);
  }

  startAutoSync() {
    if (this.syncIntervalId) return;
    if (this.settings.syncMode !== 'automatic') return;
    const seconds = Math.max(15, Math.min(3600, Math.trunc(this.settings.syncPollingIntervalSeconds)));
    this.syncIntervalId = setInterval(async () => {
      if (this.driveSyncCoordinator && this.settings.isPaired && this.settings.syncMode === 'automatic') {
        try {
          await this.driveSyncCoordinator.triggerFocusSync();
        } catch (error) {
          console.error('Auto sync failed:', error);
        }
      }
    }, seconds * 1000);
  }

  restartAutoSync() {
    this.stopAutoSync();
    this.startAutoSync();
  }

  async setSyncMode(mode: SyncMode): Promise<void> {
    this.settings.syncMode = mode;
    await this.saveSettings();
    this.stopAutoSync();
    if (mode === 'automatic' && this.settings.isPaired) this.startAutoSync();
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
    const refreshToken = await secretStorage.get(GOOGLE_REFRESH_TOKEN_SECRET_ID);
    if (!refreshToken) {
      this.settings.isPaired = false;
      await this.saveSettings();
      this.authState = 'authentication_required';
      new Notice('Session expired. Please reconnect Google Drive.');
      return;
    }

    try {
      const config = await this.getResolvedOAuthConfig();
      if (!config) throw new Error('Google OAuth credentials are incomplete');
      this.oauthClient = new GoogleOAuthDesktop(config, secretStorage, this.browserOpener);
      const tokenResponse = await this.oauthClient.refreshAccessToken();
      this.configureGoogleAccessToken(tokenResponse.access_token);
      this.authState = this.settings.isPaired ? 'paired' : 'authenticated_unpaired';

      if (this.driveAdapter && this.settings.googleDriveFolderId) {
        await this.driveAdapter.setFolderId(this.settings.googleDriveFolderId);
        await this.driveSyncCoordinator?.setDriveFolderId(this.settings.googleDriveFolderId);
      }

      if (this.settings.syncMode === 'automatic' && this.driveSyncCoordinator) {
        const result = await this.driveSyncCoordinator.triggerStartupSync();
        if (result.errors.length > 0) console.error('Startup sync failed:', result.errors[result.errors.length - 1]);
      }
      this.startAutoSync();
    } catch {
      this.settings.isPaired = false;
      this.authState = 'authentication_required';
      await this.saveSettings();
      new Notice('Session expired. Please reconnect Google Drive.');
    }
  }

  async startPairingFlow() {
    const config = await this.getResolvedOAuthConfig();
    if (!config) {
      this.authState = 'disconnected';
      new Notice('Google OAuth credentials are incomplete. Update Quartzo Companion or configure both Client ID and Client Secret in Settings.');
      return;
    }

    this.authState = 'authenticating';
    const secretStorage = this.getSecretStorage();
    this.oauthClient = new GoogleOAuthDesktop(config, secretStorage, this.browserOpener);

    try {
      const storedRefresh = await secretStorage.get(GOOGLE_REFRESH_TOKEN_SECRET_ID);
      const forceConsent = !storedRefresh;
      const tokenResponse = await this.oauthClient.startAuthLoopback(forceConsent);
      this.configureGoogleAccessToken(tokenResponse.access_token);

      if (!tokenResponse.refresh_token) {
        const storedRefresh = await secretStorage.get(GOOGLE_REFRESH_TOKEN_SECRET_ID);
        if (!storedRefresh) {
          new Notice('No refresh token received. Please re-authorize with full access.');
          await this.oauthClient.disconnect();
          this.driveAdapter?.setAccessToken('');
          this.authState = 'disconnected';
          return;
        }
      }

      this.authState = 'authenticated_unpaired';
      new Notice('Google Drive authenticated. Select your vault folder.');
    } catch (error) {
      this.authState = 'disconnected';
      new Notice(`Authentication failed: ${error}`);
    }
  }

  async reconnectGoogle(): Promise<void> {
    const config = await this.getResolvedOAuthConfig();
    if (!config) {
      new Notice('Google OAuth credentials are incomplete. Update Quartzo Companion or configure both Client ID and Client Secret in Settings.');
      return;
    }

    const wasPaired = Boolean(this.settings.googleDriveFolderId);
    this.authState = 'authenticating';
    const secretStorage = this.getSecretStorage();
    this.oauthClient = new GoogleOAuthDesktop(config, secretStorage, this.browserOpener);
    try {
      const tokenResponse = await this.oauthClient.startAuthLoopback(true);
      this.configureGoogleAccessToken(tokenResponse.access_token);
      if (wasPaired && this.settings.googleDriveFolderId) {
        await this.driveAdapter?.setFolderId(this.settings.googleDriveFolderId);
        await this.driveSyncCoordinator?.setDriveFolderId(this.settings.googleDriveFolderId);
        this.settings.isPaired = true;
        await this.saveSettings();
        this.authState = 'paired';
        this.startAutoSync();
        new Notice('Google Drive reconnected.');
      } else {
        this.authState = 'authenticated_unpaired';
        new Notice('Google Drive authenticated. Select your Quartzo vault.');
      }
    } catch (error) {
      this.authState = wasPaired ? 'authentication_required' : 'disconnected';
      new Notice(`Google Drive reconnect failed: ${error}`);
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
    this.googleCalendarAdapter?.setAccessToken(null);
    this.calendarCache.clear();
    this.calendarStatus = 'disconnected';
    this.settings.isPaired = false;
    this.authState = 'disconnected';
    this.settings.googleDriveFolderId = null;
    this.settings.googleDriveFolderName = null;
    await this.saveSettings();
    new Notice('Google Drive disconnected.');
  }

  async useWithoutSync(): Promise<void> {
    if (this.oauthClient) await this.oauthClient.disconnect();
    this.stopAutoSync();
    this.driveAdapter?.setAccessToken('');
    this.googleCalendarAdapter?.setAccessToken(null);
    this.calendarCache.clear();
    this.calendarStatus = 'disconnected';
    this.authState = 'disconnected';
    this.settings.googleDriveFolderId = null;
    this.settings.googleDriveFolderName = null;
    this.settings.isPaired = false;
    this.settings.firstRunCompleted = true;
    await this.saveSettings();
    new Notice('Quartzo Companion will stay local on this device until you connect Google Drive.');
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

  async refreshQuartzoView(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (leaf?.view instanceof QuartzoView) await leaf.view.refresh();
  }

  private async reloadSharedSettingsAndIndex(): Promise<void> {
    this.sharedSettings = await this.sharedSettingsRepository?.load() ?? null;
    await this.initializeVaultIndex();
    const leaf = this.app.workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (leaf?.view instanceof QuartzoView) await leaf.view.refresh();
  }

  showFirstRunDialog() {
    new QuartzoFirstRunModal(this.app, this).open();
  }

  onunload() {
    this.stopAutoSync();
    this.reminderService?.stop();
    this.oauthClient?.abort();
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
  }

  async loadSettings() {
    const raw = await this.loadData();
    const stored = raw != null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const legacyPrivacy = stored.privacyMode === true;
    const rawPolling = typeof stored.syncPollingIntervalSeconds === 'number'
      ? stored.syncPollingIntervalSeconds
      : DEFAULT_SETTINGS.syncPollingIntervalSeconds;

    const syncMode: SyncMode = stored.syncMode === 'automatic' || stored.syncMode === 'manual'
      ? stored.syncMode
      : stored.syncAuto === true
        ? 'automatic'
        : 'manual';

    this.settings = {
      googleDriveFolderId: typeof stored.googleDriveFolderId === 'string' ? stored.googleDriveFolderId : null,
      googleDriveFolderName: typeof stored.googleDriveFolderName === 'string' ? stored.googleDriveFolderName : null,
      syncMode,
      syncPollingIntervalSeconds: Math.max(15, Math.min(3600, Math.trunc(rawPolling))),
      hideSensitivePreviews: typeof stored.hideSensitivePreviews === 'boolean' ? stored.hideSensitivePreviews : legacyPrivacy,
      hideJournalPreviewText: typeof stored.hideJournalPreviewText === 'boolean' ? stored.hideJournalPreviewText : legacyPrivacy,
      hideNotificationBody: typeof stored.hideNotificationBody === 'boolean' ? stored.hideNotificationBody : legacyPrivacy,
      firstRunCompleted: typeof stored.firstRunCompleted === 'boolean' ? stored.firstRunCompleted : DEFAULT_SETTINGS.firstRunCompleted,
      oauthClientId: typeof stored.oauthClientId === 'string' ? stored.oauthClientId : DEFAULT_SETTINGS.oauthClientId,
      isPaired: typeof stored.isPaired === 'boolean' ? stored.isPaired : DEFAULT_SETTINGS.isPaired,
      reminderDelivery: stored.reminderDelivery === 'off' || stored.reminderDelivery === 'desktop_notifications'
        ? stored.reminderDelivery
        : 'in_obsidian_only',
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class QuartzoFirstRunModal extends Modal {
  constructor(app: App, private readonly plugin: QuartzoCompanionPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const title = document.createElement('h2');
    title.textContent = 'Quartzo Companion';
    contentEl.appendChild(title);

    const description = document.createElement('p');
    description.textContent = 'Use this Obsidian vault as a Quartzo client and synchronize it with your existing Quartzo vault in Google Drive.';
    contentEl.appendChild(description);

    const safety = document.createElement('p');
    safety.textContent = 'The Companion will never silently create a second Quartzo vault. After authorization, you explicitly select an existing Quartzo vault and review the pairing summary. Sync mode starts in Manual, so pairing does not enable background sync.';
    contentEl.appendChild(safety);

    const actions = document.createElement('div');
    actions.className = 'quartzo-first-run-actions';

    const localOnly = document.createElement('button');
    localOnly.textContent = 'Use without sync';
    localOnly.addEventListener('click', async () => {
      await this.plugin.useWithoutSync();
      this.close();
      await this.plugin.activateQuartzo('home');
    });
    actions.appendChild(localOnly);

    const connect = document.createElement('button');
    connect.className = 'mod-cta';
    connect.textContent = 'Connect Google Drive';
    connect.addEventListener('click', async () => {
      connect.disabled = true;
      connect.textContent = 'Connecting…';
      try {
        await this.plugin.startPairingFlow();
        if (this.plugin.authState === 'authenticated_unpaired') {
          this.close();
          await this.plugin.activateQuartzo('home', 'sync');
        }
      } finally {
        connect.disabled = false;
        connect.textContent = 'Connect Google Drive';
      }
    });
    actions.appendChild(connect);
    contentEl.appendChild(actions);
  }
}

class QuartzoSettingTab extends PluginSettingTab {
  plugin: QuartzoCompanionPlugin;

  constructor(app: App, plugin: QuartzoCompanionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private addHeading(container: HTMLElement, text: string): void {
    const heading = document.createElement('h2');
    heading.textContent = text;
    container.appendChild(heading);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addHeading(containerEl, 'Connection');

    new Setting(containerEl)
      .setName('Google status')
      .setDesc(this.plugin.authState.replace(/_/g, ' '));

    new Setting(containerEl)
      .setName('Drive vault')
      .setDesc(this.plugin.settings.googleDriveFolderName
        ? `${this.plugin.settings.googleDriveFolderName} · ID ${this.plugin.settings.googleDriveFolderId ?? 'unknown'}`
        : 'No Quartzo Drive vault paired.');

    if (BUILD_CLIENT_ID) {
      new Setting(containerEl)
        .setName('Google OAuth Client ID')
        .setDesc('Bundled in this Companion build.');
    } else {
      new Setting(containerEl)
        .setName('Google OAuth Client ID')
        .setDesc('Desktop OAuth Client ID from Google Cloud Console. Stored only on this device.')
        .addText(text => text
          .setPlaceholder('Enter OAuth Client ID')
          .setValue(this.plugin.settings.oauthClientId === 'PLACEHOLDER_CLIENT_ID' ? '' : this.plugin.settings.oauthClientId)
          .onChange(async value => {
            this.plugin.settings.oauthClientId = value.trim() || 'PLACEHOLDER_CLIENT_ID';
            await this.plugin.saveSettings();
          }));
    }

    if (BUILD_CLIENT_SECRET) {
      new Setting(containerEl)
        .setName('Google OAuth Client credential')
        .setDesc('Bundled for this Desktop OAuth client. PKCE remains enabled and user tokens stay in Obsidian SecretStorage.');
    } else {
      new Setting(containerEl)
        .setName('Google OAuth Client Secret')
        .setDesc('Required by Google token exchange for this Desktop client. Stored in Obsidian SecretStorage, never in data.json.')
        .addText(text => {
          text.inputEl.type = 'password';
          text
            .setPlaceholder('Enter OAuth Client Secret')
            .onChange(async value => {
              await this.plugin.setOAuthClientSecret(value);
            });
        });
    }

    new Setting(containerEl)
      .setName(this.plugin.settings.googleDriveFolderId ? 'Reconnect Google' : 'Connect Google Drive')
      .setDesc(this.plugin.settings.googleDriveFolderId
        ? 'Reauthorize this device while preserving the selected Drive vault identity.'
        : 'Authorize Google Drive, then explicitly select an existing Quartzo vault.')
      .addButton(button => button
        .setButtonText(this.plugin.settings.googleDriveFolderId ? 'Reconnect' : 'Connect')
        .onClick(async () => {
          if (this.plugin.settings.googleDriveFolderId) await this.plugin.reconnectGoogle();
          else await this.plugin.startPairingFlow();
          this.display();
        }));

    if (this.plugin.authState === 'authenticated_unpaired') {
      new Setting(containerEl)
        .setName('Select Quartzo vault')
        .setDesc('Continue setup in the Sync Center. The Companion never creates a second vault automatically.')
        .addButton(button => button
          .setButtonText('Select vault')
          .onClick(async () => {
            await this.plugin.activateQuartzo('home', 'sync');
          }));
    }

    new Setting(containerEl)
      .setName('Disconnect this device')
      .setDesc('Removes this device connection and selected Drive vault. Canonical vault files are not deleted.')
      .addButton(button => button
        .setButtonText('Disconnect')
        .setDisabled(this.plugin.authState === 'disconnected' && !this.plugin.settings.googleDriveFolderId)
        .onClick(async () => {
          await this.plugin.disconnectDrive();
          this.display();
        }));

    this.addHeading(containerEl, 'Sync');

    new Setting(containerEl)
      .setName('Sync mode')
      .setDesc('Manual is the default: the Companion never reconciles with Drive unless you choose Sync now or Run full reconciliation. Use Manual when this vault is already synced by Google Drive Desktop or another filesystem sync tool. Automatic enables startup, focus, polling, and eligible local-change sync.')
      .addDropdown(dropdown => dropdown
        .addOption('manual', 'Manual')
        .addOption('automatic', 'Automatic')
        .setValue(this.plugin.settings.syncMode)
        .onChange(async value => {
          await this.plugin.setSyncMode(value === 'automatic' ? 'automatic' : 'manual');
          this.display();
        }));

    if (this.plugin.settings.syncMode === 'automatic') {
      new Setting(containerEl)
        .setName('Remote polling interval')
        .setDesc('How often Automatic mode checks Drive while Obsidian is open. Default: 60 seconds.')
        .addDropdown(dropdown => dropdown
          .addOption('15', '15 seconds')
          .addOption('30', '30 seconds')
          .addOption('60', '60 seconds')
          .addOption('120', '2 minutes')
          .addOption('300', '5 minutes')
          .addOption('900', '15 minutes')
          .setValue(String(this.plugin.settings.syncPollingIntervalSeconds))
          .onChange(async value => {
            this.plugin.settings.syncPollingIntervalSeconds = Number(value);
            await this.plugin.saveSettings();
            this.plugin.restartAutoSync();
          }));
    }

    new Setting(containerEl)
      .setName('Manual full reconciliation')
      .setDesc('Rescan the complete local and Drive inventories instead of relying on the current Drive change token.')
      .addButton(button => button
        .setButtonText('Run full reconciliation')
        .setDisabled(!this.plugin.settings.isPaired)
        .onClick(async () => {
          const coordinator = this.plugin.driveSyncCoordinator;
          if (!coordinator || !this.plugin.settings.isPaired) {
            new Notice('Pair a Quartzo Drive vault first.');
            return;
          }
          const result = await coordinator.triggerFullReconciliation();
          if (result.errors.length > 0) new Notice(result.errors[result.errors.length - 1]);
          else new Notice(`Full reconciliation complete: ${result.synced} synced, ${result.conflicts} conflicts`);
          await this.plugin.refreshQuartzoView();
        }));

    this.addHeading(containerEl, 'Calendar');

    new Setting(containerEl)
      .setName('Google Calendar')
      .setDesc(`Read-only projection. Status: ${this.plugin.calendarStatus.replace(/_/g, ' ')}. The Companion never creates, edits or deletes Calendar events.`)
      .addButton(button => button
        .setButtonText(this.plugin.calendarStatus === 'ready' ? 'Reauthorize' : 'Authorize')
        .onClick(async () => {
          await this.plugin.reauthorizeGoogleCalendar();
          this.display();
        }));

    this.addHeading(containerEl, 'Notifications');

    new Setting(containerEl)
      .setName('Reminder delivery')
      .setDesc('V1 reminders are delivered only while Obsidian is running. In-Obsidian only is the work-computer default.')
      .addDropdown(dropdown => dropdown
        .addOption('off', 'Off')
        .addOption('in_obsidian_only', 'In-Obsidian only')
        .addOption('desktop_notifications', 'Desktop notifications')
        .setValue(this.plugin.settings.reminderDelivery)
        .onChange(async value => {
          await this.plugin.setReminderDelivery(value as ReminderMode);
          this.display();
        }));

    this.addHeading(containerEl, 'Appearance');

    new Setting(containerEl)
      .setName('Shared Quartzo appearance')
      .setDesc('Accent color, type colors and semantic type identification come from app/quartzo_shared_settings.md. Companion Settings do not create a second appearance source of truth.');

    this.addHeading(containerEl, 'Privacy');

    new Setting(containerEl)
      .setName('Hide sensitive previews')
      .setDesc('Hide sensitive preview content such as conflict bodies on this device. Canonical vault data is unchanged.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hideSensitivePreviews)
        .onChange(async value => {
          this.plugin.settings.hideSensitivePreviews = value;
          await this.plugin.saveSettings();
          if (this.plugin.viewContext) this.plugin.viewContext.state.privacyMode = value;
          await this.plugin.refreshQuartzoView();
        }));

    new Setting(containerEl)
      .setName('Hide journal preview text')
      .setDesc('Hide Journal Entry body snippets in the Companion on this device.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hideJournalPreviewText)
        .onChange(async value => {
          this.plugin.settings.hideJournalPreviewText = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshQuartzoView();
        }));

    new Setting(containerEl)
      .setName('Hide notification body')
      .setDesc('Desktop and in-Obsidian reminder notifications omit the object title/body on this device.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hideNotificationBody)
        .onChange(async value => {
          this.plugin.settings.hideNotificationBody = value;
          await this.plugin.saveSettings();
        }));
  }
}

