import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileNotificationDeliveryRegistry } from '../../src/local-state/notification-delivery-registry';

const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('FileNotificationDeliveryRegistry', () => {
  it('persists only device-local delivery keys and restores them after restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quartzo-reminder-registry-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'quartzo-notification-delivery.json');
    const first = new FileNotificationDeliveryRegistry(file);
    await first.load();
    expect(first.has('delivery-a')).toBe(false);
    await first.markDelivered('delivery-a', new Date('2026-09-17T12:00:00.000Z'));

    const second = new FileNotificationDeliveryRegistry(file);
    await second.load();
    expect(second.has('delivery-a')).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(persisted).sort()).toEqual(['deliveries', 'version']);
  });

  it('treats malformed local bookkeeping as disposable instead of touching vault data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quartzo-reminder-registry-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'quartzo-notification-delivery.json');
    fs.writeFileSync(file, '{not-json', 'utf8');
    const registry = new FileNotificationDeliveryRegistry(file);
    await registry.load();
    expect(registry.has('anything')).toBe(false);
  });
});
