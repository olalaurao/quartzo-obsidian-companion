import { describe, expect, it } from 'vitest';
import { ReminderService, type ReminderDeliveryGateway, type ReminderDeliveryRegistry, type ReminderMode, type ReminderSourceObject } from '../../src/core/reminders';
import type { ReminderDeliveryOccurrence } from '../../src/core/reminders/types';

class MemoryRegistry implements ReminderDeliveryRegistry {
  readonly keys = new Set<string>();
  async load(): Promise<void> {}
  has(key: string): boolean { return this.keys.has(key); }
  async markDelivered(key: string): Promise<void> { this.keys.add(key); }
}

class RecordingGateway implements ReminderDeliveryGateway {
  readonly delivered: ReminderDeliveryOccurrence[] = [];
  failNext = false;
  async deliver(occurrence: ReminderDeliveryOccurrence): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error('delivery failed'); }
    this.delivered.push(occurrence);
  }
}

function at(hour: number, minute: number, second = 0): Date {
  return new Date(2026, 8, 17, hour, minute, second, 0);
}

function object(): ReminderSourceObject {
  return {
    id: 'task', type: 'task', title: 'Ship',
    reminders: [{ id: 'exact', trigger_time: '2026-09-17T09:30:00.000', type: 'popup' }],
  };
}

describe('ReminderService', () => {
  it('delivers one logical occurrence at most once', async () => {
    const registry = new MemoryRegistry();
    const gateway = new RecordingGateway();
    let mode: ReminderMode = 'in_obsidian_only';
    const service = new ReminderService({ getObjects: () => [object()], getMode: () => mode, registry, gateway });
    await service.start(at(9, 29, 59));
    expect(await service.poll(at(9, 30))).toBe(1);
    expect(await service.poll(at(9, 31))).toBe(0);
    expect(gateway.delivered).toHaveLength(1);
    expect(registry.keys.size).toBe(1);
  });

  it('retries a failed delivery window while preserving already-delivered keys', async () => {
    const registry = new MemoryRegistry();
    const gateway = new RecordingGateway();
    gateway.failNext = true;
    const service = new ReminderService({ getObjects: () => [object()], getMode: () => 'in_obsidian_only', registry, gateway });
    await service.start(at(9, 29, 59));
    await expect(service.poll(at(9, 30))).rejects.toThrow('delivery failed');
    expect(await service.poll(at(9, 30, 30))).toBe(1);
    expect(gateway.delivered).toHaveLength(1);
  });

  it('does not replay reminders that passed while delivery was Off', async () => {
    const registry = new MemoryRegistry();
    const gateway = new RecordingGateway();
    let mode: ReminderMode = 'off';
    const service = new ReminderService({ getObjects: () => [object()], getMode: () => mode, registry, gateway });
    await service.start(at(9, 29));
    expect(await service.poll(at(9, 31))).toBe(0);
    mode = 'in_obsidian_only';
    expect(await service.poll(at(9, 32))).toBe(0);
    expect(gateway.delivered).toEqual([]);
  });
});
