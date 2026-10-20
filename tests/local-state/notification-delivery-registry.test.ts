import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileNotificationDeliveryRegistry } from '../../src/local-state/notification-delivery-registry';

const tempDirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    const owned = fs.realpathSync(dir);
    const relative = path.relative(fs.realpathSync(os.tmpdir()), owned);
    expect(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)).toBe(false);
    expect(path.basename(owned).startsWith('quartzo-reminder-registry-')).toBe(true);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(owned, { recursive: true, force: true });
  }
});

describe('FileNotificationDeliveryRegistry', () => {
  it('persists only device-local delivery keys and restores them after restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
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

    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
    const expired = new FileNotificationDeliveryRegistry(file);
    await expired.load();
    expect(expired.has('delivery-a')).toBe(false);
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
