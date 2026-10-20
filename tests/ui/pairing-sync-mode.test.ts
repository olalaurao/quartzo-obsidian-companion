import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuartzoCompanionPlugin from '../../src/main';
import type { PairingSummary } from '../../src/sync/coordinator';

// Exercise the actual plugin handlers without an Obsidian session or network.
vi.mock('../../src/platform/browser-opener', () => ({ ElectronBrowserOpener: class {} }));
vi.mock('obsidian', () => ({
  Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, ItemView: class {},
  FuzzySuggestModal: class {}, Setting: class {}, Notice: class {}, Vault: class {},
  TFile: class {}, TFolder: class {}, FileSystemAdapter: class {},
  normalizePath: (value: string) => value,
}));

class Element {
  textContent = '';
  disabled = false;
  style: Record<string, string> = {};
  children: Element[] = [];
  private clicks: (() => unknown)[] = [];
  appendChild(child: Element): Element { this.children.push(child); return child; }
  replaceChildren(): void { this.children = []; }
  addEventListener(event: string, handler: () => unknown): void {
    if (event === 'click') this.clicks.push(handler);
  }
  remove(): void {}
  async click(): Promise<void> { for (const handler of this.clicks) await handler(); }
  find(label: string): Element {
    if (this.textContent === label) return this;
    for (const child of this.children) {
      try { return child.find(label); } catch { /* Continue through siblings. */ }
    }
    throw new Error(`Missing test control: ${label}`);
  }
}

interface PairingViews {
  renderReadyPairingContent(modal: Element, content: Element, folder: string, summary: PairingSummary): void;
  renderBlockedPairingContent(modal: Element, content: Element, folder: string, summary: PairingSummary): void;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { createElement: () => new Element() });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(mode: 'manual' | 'automatic', path: string, failure = false) {
  const summary: PairingSummary = {
    identical: [], remoteOnly: [], localOnly: [], ambiguous: [],
    divergent: path === 'divergent' ? [{
      path: 'ordinary-control.txt', status: 'divergent', localHash: 'local', remoteHash: 'remote',
    }] : [],
  };
  const plugin = Object.create(QuartzoCompanionPlugin.prototype) as QuartzoCompanionPlugin;
  const savedModes: string[] = [];
  const apply = vi.fn(async () => ({ errors: failure ? ['synthetic failure'] : [] }));
  Object.assign(plugin, {
    settings: { syncMode: mode, syncPollingIntervalSeconds: 60, isPaired: false, firstRunCompleted: false },
    driveAdapter: { listQuartzoVaultCandidates: async () => [{ id: 'synthetic-folder', name: 'Synthetic test' }] },
    driveSyncCoordinator: {
      setDriveFolderId: vi.fn(async () => {}),
      generatePairingSummary: vi.fn(async () => summary),
      applyPairingDecisions: apply,
      buildSafeDuplicateTrashPlan: () => ({ resolutions: [], unresolvedPaths: [], totalTrashFiles: 0 }),
      triggerFocusSync: vi.fn(async () => {}),
    },
    saveSettings: vi.fn(async () => { savedModes.push(plugin.settings.syncMode); }),
    refreshQuartzoView: vi.fn(async () => {}),
    renderPairingWorkflowError: vi.fn(),
  });
  async function pair() {
    if (path === 'direct') {
      await plugin.confirmPairing('synthetic-folder', 'Synthetic test', true, false);
    } else {
      const views = plugin as unknown as PairingViews;
      const modal = new Element(), content = new Element();
      if (path === 'ready') {
        views.renderReadyPairingContent(modal, content, 'Synthetic test', summary);
        await content.find('Accept & Pair').click();
      } else {
        views.renderBlockedPairingContent(modal, content, 'Synthetic test', summary);
        await content.find('📱 Keep all local').click();
      }
    }
  }
  return { plugin, pair, savedModes, apply };
}

describe.each(['direct', 'ready', 'divergent'])('pairing sync preference: %s', path => {
  it.each(['manual', 'automatic'] as const)('preserves selected %s mode after successful pairing', async mode => {
    const { plugin, pair, savedModes, apply } = fixture(mode, path);
    await pair();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(plugin.settings.isPaired).toBe(true);
    expect(plugin.authState).toBe('paired');
    expect(plugin.settings.syncMode).toBe(mode);
    expect(savedModes).toEqual([mode]);
    expect(vi.getTimerCount()).toBe(mode === 'manual' ? 0 : 1);
  });

  it('keeps failed manual pairing unpaired without automatic polling', async () => {
    const { plugin, pair, savedModes } = fixture('manual', path, true);
    await pair();
    expect(plugin.settings.isPaired).toBe(false);
    expect(plugin.settings.syncMode).toBe('manual');
    expect(savedModes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
