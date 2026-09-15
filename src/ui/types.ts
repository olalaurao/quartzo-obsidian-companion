export interface UIState {
  currentView: string;
  dailyScheduleDate: string;
  privacyMode: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ViewContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin: any;
  state: UIState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vaultIndexEngine?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  driveSyncCoordinator?: any;
}
