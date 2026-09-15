export interface UIState {
  currentView: string;
  dailyScheduleDate: string;
  privacyMode: boolean;
}

export interface ViewContext {
  app: Record<string, unknown>;
  plugin: Record<string, unknown>;
  state: UIState;
  vaultIndexEngine?: Record<string, unknown>;
  driveSyncCoordinator?: Record<string, unknown>;
}
