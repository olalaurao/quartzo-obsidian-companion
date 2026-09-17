import { ReminderProjectionEngine } from './projection';
import type { ReminderDeliveryOccurrence, ReminderSourceObject } from './types';

export type ReminderMode = 'off' | 'in_obsidian_only' | 'desktop_notifications';

export interface ReminderDeliveryRegistry {
  load(): Promise<void>;
  has(key: string): boolean;
  markDelivered(key: string, deliveredAt: Date): Promise<void>;
}

export interface ReminderDeliveryGateway {
  deliver(occurrence: ReminderDeliveryOccurrence, mode: Exclude<ReminderMode, 'off'>): Promise<void>;
}

export interface ReminderServiceOptions {
  getObjects(): ReminderSourceObject[];
  getMode(): ReminderMode;
  registry: ReminderDeliveryRegistry;
  gateway: ReminderDeliveryGateway;
}

export class ReminderService {
  private lastCheckedAt: Date | null = null;
  private pollInFlight = false;
  private started = false;

  constructor(private readonly options: ReminderServiceOptions) {}

  async start(now = new Date()): Promise<void> {
    if (this.started) return;
    await this.options.registry.load();
    this.started = true;
    this.lastCheckedAt = new Date(now.getTime());
  }

  stop(): void {
    this.started = false;
    this.lastCheckedAt = null;
    this.pollInFlight = false;
  }

  resetWindow(now = new Date()): void {
    this.lastCheckedAt = new Date(now.getTime());
  }

  async poll(now = new Date()): Promise<number> {
    if (!this.started || this.pollInFlight) return 0;
    const previous = this.lastCheckedAt;
    if (!previous || Number.isNaN(now.getTime()) || now <= previous) {
      this.lastCheckedAt = new Date(now.getTime());
      return 0;
    }

    const mode = this.options.getMode();
    if (mode === 'off') {
      this.lastCheckedAt = new Date(now.getTime());
      return 0;
    }

    this.pollInFlight = true;
    try {
      const due = ReminderProjectionEngine.projectWindow(this.options.getObjects(), previous, now);
      let delivered = 0;
      for (const occurrence of due) {
        if (this.options.registry.has(occurrence.key)) continue;
        await this.options.gateway.deliver(occurrence, mode);
        await this.options.registry.markDelivered(occurrence.key, now);
        delivered += 1;
      }
      this.lastCheckedAt = new Date(now.getTime());
      return delivered;
    } finally {
      this.pollInFlight = false;
    }
  }

  isActive(): boolean {
    return this.started && this.options.getMode() !== 'off';
  }
}
