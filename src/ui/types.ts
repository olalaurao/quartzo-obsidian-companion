export interface UIState {
  currentView: string;
  dailyScheduleDate: string;
  privacyMode: boolean;
}

export interface ViewContext {
  app: any;
  plugin: any;
  state: UIState;
  vaultIndexEngine?: any;
  driveSyncCoordinator?: any;
}
