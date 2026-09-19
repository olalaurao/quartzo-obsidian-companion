import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';
import { VaultIndexEngine } from './vault/index';
import type { IndexedObject } from './vault/index/types';
import { SafeObjectMutationRepository } from './vault/object-mutation';
import type { SafeObjectMutation } from './core/object-mutation';
import {
  DriveSyncCoordinator,
  type PairingScanProgress,
  type PairingApplyProgress,
  type PairingSummary,
  type SafeDuplicateTrashPlan,
} from './sync/coordinator';
import { GoogleDriveAdapter } from './integrations/google/drive';
import { GoogleCalendarAdapter, GoogleCalendarAuthorizationError, type GoogleCalendarProjection } from './integrations/google/calendar';
import { GoogleOAuthDesktop, type OAuthConfig } from './integrations/google/auth/loopback';
import { GOOGLE_COMPANION_SCOPES } from './integrations/google/auth/scopes';
import { QuartzoView, QUARTZO_VIEW_TYPE, type QuartzoSection, type QuartzoAction } from './ui';
import { buildPairingDiagnosticsText } from './ui/sync/pairing-diagnostics';
import { ViewContext } from './ui/types';
import { addLocalDays, localIsoDate, parseLocalIsoDate } from './core/local-date';
import { ReminderService, type ReminderMode, type ReminderSourceObject, type ReminderDeliveryOccurrence } from './core/reminders';
import {
  OccurrenceActionService,
  companionOccurrenceDomainMode,
  type CanonicalOccurrenceAction,
  type CanonicalOccurrenceActionResult,
  type OccurrenceActionTarget,
  type OccurrenceResponseState,
} from './core/occurrence_actions';
import type { NormalizedItem } from './core/daily_schedule/types';
import { FileNotificationDeliveryRegistry } from './local-state/notification-delivery-registry';
import { ObsidianReminderDeliveryGateway } from './platform/notifications';
import { ElectronBrowserOpener } from './platform/browser-opener';
import { createCanonicalObjectId } from './platform/object-id';
import { GOOGLE_OAUTH_CLIENT_SECRET_ID, GOOGLE_REFRESH_TOKEN_SECRET_ID } from './platform/secret-ids';
import { normalizeVaultPath } from './sync/coordinator/path-utils';
import { VaultSyncFilePolicy } from './sync/coordinator/file-policy';
import { SHARED_SETTINGS_PATH, SharedSettingsRepository, parseObjectWithSharedSettings, type QuartzoSharedSettings } from './vault/shared-settings';
import { SHARED_OCCURRENCE_STATE_PATH, SharedOccurrenceStateRepository } from './vault/occurrence-state';
import { OccurrenceDomainMutationRepository } from './vault/occurrence-domain-mutations';
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
  occurrenceActionService: OccurrenceActionService | null = null;
  viewContext: ViewContext | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private eventRefs: ReturnType<typeof this.app.vault.on>[] = [];
  private sharedSettingsRepository: SharedSettingsRepository | null = null;
  private sharedSettings: QuartzoSharedSettings | null = null;
  private occurrenceStateRepository: SharedOccurrenceStateRepository | null = null;
  private occurrenceDomainMutationRepository: OccurrenceDomainMutationRepository | null = null;
  private safeObjectMutationRepository: SafeObjectMutationRepository | null = null;
  private occurrenceResponses: Record<string, OccurrenceResponseState> = {};
  private googleAccessRefreshInFlight: Promise<string | null> | null = null;
  private pairingWorkflowModal: HTMLDivElement | null = null;
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
    try {
      await this.driveSyncCoordinator.hydratePersistedState();
    } catch (error) {
      console.error('Failed to hydrate persisted sync state:', error);
    }

    this.occurrenceStateRepository = new SharedOccurrenceStateRepository(this.app.vault);
    this.occurrenceDomainMutationRepository = new OccurrenceDomainMutationRepository(this.app.vault);
    this.safeObjectMutationRepository = new SafeObjectMutationRepository(this.app.vault);
    try {
      this.occurrenceResponses = await this.occurrenceStateRepository.loadResponses();
    } catch (error) {
      console.error('Failed to load shared occurrence state:', error);
      this.occurrenceResponses = {};
    }
    this.occurrenceActionService = new OccurrenceActionService({
      store: this.occurrenceStateRepository,
      completeDomainOccurrence: (target, completedAt, recordedAt, actionId) =>
        this.completeOccurrenceDomain(target, completedAt, recordedAt, actionId),
      clearDomainOccurrence: target => this.clearOccurrenceDomain(target),
    });

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
      occurrence => { void this.openReminderOccurrence(occurrence); },
      message => { new Notice(message); },
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

  async openGoogleCalendarEvent(event: GoogleCalendarProjection): Promise<void> {
    if (!event.htmlLink) {
      throw new Error('Google Calendar event does not provide an external link.');
    }
    await this.browserOpener.open(event.htmlLink);
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
  private async openReminderOccurrence(occurrence: ReminderDeliveryOccurrence): Promise<void> {
    await this.activateQuartzo('home');
    const leaf = this.app.workspace.getLeavesOfType(QUARTZO_VIEW_TYPE)[0];
    if (leaf?.view instanceof QuartzoView) {
      await leaf.view.openObjectById(occurrence.sourceId);
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

  private async completeOccurrenceDomain(
    target: OccurrenceActionTarget,
    completedAt: Date,
    recordedAt: Date,
    actionId: string,
  ): Promise<void> {
    const mode = companionOccurrenceDomainMode(target.sourceType);
    if (mode === 'response_only') return;
    if (mode === 'unsupported') {
      throw new Error(`Companion does not yet support ${target.sourceType} completion safely.`);
    }
    const object = this.vaultIndexEngine?.getIndex()?.objects.get(target.sourceId);
    if (!object) {
      throw new Error(`Occurrence source ${target.sourceId} is not available in the vault index.`);
    }
    const repository = this.occurrenceDomainMutationRepository;
    if (!repository) throw new Error('Occurrence domain mutations are not initialized.');
    await repository.complete(object.path, target, completedAt, recordedAt, actionId);
  }

  private async clearOccurrenceDomain(
    target: OccurrenceActionTarget,
  ): Promise<void> {
    const mode = companionOccurrenceDomainMode(target.sourceType);
    if (mode === 'response_only') return;
    if (mode === 'unsupported') return;
    const object = this.vaultIndexEngine?.getIndex()?.objects.get(target.sourceId);
    if (!object) {
      throw new Error(`Occurrence source ${target.sourceId} is not available in the vault index.`);
    }
    const repository = this.occurrenceDomainMutationRepository;
    if (!repository) throw new Error('Occurrence domain mutations are not initialized.');
    await repository.clear(object.path, target);
  }

  getOccurrenceResponses(): Record<string, OccurrenceResponseState> {
    return this.occurrenceResponses;
  }

  private async reloadOccurrenceResponses(refreshView = true): Promise<void> {
    if (!this.occurrenceStateRepository) return;
    try {
      this.occurrenceResponses = await this.occurrenceStateRepository.loadResponses();
      if (refreshView) await this.refreshQuartzoView();
    } catch (error) {
      console.error('Shared occurrence state reload failed:', error);
    }
  }

  async performOccurrenceAction(
    item: NormalizedItem,
    action: CanonicalOccurrenceAction,
    options: { completedAt?: Date; snoozeMinutes?: number } = {},
  ): Promise<CanonicalOccurrenceActionResult> {
    const service = this.occurrenceActionService;
    if (!service) throw new Error('Occurrence actions are not initialized.');
    const domainMode = companionOccurrenceDomainMode(item.sourceType);
    if (domainMode === 'unsupported' && (action === 'done' || action === 'already_did')) {
      throw new Error(`${item.sourceType} completion requires a domain adapter that is not available yet.`);
    }
    if (domainMode === 'unsupported' && action === 'clear' && item.outcome === 'done') {
      throw new Error(`${item.sourceType} completed evidence cannot be undone safely yet.`);
    }
    if (item.origin === 'externalEvent' && !['skip', 'clear', 'already_did'].includes(action)) {
      throw new Error('This external event action is not supported by the Companion.');
    }

    const dueAt = parseLocalIsoDate(item.date);
    if (item.start) {
      const match = /^(\d{2}):(\d{2})$/.exec(item.start);
      if (match) dueAt.setHours(Number(match[1]), Number(match[2]), 0, 0);
    }
    const target = {
      occurrenceId: item.actionOccurrenceId ?? item.occurrenceId ?? item.id,
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      reminderId: item.reminderId,
      slotIndex: item.slotIndex,
      dueAt: dueAt.toISOString(),
    };
    const actionId = `client:obsidian:${createCanonicalObjectId()}:${action}`;
    const now = new Date();

    let result: CanonicalOccurrenceActionResult;
    switch (action) {
      case 'done':
        result = await service.completeNow(target, actionId, now);
        break;
      case 'already_did': {
        const completedAt = options.completedAt;
        if (!completedAt || Number.isNaN(completedAt.getTime())) {
          throw new Error('Choose when this occurrence was completed.');
        }
        result = await service.completeAt(target, actionId, completedAt, now);
        break;
      }
      case 'skip':
        result = await service.skip(target, actionId, now);
        break;
      case 'clear':
        result = await service.clearOutcome(target, actionId);
        break;
      case 'snooze': {
        const minutes = options.snoozeMinutes;
        if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
          throw new Error('Choose a positive snooze duration.');
        }
        result = await service.snooze(target, actionId, now, Math.round(minutes * 60_000));
        break;
      }
      case 'dismiss':
        result = await service.dismissDelivery(target, actionId, now);
        break;
    }

    this.occurrenceResponses = {
      ...this.occurrenceResponses,
      [result.occurrenceId]: result.responseState,
    };
    await this.refreshQuartzoView();
    return result;
  }

  async mutateObject(object: IndexedObject, patch: SafeObjectMutation): Promise<void> {
    const repository = this.safeObjectMutationRepository;
    const engine = this.vaultIndexEngine;
    const index = engine?.getIndex();
    if (!repository || !engine || !index) {
      throw new Error('Object mutation is not initialized.');
    }

    const markdown = await repository.mutate(object, patch);
    const parsed = parseObjectWithSharedSettings(markdown, object.path, this.sharedSettings);
    if (parsed.object.id !== object.id || parsed.object.type !== object.type) {
      throw new Error('Object mutation changed identity or type unexpectedly.');
    }

    engine.setIndex(VaultIndexEngine.updateIndex(index, [{
      type: 'modified',
      path: normalizeVaultPath(object.path),
      object: {
        id: parsed.object.id,
        type: parsed.object.type,
        path: object.path,
        frontmatter: parsed.object as Record<string, unknown>,
        body: parsed.object.body || '',
      },
    }]));
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
      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_OCCURRENCE_STATE_PATH) { void this.reloadOccurrenceResponses(); return; }
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
      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_OCCURRENCE_STATE_PATH) { void this.reloadOccurrenceResponses(); return; }
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
      if (file instanceof TFile && normalizeVaultPath(file.path) === SHARED_OCCURRENCE_STATE_PATH) {
        this.occurrenceResponses = {};
        void this.refreshQuartzoView();
        return;
      }
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
      if (normalizeVaultPath(oldPath) === SHARED_OCCURRENCE_STATE_PATH || normalizeVaultPath(file.path) === SHARED_OCCURRENCE_STATE_PATH) {
        void this.reloadOccurrenceResponses();
        return;
      }
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
  private createPairingWorkflowSurface(): { modal: HTMLDivElement; modalContent: HTMLDivElement } {
    if (this.pairingWorkflowModal?.isConnected) {
      this.pairingWorkflowModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'quartzo-pairing-summary-modal';
    modal.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 10000',
      'background: rgba(0, 0, 0, 0.45)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 16px',
    ].join(';');

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.cssText = [
      'padding: 20px',
      'background: var(--background-primary)',
      'border: 1px solid var(--background-modifier-border)',
      'border-radius: 8px',
      'width: min(760px, calc(100vw - 32px))',
      'max-height: min(760px, calc(100vh - 32px))',
      'overflow: auto',
      'box-shadow: var(--shadow-l)',
    ].join(';');

    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    this.pairingWorkflowModal = modal;
    return { modal, modalContent };
  }

  private closePairingWorkflowSurface(modal: HTMLDivElement): void {
    modal.remove();
    if (this.pairingWorkflowModal === modal) this.pairingWorkflowModal = null;
  }

  private renderPairingWorkflowError(
    modal: HTMLDivElement,
    modalContent: HTMLDivElement,
    titleText: string,
    message: string,
    helpText: string,
    back?: () => void
  ): void {
    modalContent.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = titleText;
    modalContent.appendChild(title);

    const error = document.createElement('p');
    error.style.cssText = 'font-weight: 600; word-break: break-word;';
    error.textContent = message;
    modalContent.appendChild(error);

    const help = document.createElement('p');
    help.textContent = helpText;
    modalContent.appendChild(help);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; flex-wrap: wrap;';

    if (back) {
      const backButton = document.createElement('button');
      backButton.textContent = 'Back';
      backButton.addEventListener('click', back);
      actions.appendChild(backButton);
    }

    const copy = document.createElement('button');
    copy.textContent = 'Copy error';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message);
        new Notice('Pairing error copied.');
      } catch (error) {
        new Notice(`Could not copy pairing error: ${error}`);
      }
    });
    actions.appendChild(copy);

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', () => this.closePairingWorkflowSurface(modal));
    actions.appendChild(close);

    modalContent.appendChild(actions);
  }

  private renderPairingSummaryContent(
    modal: HTMLDivElement,
    modalContent: HTMLDivElement,
    folderName: string,
    summary: PairingSummary
  ): void {
    if (summary.divergent.length > 0 || summary.ambiguous.length > 0) {
      this.renderBlockedPairingContent(modal, modalContent, folderName, summary);
      return;
    }
    this.renderReadyPairingContent(modal, modalContent, folderName, summary);
  }

  private renderBlockedPairingContent(
    modal: HTMLDivElement,
    modalContent: HTMLDivElement,
    folderName: string,
    summary: PairingSummary,
    mode: 'pairing' | 'sync_repair' = 'pairing'
  ): void {
    modalContent.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = mode === 'sync_repair' ? 'Drive duplicates block sync' : 'Pairing blocked';
    modalContent.appendChild(title);

    const intro = document.createElement('p');
    intro.textContent = mode === 'sync_repair'
      ? `Folder: ${folderName}. ${summary.ambiguous.length} ambiguous Drive path(s) are blocking sync. Quartzo will not choose between live remote candidates automatically.`
      : `Folder: ${folderName}. ${summary.divergent.length} divergent and ${summary.ambiguous.length} ambiguous path(s) must be resolved before pairing.`;
    modalContent.appendChild(intro);

    if (summary.ambiguous.length > 0) {
      const explanation = document.createElement('p');
      explanation.textContent = mode === 'sync_repair'
        ? 'The same SHA-256 and Drive trash safety checks used during first pairing are available here after pairing. Only content-proven duplicates can be moved to Drive trash.'
        : 'Ambiguous means Google Drive returned more than one remote file candidate for the same Quartzo-relative path. Quartzo will not choose one automatically.';
      modalContent.appendChild(explanation);
    }

    if (mode === 'pairing' && summary.divergent.length > 0) {
      const heading = document.createElement('h3');
      heading.textContent = `Divergent paths (${summary.divergent.length})`;
      modalContent.appendChild(heading);
      const list = document.createElement('ul');
      for (const item of summary.divergent) {
        const li = document.createElement('li');
        li.textContent = item.path;
        list.appendChild(li);
      }
      modalContent.appendChild(list);
    }

    const safeTrashPlan = this.driveSyncCoordinator?.buildSafeDuplicateTrashPlan(summary) ?? {
      resolutions: [],
      unresolvedPaths: summary.ambiguous.map(item => item.path),
      totalTrashFiles: 0,
    };

    if (summary.ambiguous.length > 0) {
      const heading = document.createElement('h3');
      heading.textContent = `Ambiguous Drive paths (${summary.ambiguous.length})`;
      modalContent.appendChild(heading);

      for (const item of summary.ambiguous) {
        const details = document.createElement('details');
        details.style.cssText = 'margin: 8px 0; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px;';

        const candidatesForPath = item.remoteCandidates ?? [];
        const distinctHashes = new Set(candidatesForPath.map(candidate => candidate.resolvedSha256));
        const matchingLocal = candidatesForPath.filter(candidate => candidate.matchesLocal === true).length;

        const safeResolution = safeTrashPlan.resolutions.find(resolution => resolution.path === item.path);
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = safeResolution
          ? `${item.path} — ${candidatesForPath.length} candidates · safe cleanup available`
          : `${item.path} — ${candidatesForPath.length} candidates`;
        details.appendChild(summaryEl);

        const relation = document.createElement('p');
        if (distinctHashes.size <= 1) {
          relation.textContent = item.localHash
            ? (matchingLocal === candidatesForPath.length
              ? 'All remote candidates are byte-identical and match the local file.'
              : 'All remote candidates are byte-identical, but they do not match the local file.')
            : 'All remote candidates are byte-identical. There is no local copy to compare.';
        } else if (item.localHash && matchingLocal === 1) {
          relation.textContent = 'Candidates contain different bytes. Exactly one remote candidate matches the local file.';
        } else if (item.localHash && matchingLocal > 1) {
          relation.textContent = `Candidates contain different bytes. ${matchingLocal} candidates match the local file.`;
        } else if (item.localHash) {
          relation.textContent = 'Candidates contain different bytes and none matches the local file.';
        } else {
          relation.textContent = `Candidates contain ${distinctHashes.size} different byte contents and there is no local copy to compare.`;
        }
        details.appendChild(relation);

        const localHash = document.createElement('div');
        localHash.style.cssText = 'font-size: 0.9em; word-break: break-all; margin-bottom: 8px;';
        localHash.textContent = `Local SHA-256: ${item.localHash ?? 'no local copy'}`;
        details.appendChild(localHash);

        const candidates = document.createElement('ul');
        for (const candidate of candidatesForPath) {
          const li = document.createElement('li');
          li.style.cssText = 'margin: 8px 0;';

          const meta = document.createElement('div');
          meta.style.cssText = 'word-break: break-all;';
          const localRelation = candidate.matchesLocal == null
            ? 'no local comparison'
            : candidate.matchesLocal
              ? 'matches local'
              : 'differs from local';
          const cleanupRelation = safeResolution
            ? candidate.id === safeResolution.keepFileId
              ? 'planned: keep'
              : safeResolution.trashFileIds.includes(candidate.id)
                ? 'planned: safe to trash'
                : 'planned: untouched'
            : 'planned: manual review';
          const trashPermission = candidate.canTrash === true
            ? 'Drive trash allowed'
            : candidate.canTrash === false
              ? 'Drive trash not permitted'
              : 'Drive trash permission unknown';
          meta.textContent = `ID ${candidate.id} · modified ${candidate.modifiedTime ?? 'unknown'} · SHA-256 ${candidate.resolvedSha256} · ${localRelation} · ${cleanupRelation} · ${trashPermission} · Quartzo_hash ${candidate.quartzoHash ? 'present' : 'missing'}`;
          li.appendChild(meta);

          const openButton = document.createElement('button');
          openButton.textContent = 'Open this candidate in Google Drive';
          openButton.addEventListener('click', async () => {
            try {
              await this.browserOpener.open(`https://drive.google.com/open?id=${encodeURIComponent(candidate.id)}`);
            } catch (error) {
              new Notice(`Could not open Drive candidate: ${error}`);
            }
          });
          li.appendChild(openButton);
          candidates.appendChild(li);
        }
        details.appendChild(candidates);
        modalContent.appendChild(details);
      }
    }

    const instructions = document.createElement('p');
    instructions.textContent = safeTrashPlan.totalTrashFiles > 0
      ? 'The Companion can move only the content-proven duplicate candidates to Google Drive trash. Anything that is not provably safe remains untouched.'
      : mode === 'sync_repair'
        ? 'These live duplicates are not provably safe to clean automatically. Review the candidate contents/permissions and keep the paths blocked until they are explicitly resolved.'
        : 'Resolve the duplicate Drive identity first, then run Pair again. Do not delete a candidate unless you have confirmed which copy should remain.';
    modalContent.appendChild(instructions);

    const actions = document.createElement('div');
    actions.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap;';

    if (safeTrashPlan.totalTrashFiles > 0 && this.driveSyncCoordinator) {
      const cleanupButton = document.createElement('button');
      cleanupButton.className = 'mod-warning';
      cleanupButton.textContent = `Review ${safeTrashPlan.totalTrashFiles} safe duplicate(s) to move to Drive trash`;
      cleanupButton.addEventListener('click', () => {
        this.renderSafeDuplicateTrashConfirmation(
          modal,
          modalContent,
          folderName,
          summary,
          safeTrashPlan,
          mode
        );
      });
      actions.appendChild(cleanupButton);
    }

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy diagnostics';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(buildPairingDiagnosticsText(folderName, summary));
        new Notice(mode === 'sync_repair' ? 'Drive duplicate diagnostics copied.' : 'Pairing diagnostics copied.');
      } catch (error) {
        new Notice(`Could not copy pairing diagnostics: ${error}`);
      }
    });
    actions.appendChild(copyButton);

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => this.closePairingWorkflowSurface(modal));
    actions.appendChild(closeButton);

    modalContent.appendChild(actions);
  }

  private renderSafeDuplicateTrashConfirmation(
    modal: HTMLDivElement,
    modalContent: HTMLDivElement,
    folderName: string,
    summary: PairingSummary,
    plan: SafeDuplicateTrashPlan,
    mode: 'pairing' | 'sync_repair' = 'pairing'
  ): void {
    modalContent.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = 'Move safe duplicates to Drive trash?';
    modalContent.appendChild(title);

    const description = document.createElement('p');
    description.textContent =
      `The Companion will revalidate every affected local file and Drive candidate, then move ${plan.totalTrashFiles} proven duplicate file(s) across ${plan.resolutions.length} path(s) to Google Drive trash. It will keep one canonical candidate per path and will not empty Drive trash.`;
    modalContent.appendChild(description);

    if (plan.unresolvedPaths.length > 0) {
      const unresolved = document.createElement('p');
      unresolved.textContent =
        `${plan.unresolvedPaths.length} ambiguous path(s) are not provably safe and will be left untouched.`;
      modalContent.appendChild(unresolved);
    }

    const list = document.createElement('ul');
    for (const resolution of plan.resolutions) {
      const item = document.createElement('li');
      item.textContent =
        `${resolution.path}: keep ${resolution.keepFileId}; move ${resolution.trashFileIds.length} duplicate(s) to trash.`;
      list.appendChild(item);
    }
    modalContent.appendChild(list);

    const safety = document.createElement('p');
    safety.textContent =
      'Nothing is permanently deleted. If the Drive candidate set, modification snapshot, or local hash changed since the scan, that path is skipped and must be rescanned.';
    modalContent.appendChild(safety);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; flex-wrap: wrap;';

    const back = document.createElement('button');
    back.textContent = 'Back to diagnostics';
    back.addEventListener('click', () => {
      this.renderBlockedPairingContent(modal, modalContent, folderName, summary, mode);
    });
    actions.appendChild(back);

    const confirm = document.createElement('button');
    confirm.className = 'mod-warning';
    confirm.textContent = `Move ${plan.totalTrashFiles} file(s) to Drive trash`;
    confirm.addEventListener('click', async () => {
      if (!this.driveSyncCoordinator) return;

      modalContent.replaceChildren();
      const progressTitle = document.createElement('h2');
      progressTitle.textContent = 'Cleaning up safe duplicates';
      modalContent.appendChild(progressTitle);

      const progress = document.createElement('p');
      progress.style.cssText = 'font-weight: 600; word-break: break-word;';
      progress.textContent = 'Revalidating local and Google Drive candidates…';
      modalContent.appendChild(progress);

      const help = document.createElement('p');
      help.textContent = 'Keep Obsidian open. This screen will update automatically; no second confirmation window will open.';
      modalContent.appendChild(help);

      try {
        const result = await this.driveSyncCoordinator.trashSafePairingDuplicates(summary);
        progress.textContent = 'Safe duplicate cleanup finished. Rescanning the vaults…';

        const refreshedSummary = await this.driveSyncCoordinator.generatePairingSummary(scan => {
          if (scan.phase === 'local_inventory') {
            progress.textContent = 'Rescanning local vault…';
          } else if (scan.phase === 'remote_inventory') {
            progress.textContent = 'Relisting Google Drive vault…';
          } else if (scan.phase === 'resolving_ambiguities') {
            progress.textContent = scan.total > 0
              ? `Rechecking duplicate contents ${scan.completed}/${scan.total}…`
              : 'Rechecking duplicate contents…';
          } else if (scan.total > 0) {
            progress.textContent = `Recomparing vaults ${scan.completed}/${scan.total}…`;
          } else {
            progress.textContent = 'Recomparing vaults…';
          }
        });

        if (result.errors.length > 0) {
          const message = result.errors.join('; ');
          this.renderPairingWorkflowError(
            modal,
            modalContent,
            'Safe duplicate cleanup did not fully finish',
            message,
            'The vaults were rescanned after the cleanup attempt. Use Back to inspect the refreshed diagnostics; no file was permanently deleted.',
            () => mode === 'sync_repair'
              ? this.renderBlockedPairingContent(modal, modalContent, folderName, refreshedSummary, 'sync_repair')
              : this.renderPairingSummaryContent(modal, modalContent, folderName, refreshedSummary)
          );
          new Notice('Safe duplicate cleanup stopped with details open in the pairing window.');
          return;
        }

        const plannedTrashIds = new Set(plan.resolutions.flatMap(resolution => resolution.trashFileIds));
        const lingering = refreshedSummary.ambiguous.flatMap(item =>
          (item.remoteCandidates ?? [])
            .filter(candidate => plannedTrashIds.has(candidate.id))
            .map(candidate => `${item.path} [${candidate.id}]`)
        );
        if (lingering.length > 0) {
          this.renderPairingWorkflowError(
            modal,
            modalContent,
            'Drive has not confirmed duplicate cleanup yet',
            `Google Drive still reports recently trashed duplicate candidate(s) as active: ${lingering.join(', ')}`,
            'No additional delete will run automatically. Use Back to inspect the refreshed summary, wait a moment, and retry only if the same candidates remain.',
            () => mode === 'sync_repair'
              ? this.renderBlockedPairingContent(modal, modalContent, folderName, refreshedSummary, 'sync_repair')
              : this.renderPairingSummaryContent(modal, modalContent, folderName, refreshedSummary)
          );
          return;
        }

        new Notice(
          `Moved ${result.trashed} safe duplicate file(s) to Google Drive trash across ${result.resolvedPaths} path(s). Drive trash was not emptied.`
        );
        if (mode === 'sync_repair') {
          if (refreshedSummary.ambiguous.length > 0) {
            this.renderBlockedPairingContent(modal, modalContent, folderName, refreshedSummary, 'sync_repair');
            return;
          }

          progress.textContent = 'Duplicate cleanup verified. Running full reconciliation…';
          const reconcileResult = await this.driveSyncCoordinator.triggerFullReconciliation();
          this.closePairingWorkflowSurface(modal);
          await this.refreshQuartzoView();
          if (reconcileResult.errors.length > 0) {
            new Notice(reconcileResult.errors[reconcileResult.errors.length - 1]);
          } else {
            new Notice(`Drive duplicates resolved. Full reconciliation complete: ${reconcileResult.synced} synced, ${reconcileResult.conflicts} conflicts.`);
          }
          return;
        }
        this.renderPairingSummaryContent(modal, modalContent, folderName, refreshedSummary);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.renderPairingWorkflowError(
          modal,
          modalContent,
          'Safe duplicate cleanup did not finish',
          message,
          'No file was permanently deleted. You can return to the diagnostics and try again after reviewing the error.',
          () => this.renderBlockedPairingContent(modal, modalContent, folderName, summary, mode)
        );
      }
    });
    actions.appendChild(confirm);
    modalContent.appendChild(actions);
  }

  private renderReadyPairingContent(
    modal: HTMLDivElement,
    modalContent: HTMLDivElement,
    folderName: string,
    summary: PairingSummary
  ): void {
    modalContent.replaceChildren();

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

    const progressText = document.createElement('p');
    progressText.style.cssText = 'display: none; font-weight: 600; word-break: break-word;';
    modalContent.appendChild(progressText);

    const progressHelp = document.createElement('p');
    progressHelp.style.cssText = 'display: none; font-size: 0.9em;';
    progressHelp.textContent = 'Keep Obsidian open. If Google Drive reaches a temporary quota limit, this step can pause and resume automatically.';
    modalContent.appendChild(progressHelp);

    const actions = document.createElement('div');
    actions.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap;';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      this.closePairingWorkflowSurface(modal);
      new Notice('Pairing cancelled.');
    });
    actions.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Accept & Pair';
    actions.appendChild(confirmButton);

    modalContent.appendChild(actions);

    confirmButton.addEventListener('click', async () => {
      if (!this.driveSyncCoordinator) return;

      cancelButton.disabled = true;
      confirmButton.disabled = true;
      confirmButton.textContent = 'Pairing…';
      question.textContent = 'Pairing is in progress.';
      progressText.style.display = '';
      progressHelp.style.display = '';

      const renderApplyProgress = (progress: PairingApplyProgress) => {
        const suffix = progress.currentPath ? ` · ${progress.currentPath}` : '';
        if (progress.phase === 'revalidating_remote') {
          progressText.textContent = 'Revalidating Google Drive vault…';
        } else if (progress.phase === 'baselining') {
          progressText.textContent = progress.total > 0
            ? `Establishing baselines ${progress.completed}/${progress.total}${suffix}`
            : 'Establishing baselines…';
        } else if (progress.phase === 'adopting_local') {
          progressText.textContent = progress.total > 0
            ? `Uploading local-only files ${progress.completed}/${progress.total}${suffix}`
            : 'No local-only files to upload.';
        } else if (progress.phase === 'pulling_remote') {
          progressText.textContent = progress.total > 0
            ? `Downloading remote-only files ${progress.completed}/${progress.total}${suffix}`
            : 'No remote-only files to download.';
        } else {
          progressText.textContent = progress.completed >= progress.total
            ? 'Finalizing pairing…'
            : 'Saving pairing state…';
        }
      };

      try {
        const pairingResult = await this.driveSyncCoordinator.applyPairingDecisions(
          summary,
          { autoAdopt: true, autoPull: true },
          renderApplyProgress
        );
        if (pairingResult.errors.length > 0) {
          const message = pairingResult.errors.join('; ');
          this.renderPairingWorkflowError(
            modal,
            modalContent,
            'Pairing did not finish',
            message,
            'Completed uploads or downloads remain safe to rescan. Close this message, then run Pair again to build a fresh summary.'
          );
          new Notice('Pairing stopped. Error details are open in the pairing window.');
          await this.refreshQuartzoView();
          return;
        }

        this.settings.isPaired = true;
        this.settings.firstRunCompleted = true;
        this.authState = 'paired';
        await this.saveSettings();
        this.startAutoSync();
        this.closePairingWorkflowSurface(modal);
        await this.refreshQuartzoView();
        new Notice(`Paired with folder: ${folderName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.renderPairingWorkflowError(
          modal,
          modalContent,
          'Pairing did not finish',
          message,
          'Completed uploads or downloads remain safe to rescan. Close this message, then run Pair again to build a fresh summary.'
        );
        await this.refreshQuartzoView();
        new Notice('Pairing stopped. Error details are open in the pairing window.');
      }
    });
  }

  private showPairingSummarySurface(folderName: string, summary: PairingSummary): void {
    const { modal, modalContent } = this.createPairingWorkflowSurface();
    this.renderPairingSummaryContent(modal, modalContent, folderName, summary);
  }

  async reviewSyncRemoteDuplicates(): Promise<void> {
    if (!this.driveSyncCoordinator || !this.settings.isPaired) {
      new Notice('Pair this device before reviewing Drive duplicates.');
      return;
    }

    const folderName = this.settings.googleDriveFolderName ?? 'Quartzo vault';
    const { modal, modalContent } = this.createPairingWorkflowSurface();
    modalContent.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = 'Reviewing Drive duplicates';
    modalContent.appendChild(title);

    const progress = document.createElement('p');
    progress.style.cssText = 'font-weight: 600; word-break: break-word;';
    progress.textContent = 'Scanning local vault…';
    modalContent.appendChild(progress);

    const describeProgress = (completed: number, total: number): string => {
      if (total <= 0) return '';
      const percent = Math.min(100, Math.round((completed / total) * 100));
      return ` ${completed}/${total} (${percent}%)`;
    };

    try {
      const summary = await this.driveSyncCoordinator.generatePairingSummary(scan => {
        const amount = describeProgress(scan.completed, scan.total);
        if (scan.phase === 'local_inventory') {
          progress.textContent = 'Scanning local vault…';
        } else if (scan.phase === 'remote_inventory') {
          progress.textContent = 'Listing Google Drive vault…';
        } else if (scan.phase === 'resolving_ambiguities') {
          progress.textContent = `Hashing duplicate candidates…${amount}`;
        } else {
          progress.textContent = `Comparing local and Drive files…${amount}`;
        }
      });

      if (summary.ambiguous.length === 0) {
        this.renderPairingWorkflowError(
          modal,
          modalContent,
          'No live Drive duplicates found',
          'The fresh Drive inventory no longer contains more than one live remote candidate for the same Quartzo path.',
          'Close this window and run full reconciliation again. If sync still fails, the next error is a different issue.'
        );
        return;
      }

      this.renderBlockedPairingContent(modal, modalContent, folderName, summary, 'sync_repair');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.renderPairingWorkflowError(
        modal,
        modalContent,
        'Could not review Drive duplicates',
        message,
        'No duplicate was changed. Close this window and retry after the Drive request is available.'
      );
    }
  }

  async confirmPairing(
    folderId: string,
    folderName: string,
    autoAdopt: boolean,
    autoPull: boolean,
    onProgress?: (progress: PairingScanProgress) => void
  ): Promise<void> {
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

    const summary = await this.driveSyncCoordinator.generatePairingSummary(onProgress);

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
      return;
    }

    this.showPairingSummarySurface(folderName, summary);
    if (summary.divergent.length > 0 || summary.ambiguous.length > 0) {
      new Notice(`Pairing blocked: ${summary.divergent.length} divergent and ${summary.ambiguous.length} ambiguous file(s) require resolution.`);
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

    const desktopPermission = this.plugin.reminderDeliveryGateway?.desktopPermission() ?? 'unsupported';
    new Setting(containerEl)
      .setName('Reminder delivery')
      .setDesc(`V1 reminders are delivered only while Obsidian is running. Desktop permission: ${desktopPermission}. In-Obsidian only is the work-computer default.`)
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

