import type { App, Plugin } from 'obsidian';
import type { VaultIndexEngine } from '../vault/index';
import type { DriveSyncCoordinator, PairingScanProgress } from '../sync/coordinator';
import type { GoogleDriveAdapter } from '../integrations/google/drive';
import type { GoogleCalendarProjection } from '../integrations/google/calendar';
import type { ReminderMode } from '../core/reminders';
import type { NormalizedItem } from '../core/daily_schedule/types';
import type { SafeObjectMutation } from '../core/object-mutation';
import type { IndexedObject } from '../vault/index/types';
import type {
  CanonicalOccurrenceAction,
  CanonicalOccurrenceActionResult,
  OccurrenceResponseState,
} from '../core/occurrence_actions';

export interface UIState {
  currentView: string;
  dailyScheduleDate: string;
  privacyMode: boolean;
}

export interface ViewContext {
  app: App;
  plugin: Plugin & {
    driveSyncCoordinator: DriveSyncCoordinator | null;
    driveAdapter: GoogleDriveAdapter | null;
    calendarStatus: 'disconnected' | 'ready' | 'authorization_required' | 'error';
    authState: 'disconnected' | 'authenticating' | 'authenticated_unpaired' | 'paired' | 'authentication_required';
    vaultIndexEngine: VaultIndexEngine | null;
    settings: {
      googleDriveFolderId: string | null;
      googleDriveFolderName: string | null;
      syncMode: 'manual' | 'automatic';
      syncPollingIntervalSeconds: number;
      hideSensitivePreviews: boolean;
      hideJournalPreviewText: boolean;
      hideNotificationBody: boolean;
      firstRunCompleted: boolean;
      oauthClientId: string;
      isPaired: boolean;
      reminderDelivery: ReminderMode;
    };
    saveSettings(): Promise<void>;
    setSyncMode(mode: 'manual' | 'automatic'): Promise<void>;
    startAutoSync(): void;
    stopAutoSync(): void;
    restartAutoSync(): void;
    startPairingFlow(): Promise<void>;
    reconnectGoogle(): Promise<void>;
    confirmPairing(
      folderId: string,
      folderName: string,
      autoAdopt: boolean,
      autoPull: boolean,
      onProgress?: (progress: PairingScanProgress) => void
    ): Promise<void>;
    reviewSyncRemoteDuplicates(): Promise<void>;
    disconnectDrive(): Promise<void>;
    useWithoutSync(): Promise<void>;
    listGoogleCalendarEvents(startDate: string, days: number): Promise<GoogleCalendarProjection[]>;
    reauthorizeGoogleCalendar(): Promise<void>;
    setReminderDelivery(mode: ReminderMode): Promise<void>;
    getOccurrenceResponses(): Record<string, OccurrenceResponseState>;
    performOccurrenceAction(
      item: NormalizedItem,
      action: CanonicalOccurrenceAction,
      options?: { completedAt?: Date; snoozeMinutes?: number },
    ): Promise<CanonicalOccurrenceActionResult>;
    mutateObject(object: IndexedObject, patch: SafeObjectMutation): Promise<void>;
    adoptFile(filePath: string): Promise<void>;
    openSettings(): void;
  };
  state: UIState;
  vaultIndexEngine?: VaultIndexEngine;
  driveSyncCoordinator?: DriveSyncCoordinator;
}
