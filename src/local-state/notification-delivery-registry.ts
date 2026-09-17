import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReminderDeliveryRegistry } from '../core/reminders';

interface RegistryFile {
  version: 1;
  deliveries: Record<string, string>;
}

const MAX_ENTRIES = 2048;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class FileNotificationDeliveryRegistry implements ReminderDeliveryRegistry {
  private readonly delivered = new Map<string, string>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.delivered.clear();
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      if (parsed.version !== 1 || parsed.deliveries == null || typeof parsed.deliveries !== 'object' || Array.isArray(parsed.deliveries)) return;
      for (const [key, deliveredAt] of Object.entries(parsed.deliveries)) {
        if (typeof deliveredAt === 'string' && !Number.isNaN(Date.parse(deliveredAt))) this.delivered.set(key, deliveredAt);
      }
      this.prune(new Date());
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }

  has(key: string): boolean {
    return this.delivered.has(key);
  }

  async markDelivered(key: string, deliveredAt: Date): Promise<void> {
    if (!this.loaded) await this.load();
    this.delivered.set(key, deliveredAt.toISOString());
    this.prune(deliveredAt);
    const snapshot = this.snapshot();
    this.writeChain = this.writeChain.then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(temp, JSON.stringify(snapshot), 'utf8');
      await fs.promises.rename(temp, this.filePath);
    });
    await this.writeChain;
  }

  private prune(now: Date): void {
    const cutoff = now.getTime() - RETENTION_MS;
    const entries = [...this.delivered.entries()]
      .filter(([, deliveredAt]) => Date.parse(deliveredAt) >= cutoff)
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .slice(0, MAX_ENTRIES);
    this.delivered.clear();
    for (const [key, deliveredAt] of entries) this.delivered.set(key, deliveredAt);
  }

  private snapshot(): RegistryFile {
    return { version: 1, deliveries: Object.fromEntries(this.delivered) };
  }
}
