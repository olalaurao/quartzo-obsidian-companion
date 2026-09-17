import type { BrowserOpener } from '../integrations/google/auth/loopback';

interface ElectronShell {
  openExternal(url: string): Promise<void>;
}

const electron = require('electron') as { shell: ElectronShell };

export class ElectronBrowserOpener implements BrowserOpener {
  async open(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('OAuth authorization URL must use HTTPS');
    }
    await electron.shell.openExternal(parsed.toString());
  }
}
