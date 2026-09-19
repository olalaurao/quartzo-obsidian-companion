import { describe, expect, it } from 'vitest';
import type { ReminderDeliveryOccurrence } from '../src/core/reminders';
import {
  ObsidianReminderDeliveryGateway,
  type DesktopNotificationApi,
} from '../src/platform/notifications';

function occurrence(): ReminderDeliveryOccurrence {
  return {
    key: 'task-1:reminder-1:2026-09-19T10:00:00.000Z',
    sourceId: 'task-1',
    sourceType: 'task',
    sourceTitle: 'Task One',
    occurrenceId: 'task:task-1@2026-09-19',
    reminderId: 'reminder-1',
    triggerAt: new Date('2026-09-19T10:00:00.000Z'),
    notificationType: 'popup',
    notificationBody: 'Do the thing',
    escalationLevel: 0,
  };
}

describe('ObsidianReminderDeliveryGateway', () => {
  it('opens the delivered occurrence target when a desktop notification is clicked', async () => {
    let click: (() => void) | null = null;
    let opened: ReminderDeliveryOccurrence | null = null;
    const api: DesktopNotificationApi = {
      permission: 'granted',
      requestPermission: async () => 'granted',
      create: () => ({
        setOnClick(handler) {
          click = handler;
        },
      }),
    };
    const gateway = new ObsidianReminderDeliveryGateway(
      () => false,
      value => { opened = value; },
      api,
    );
    const value = occurrence();

    await gateway.deliver(value, 'desktop_notifications');
    expect(click).not.toBeNull();
    click?.();
    expect(opened?.sourceId).toBe('task-1');
    expect(opened?.reminderId).toBe('reminder-1');
  });

  it('does not expose sensitive title/body when privacy mode is enabled', async () => {
    let deliveredTitle = '';
    let deliveredBody: string | undefined;
    const api: DesktopNotificationApi = {
      permission: 'granted',
      requestPermission: async () => 'granted',
      create: (title, options) => {
        deliveredTitle = title;
        deliveredBody = options.body;
        return { setOnClick: () => {} };
      },
    };
    const gateway = new ObsidianReminderDeliveryGateway(() => true, () => {}, api);

    await gateway.deliver(occurrence(), 'desktop_notifications');
    expect(deliveredTitle).toBe('Quartzo reminder');
    expect(deliveredBody).toBeUndefined();
  });
});
