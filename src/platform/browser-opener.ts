import { shell } from 'electron';
import type { BrowserOpener } from '../integrations/google/auth/loopback';

export class ElectronBrowserOpener implements BrowserOpener {
  async open(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('OAuth authorization URL must use HTTPS');
    }
    await shell.openExternal(parsed.toString());
  }
}
