import type { App, Plugin } from 'obsidian';
import type { VaultIndexEngine } from '../vault/index';
import type { DriveSyncCoordinator } from '../sync/coordinator';

export interface UIState {
  currentView: string;
  dailyScheduleDate: string;
  privacyMode: boolean;
}

export interface ViewContext {
  app: App;
  plugin: Plugin & {
    driveSyncCoordinator: DriveSyncCoordinator | null;
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
    disconnectDrive(): Promise<void>;
  };
  state: UIState;
  vaultIndexEngine?: VaultIndexEngine;
  driveSyncCoordinator?: DriveSyncCoordinator;
}
