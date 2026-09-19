import type { ReminderDeliveryGateway, ReminderMode } from '../core/reminders';
import type { ReminderDeliveryOccurrence } from '../core/reminders/types';

export interface DesktopNotificationLike {
  setOnClick(handler: () => void): void;
}

export interface DesktopNotificationApi {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  create(title: string, options: NotificationOptions): DesktopNotificationLike;
}

function browserNotificationApi(): DesktopNotificationApi | null {
  const NotificationCtor = globalThis.Notification;
  if (typeof NotificationCtor !== 'function') return null;
  return {
    permission: NotificationCtor.permission,
    requestPermission: () => NotificationCtor.requestPermission(),
    create: (title, options) => {
      const notification = new NotificationCtor(title, options);
      return { setOnClick: handler => { notification.onclick = () => handler(); } };
    },
  };
}

export class ObsidianReminderDeliveryGateway implements ReminderDeliveryGateway {
  constructor(
    private readonly isPrivacyMode: () => boolean,
    private readonly openQuartzo: (occurrence: ReminderDeliveryOccurrence) => void,
    private readonly showInObsidianNotice: (message: string) => void,
    private readonly desktopApi: DesktopNotificationApi | null = browserNotificationApi(),
  ) {}

  async requestDesktopPermission(): Promise<boolean> {
    if (!this.desktopApi) return false;
    if (this.desktopApi.permission === 'granted') return true;
    if (this.desktopApi.permission === 'denied') return false;
    return (await this.desktopApi.requestPermission()) === 'granted';
  }

  desktopPermission(): NotificationPermission | 'unsupported' {
    return this.desktopApi?.permission ?? 'unsupported';
  }

  async deliver(occurrence: ReminderDeliveryOccurrence, mode: Exclude<ReminderMode, 'off'>): Promise<void> {
    const privacy = this.isPrivacyMode();
    const title = privacy ? 'Quartzo reminder' : occurrence.sourceTitle;
    const body = privacy ? undefined : occurrence.notificationBody;

    if (mode === 'desktop_notifications' && this.desktopApi?.permission === 'granted') {
      const notification = this.desktopApi.create(title, body ? { body } : {});
      notification.setOnClick(() => this.openQuartzo(occurrence));
      return;
    }

    this.showInObsidianNotice(body ? `${title}: ${body}` : title);
  }
}
