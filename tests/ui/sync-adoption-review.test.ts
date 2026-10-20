import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuartzoView } from '../../src/ui/shell/view';
import QuartzoCompanionPlugin from '../../src/main';
import type { SyncPendingDiagnostic, SyncStatusSnapshot } from '../../src/sync/coordinator';

vi.mock('../../src/platform/browser-opener', () => ({ ElectronBrowserOpener: class {} }));
vi.mock('obsidian', () => ({
  Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, ItemView: class {},
  FuzzySuggestModal: class {}, Setting: class {}, Notice: class {}, Vault: class {},
  TFile: class {}, TFolder: class {}, FileSystemAdapter: class {}, getIcon: () => null,
  normalizePath: (value: string) => value,
}));

class Element {
  private text = '';
  private clicks: (() => unknown)[] = [];
  children: Element[] = [];
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  disabled = false;
  isConnected = true;
  className = '';
  title = '';
  constructor(readonly tagName = 'div') {}
  set textContent(value: string) { this.text = value; this.children = []; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child: Element): Element { this.children.push(child); return child; }
  append(...children: Element[]): void { this.children.push(...children); }
  setAttribute(key: string, value: string): void { this.attributes[key] = value; }
  createEl(tag: string, options?: { text?: string; cls?: string }): Element {
    const element = new Element(tag);
    element.textContent = options?.text ?? '';
    element.className = options?.cls ?? '';
    return this.appendChild(element);
  }
  addEventListener(event: string, handler: () => unknown): void { if (event === 'click') this.clicks.push(handler); }
  async click(): Promise<void> { if (!this.disabled) for (const handler of this.clicks) await handler(); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
  button(label: string): Element {
    const button = this.all().find(element => element.tagName === 'button' && element.textContent === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    return button;
  }
}

interface TestView {
  renderSync(container: Element, conflictsOnly: boolean, generation: number): Promise<void>;
  render(): Promise<void>;
  renderGeneration: number;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  vi.stubGlobal('navigator', { onLine: true, clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture() {
  const file = 'notes/a: b.bin';
  let pending: SyncPendingDiagnostic[] = [{ path: file, reason: 'adoption_required' }];
  let busy = false;
  let lastError: string | null = null;
  const snapshot = (): SyncStatusSnapshot => ({
    status: busy ? 'syncing' : lastError ? 'error' : pending.length ? 'local_changes' : 'synced',
    pendingLocalChanges: pending.length, pendingDiagnostics: pending,
    conflictCount: 0, lastError, lastSuccessfulSyncAt: null,
  });
  const coordinator = {
    getSyncStatusSnapshot: vi.fn(async () => snapshot()), getConflicts: () => [],
    getRemoteIdentityAmbiguityPaths: () => [], getSyncProgress: () => null,
    triggerManualSync: vi.fn(async () => ({ synced: 0, conflicts: 0, errors: [] })),
    triggerFullReconciliation: vi.fn(async () => ({ synced: 0, conflicts: 0, errors: [] })),
    explicitAdopt: vi.fn(async () => { pending = []; }),
  };
  const plugin = Object.assign(Object.create(QuartzoCompanionPlugin.prototype), {
    driveSyncCoordinator: coordinator, authState: 'paired', manifest: { version: 'synthetic-test' },
    settings: { syncMode: 'manual', isPaired: true, googleDriveFolderId: 'synthetic-root', googleDriveFolderName: 'Synthetic test vault' },
  });
  let root = new Element();
  const view = Object.assign(Object.create(QuartzoView.prototype), {
    context: { plugin }, renderGeneration: 0, syncActionReport: null, syncProgressTickerId: null,
  }) as TestView;
  // Keep the actual Sync Center and actual plugin adoption handler. The shell's
  // other tabs/platform DOM and the coordinator boundary are outside this test.
  view.render = async () => { root = new Element(); await view.renderSync(root, false, ++view.renderGeneration); };
  return { file, coordinator, plugin, view, root: () => root,
    busy: () => { busy = true; }, clearPending: () => { pending = []; },
    failSnapshot: () => { lastError = 'synthetic persisted coordinator blocker'; } };
}

describe('actual Sync Center adoption and pending feedback', () => {
  it('shows the exact pending path including colons separately from its reason', async () => {
    const f = fixture(); await f.view.render();
    expect(f.root().all().some(element => element.tagName === 'span' && element.textContent === f.file)).toBe(true);
    expect(f.root().textContent).not.toContain('All files are in sync');
  });

  it('does not report clean success when an incremental pass leaves adoption pending', async () => {
    const f = fixture(); await f.view.render();
    await f.root().button('☁ Sync now').click();
    await vi.waitFor(() => expect(f.root().textContent).toContain('1 pending. Review pending files'));
    expect(f.root().textContent).toContain('Needs review');
    expect(f.root().textContent).not.toContain('No follow-up needed');
  });

  it('requires review then explicit adoption, calls the existing handler, and retains a visible result', async () => {
    const f = fixture(); await f.view.render();
    await f.root().button('Review adoption').click();
    expect(f.coordinator.explicitAdopt).not.toHaveBeenCalled();
    expect(f.root().textContent).toContain('Synthetic test vault');
    await f.root().button('Adopt file').click();
    await vi.waitFor(() => expect(f.root().textContent).toContain('File adopted'));
    expect(f.coordinator.explicitAdopt).toHaveBeenCalledTimes(1);
    expect(f.coordinator.explicitAdopt).toHaveBeenCalledWith(f.file);
    expect(f.root().textContent).toContain('File adopted');
    expect(f.root().textContent).toContain('verified baseline');
    expect(f.root().button('Copy diagnostics')).toBeDefined();
    expect(f.plugin.settings.syncMode).toBe('manual');
  });

  it('keeps an adoption failure visible and the path available for another review', async () => {
    const f = fixture();
    f.coordinator.explicitAdopt.mockRejectedValueOnce(new Error('synthetic upload body failed verification'));
    await f.view.render(); await f.root().button('Review adoption').click();
    await f.root().button('Adopt file').click();
    await vi.waitFor(() => expect(f.root().textContent).toContain('Adoption failed'));
    expect(f.root().textContent).toContain('synthetic upload body failed verification');
    expect(f.root().button('Review adoption').disabled).toBe(false);
    expect(f.root().button('Copy diagnostics')).toBeDefined();
  });

  it('refuses to apply a review to a different paired vault', async () => {
    const f = fixture(); await f.view.render(); await f.root().button('Review adoption').click();
    f.plugin.settings.googleDriveFolderId = 'other-synthetic-root';
    await f.root().button('Adopt file').click();
    await vi.waitFor(() => expect(f.root().textContent).toContain('paired vault changed'));
    expect(f.coordinator.explicitAdopt).not.toHaveBeenCalled();
    expect(f.root().textContent).toContain('paired vault changed');
  });

  it.each(['offline', 'busy'])('disables adoption review when %s', async condition => {
    const f = fixture();
    if (condition === 'offline') vi.stubGlobal('navigator', { onLine: false }); else f.busy();
    await f.view.render();
    expect(f.root().button('Review adoption').disabled).toBe(true);
  });

  it('reports a clean successful pass only when the fresh coordinator snapshot has no pending paths', async () => {
    const f = fixture(); await f.view.render(); f.clearPending();
    await f.root().button('☁ Sync now').click();
    await vi.waitFor(() => expect(f.root().textContent).toContain('0 pending. No follow-up needed'));
    expect(f.root().textContent).toContain('Success');
  });

  it('keeps a fresh coordinator error visible even when the pass result has no file errors', async () => {
    const f = fixture(); await f.view.render(); f.clearPending(); f.failSnapshot();
    await f.root().button('☁ Sync now').click();
    await vi.waitFor(() => expect(f.root().textContent).toContain('1 errors, 0 pending'));
    expect(f.root().textContent).not.toContain('No follow-up needed');
    expect(f.root().textContent).toContain('synthetic persisted coordinator blocker');
  });
});
