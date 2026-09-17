import type { App, Plugin } from 'obsidian';
import type { VaultIndexEngine } from '../vault/index';
import type { DriveSyncCoordinator } from '../sync/coordinator';
import type { GoogleDriveAdapter } from '../integrations/google/drive';
import type { GoogleCalendarProjection } from '../integrations/google/calendar';

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
      syncAuto: boolean;
      privacyMode: boolean;
      firstRunCompleted: boolean;
      oauthClientId: string;
      isPaired: boolean;
    };
    saveSettings(): Promise<void>;
    startPairingFlow(): Promise<void>;
    confirmPairing(folderId: string, folderName: string, autoAdopt: boolean, autoPull: boolean): Promise<void>;
    disconnectDrive(): Promise<void>;
    listGoogleCalendarEvents(startDate: string, days: number): Promise<GoogleCalendarProjection[]>;
    reauthorizeGoogleCalendar(): Promise<void>;
    adoptFile(filePath: string): Promise<void>;
    openSettings(): void;
  };
  state: UIState;
  vaultIndexEngine?: VaultIndexEngine;
  driveSyncCoordinator?: DriveSyncCoordinator;
}
