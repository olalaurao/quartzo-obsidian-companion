import { Notice } from 'obsidian';
import { OccurrenceActionService } from '../occurrence_actions';
import { DailyScheduleEngine } from '../daily_schedule';
import { VaultIndexEngine } from '../../vault/index';

export type ReminderMode = 'off' | 'in_obsidian_only' | 'desktop_notifications';

export interface ReminderConfig {
  mode: ReminderMode;
  soundEnabled: boolean;
  leadTimeMinutes: number;
}

export class ReminderService {
  private config: ReminderConfig;
  private actionService: OccurrenceActionService;
  private checkInterval: NodeJS.Timeout | null = null;
  private vaultAdapter: { read: (path: string) => Promise<string>; write: (path: string, content: string) => Promise<void>; list: (path: string) => Promise<string[]> };
  private vaultIndex: VaultIndexEngine | null = null;
  private isRunning: boolean = false;

  constructor(actionService: OccurrenceActionService, vaultAdapter: { read: (path: string) => Promise<string>; write: (path: string, content: string) => Promise<void>; list: (path: string) => Promise<string[]> }, vaultIndex?: VaultIndexEngine, config?: Partial<ReminderConfig>) {
    this.actionService = actionService;
    this.vaultAdapter = vaultAdapter;
    this.vaultIndex = vaultIndex || null;
    this.config = {
      mode: 'in_obsidian_only',
      soundEnabled: false,
      leadTimeMinutes: 5,
      ...config
    };
  }

  start(): void {
    if (this.isRunning) {
      console.warn('Reminder service already running');
      return;
    }

    if (this.config.mode === 'off') {
      console.log('Reminder service is disabled');
      return;
    }

    this.isRunning = true;
    
    // Check every minute for due reminders
    this.checkInterval = setInterval(() => {
      this.checkReminders();
    }, 60 * 1000);

    console.log('Reminder service started (In Obsidian only mode)');
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Reminder service stopped');
  }

  private async checkReminders(): Promise<void> {
    if (!this.isRunning || this.config.mode === 'off') {
      return;
    }

    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

      // Get objects from vault index
      let objects: Record<string, unknown>[] = [];
      if (this.vaultIndex) {
        const index = this.vaultIndex.getIndex();
        if (index) {
          objects = Array.from(index.objects.values()).map(obj => ({
            id: obj.id,
            type: obj.type,
            frontmatter: obj.frontmatter,
            body: obj.body
          }));
        }
      }

      // Get today's schedule
      const schedule = DailyScheduleEngine.normalize({
        date: today,
        today,
        objects,
        googleEvents: []
      });

      // Check for due reminders (items with reminderId are reminders)
      for (const item of schedule.items) {
        if (item.reminderId && item.start) {
          const reminderTime = item.start;
          
          // Check if reminder is due (within lead time)
          if (this.isReminderDue(reminderTime, currentTime, this.config.leadTimeMinutes)) {
            await this.triggerReminder(item);
          }
        }
      }
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  private isReminderDue(reminderTime: string, currentTime: string, leadTimeMinutes: number): boolean {
    const [reminderHours, reminderMinutes] = reminderTime.split(':').map(Number);
    const [currentHours, currentMinutes] = currentTime.split(':').map(Number);

    const reminderTotalMinutes = reminderHours * 60 + reminderMinutes;
    const currentTotalMinutes = currentHours * 60 + currentMinutes;

    // Trigger if current time is within lead time window of reminder time
    return currentTotalMinutes >= reminderTotalMinutes - leadTimeMinutes && 
           currentTotalMinutes <= reminderTotalMinutes;
  }

  private async triggerReminder(item: { sourceId: string }): Promise<void> {
    const message = `Reminder: ${item.sourceId}`;
    
    if (this.config.mode === 'in_obsidian_only') {
      // Show Obsidian notice
      new Notice(message);
    } else if (this.config.mode === 'desktop_notifications') {
      // In production, this would use system notification API
      // For now, fall back to Obsidian notice
      new Notice(message);
    }

    // Play sound if enabled
    if (this.config.soundEnabled) {
      this.playNotificationSound();
    }

    console.log(`Reminder triggered: ${item.sourceId}`);
  }

  private playNotificationSound(): void {
    // In production, this would play a notification sound
    // For now, just log
    console.log('Playing notification sound');
  }

  async snoozeReminder(occurrenceId: string, objectPath?: string, minutes: number = 5): Promise<void> {
    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const today = new Date().toISOString().split('T')[0];
    
    await this.actionService.executeAction({
      action: 'snooze',
      occurrenceId,
      date: today,
      target: 'reminder',
      objectPath
    });

    new Notice(`Reminder snoozed for ${minutes} minutes`);
  }

  async dismissReminder(occurrenceId: string, objectPath?: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    await this.actionService.executeAction({
      action: 'dismiss',
      occurrenceId,
      date: today,
      target: 'reminder',
      objectPath
    });

    new Notice('Reminder dismissed');
  }

  async completeReminder(occurrenceId: string, objectPath?: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    await this.actionService.executeAction({
      action: 'done',
      occurrenceId,
      date: today,
      target: 'reminder',
      objectPath
    });

    new Notice('Reminder marked as done');
  }

  setConfig(config: Partial<ReminderConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart if mode changed
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  getConfig(): ReminderConfig {
    return { ...this.config };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
