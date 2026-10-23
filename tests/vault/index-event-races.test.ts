import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { VaultIndexEngine, type VaultFile } from '../../src/vault/index';
import { parseObjectWithSharedSettings, parseSharedSettings, type QuartzoSharedSettings } from '../../src/core/shared-settings';

// Execute the actual registered index callbacks, with controlled SDK reads.
// This does not load Obsidian, OAuth, Drive, a user vault or the whole plugin.
const source = ts.createSourceFile('main.ts', readFileSync(resolve('src/main.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const pluginClass = source.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'QuartzoCompanionPlugin') as ts.ClassDeclaration;
const methods = ['registerVaultEvents', 'initializeVaultIndex', 'initializeVaultRuntime', 'reloadVaultIndexFromCommand',
  'reloadSharedSettingsAndIndex'];
const methodSource = methods.map(name => pluginClass.members.find(member => ts.isMethodDeclaration(member)
  && member.name.getText(source) === name)!.getText(source)).join('\n');
const compiled = ts.transpileModule(`class EventFixture { ${methodSource} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class SyntheticFile {
  stat = { mtime: 1, size: 1 };
  constructor(public path: string) {}
}
type Handler = (file: SyntheticFile, oldPath?: string) => void;
interface PendingRead {
  file: SyntheticFile;
  resolve: (content: string) => void;
  reject: (error: Error) => void;
}
interface EventFixture {
  registerVaultEvents(): void;
  initializeVaultIndex(): Promise<number | undefined>;
  initializeVaultRuntime(): Promise<void>;
  reloadVaultIndexFromCommand(): Promise<void>;
  reloadSharedSettingsAndIndex(): Promise<number | undefined>;
  vaultIndexEngine: VaultIndexEngine;
  unloaded: boolean;
  sharedSettings: QuartzoSharedSettings | null;
  vaultRuntimeReady: boolean;
  sharedSettingsReloadInFlight: boolean;
  sharedSettingsReloadRequested: boolean;
  vaultIndexEventsVersion: number;
}
const notices: string[] = [];
const warnings: unknown[][] = [];
const FixtureClass = new Function('dependencies', `const {
  VaultIndexEngine,parseObjectWithSharedSettings,TFile,normalizeVaultPath,
  SHARED_SETTINGS_PATH,SHARED_OCCURRENCE_STATE_PATH,SHARED_PLANNING_STATE_PATH,
  FOCUS_RUNTIME_PATH,VaultSyncFilePolicy,Notice,console
} = dependencies; ${compiled}; return EventFixture;`)({
  VaultIndexEngine, parseObjectWithSharedSettings, TFile: SyntheticFile,
  normalizeVaultPath: (path: string) => path.replace(/\\/g, '/'),
  SHARED_SETTINGS_PATH: 'app/quartzo_shared_settings.md',
  SHARED_OCCURRENCE_STATE_PATH: 'app/occurrences.md',
  SHARED_PLANNING_STATE_PATH: 'app/planning.md', FOCUS_RUNTIME_PATH: 'sessions/current.md',
  VaultSyncFilePolicy: { shouldSyncFile: () => false },
  Notice: class { constructor(message: string) { notices.push(message); } },
  console: { warn: (...values: unknown[]) => { warnings.push(values); }, error: () => {} },
}) as new () => EventFixture;

function markdown(id: string, title = id): string {
  return `---\nid: ${id}\ntype: resource\ntitle: ${title}\n---\nKeep [[tag]]\n`;
}
function initialFile(path: string, id: string): VaultFile {
  const content = markdown(id);
  return { path, content, modified: 1, size: content.length };
}
const flush = () => new Promise<void>(done => setImmediate(done));

function harness(initial: VaultFile[] = []) {
  notices.length = 0;
  warnings.length = 0;
  const engine = new VaultIndexEngine();
  engine.setIndex(VaultIndexEngine.createInitialIndex(initial,
    (content, path) => parseObjectWithSharedSettings(content, path, null)));
  const handlers = new Map<string, Handler[]>();
  const liveFiles = new Map(initial.map(file => [file.path, new SyntheticFile(file.path)]));
  const reads: PendingRead[] = [];
  const plugin: EventFixture = Object.assign(new FixtureClass(), {
    unloaded: false, vaultIndexEngine: engine, eventRefs: [], sharedSettings: null,
    vaultRuntimeReady: true, vaultEventsRegistered: true,
    sharedSettingsReloadInFlight: false, sharedSettingsReloadRequested: false,
    vaultIndexEventsVersion: 0,
    settings: { isPaired: false },
    shouldIndexPath: (path: string) => path.endsWith('.md') && !path.startsWith('app/'),
    reloadSharedSettingsAndIndex: async () => 0,
    reloadFocusRuntime: async () => {}, refreshQuartzoView: async () => {},
    migrateGoogleConnections: async () => {}, restoreCalendarConnection: async () => {},
    app: { vault: {
      getAbstractFileByPath: (path: string) => liveFiles.get(path) ?? null,
      getMarkdownFiles: () => [...liveFiles.values()],
      on: (name: string, callback: Handler) => {
        handlers.set(name, [...(handlers.get(name) ?? []), callback]);
        return callback;
      },
      read: (file: SyntheticFile) => new Promise<string>((resolveRead, reject) => {
        reads.push({ file, resolve: resolveRead, reject });
      }),
    } },
  });
  plugin.registerVaultEvents();
  return { engine, plugin, reads, liveFiles, notices, warnings,
    emit: (name: string, file: SyntheticFile, oldPath?: string) => {
      if (name === 'delete') liveFiles.delete(file.path);
      else {
        if (name === 'rename' && oldPath) liveFiles.delete(oldPath);
        liveFiles.set(file.path, file);
      }
      for (const handler of handlers.get(name) ?? []) handler(file, oldPath);
    },
  };
}

describe('actual Vault index event callbacks with interleaved reads', () => {
  it.each([false, true])('retains distinct creates in either completion order (reverse=%s)', async reverse => {
    const h = harness();
    h.emit('create', new SyntheticFile('resources/a.md'));
    h.emit('create', new SyntheticFile('resources/b.md'));
    const reads = reverse ? [1, 0] : [0, 1];
    for (const index of reads) {
      h.reads[index].resolve(markdown(index === 0 ? 'a' : 'b'));
      await flush();
    }
    expect([...h.engine.getIndex()!.objects.keys()].sort()).toEqual(['a', 'b']);
  });

  it('does not restore an unrelated deleted file when a modification finishes', async () => {
    const h = harness([initialFile('resources/a.md', 'a'), initialFile('resources/b.md', 'b')]);
    h.emit('modify', new SyntheticFile('resources/a.md'));
    h.emit('delete', new SyntheticFile('resources/b.md'));
    h.reads[0].resolve(markdown('a', 'Updated'));
    await flush();
    expect([...h.engine.getIndex()!.objects.keys()]).toEqual(['a']);
    expect(h.engine.getIndex()!.files.has('resources/b.md')).toBe(false);
  });

  it('keeps duplicate-ID review when concurrent creates complete', async () => {
    const h = harness();
    h.emit('create', new SyntheticFile('resources/a.md'));
    h.emit('create', new SyntheticFile('resources/b.md'));
    h.reads[0].resolve(markdown('same'));
    await flush();
    h.reads[1].resolve(markdown('same'));
    await flush();
    expect(h.engine.getIndex()!.objects.has('same')).toBe(false);
    expect(h.engine.getIndex()!.identityConflicts?.get('same')).toHaveLength(2);
  });

  it('suppresses an older modification finishing after the latest one', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const file = new SyntheticFile('resources/a.md');
    h.emit('modify', file);
    h.emit('modify', file);
    h.reads[1].resolve(markdown('a', 'Latest'));
    await flush();
    h.reads[0].resolve(markdown('a', 'Old'));
    await flush();
    expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Latest');
  });

  it('does not resurrect a deleted file from its pending read', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const file = new SyntheticFile('resources/a.md');
    h.emit('modify', file);
    h.emit('delete', file);
    h.reads[0].resolve(markdown('a'));
    await flush();
    expect(h.engine.getIndex()!.files.size).toBe(0);
    expect(h.engine.getIndex()!.objects.size).toBe(0);
  });

  it.each(['reject', 'malformed'])('retains a concurrent create after a rename read fails (%s)', async failure => {
    const h = harness([initialFile('resources/old.md', 'a')]);
    h.emit('rename', new SyntheticFile('resources/new.md'), 'resources/old.md');
    h.emit('create', new SyntheticFile('resources/b.md'));
    h.reads[1].resolve(markdown('b'));
    await flush();
    if (failure === 'reject') h.reads[0].reject(new Error('synthetic read failure'));
    else h.reads[0].resolve('---\nbroken: [\n---');
    await flush();
    expect([...h.engine.getIndex()!.objects.keys()]).toEqual(['b']);
    expect(h.engine.getIndex()!.files.has('resources/old.md')).toBe(false);
  });

  it('keeps a concurrent deletion after a successful rename read', async () => {
    const h = harness([initialFile('resources/old.md', 'a'), initialFile('resources/b.md', 'b')]);
    h.emit('rename', new SyntheticFile('resources/new.md'), 'resources/old.md');
    h.emit('delete', new SyntheticFile('resources/b.md'));
    h.reads[0].resolve(markdown('a'));
    await flush();
    expect([...h.engine.getIndex()!.files.keys()]).toEqual(['resources/new.md']);
  });

  it('retires the old path even when a later modification supersedes the pending rename read', async () => {
    const h = harness([initialFile('resources/old.md', 'a')]);
    const file = new SyntheticFile('resources/new.md');
    h.emit('rename', file, 'resources/old.md');
    h.emit('modify', file);
    h.reads[1].resolve(markdown('a', 'Latest'));
    await flush();
    h.reads[0].resolve(markdown('a', 'Old rename read'));
    await flush();
    expect([...h.engine.getIndex()!.files.keys()]).toEqual(['resources/new.md']);
    expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Latest');
    expect(h.engine.getIndex()!.identityConflicts?.size).toBe(0);
  });

  it('rejects a former file object even if its path is reused without its delete callback', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    h.emit('modify', new SyntheticFile('resources/a.md'));
    h.emit('modify', new SyntheticFile('resources/a.md'));
    h.reads[1].resolve(markdown('replacement'));
    await flush();
    h.reads[0].resolve(markdown('a'));
    await flush();
    expect([...h.engine.getIndex()!.objects.keys()]).toEqual(['replacement']);
  });

  it('suppresses pending reads after a rename into shared settings', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const file = new SyntheticFile('resources/a.md');
    h.emit('modify', file);
    file.path = 'app/quartzo_shared_settings.md';
    h.emit('rename', file, 'resources/a.md');
    const before = h.engine.getIndex();
    h.reads[0].resolve(markdown('a'));
    await flush();
    expect(h.engine.getIndex()).toBe(before);
  });

  it('does not publish to a replaced engine or after plugin unload', async () => {
    for (const action of ['replace', 'unload']) {
      const h = harness();
      h.emit('create', new SyntheticFile('resources/a.md'));
      const replacement = new VaultIndexEngine();
      replacement.setIndex(VaultIndexEngine.createInitialIndex([]));
      if (action === 'replace') h.plugin.vaultIndexEngine = replacement;
      else h.plugin.unloaded = true;
      h.reads[0].resolve(markdown('a'));
      await flush();
      expect(h.engine.getIndex()!.objects.size).toBe(0);
      expect(replacement.getIndex()!.objects.size).toBe(0);
    }
  });
});

describe('actual full Vault index rebuild with interleaved work', () => {
  it('invalidates a full observation as soon as an event arrives, before its read completes', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const before = h.engine.getIndex();
    const rebuild = h.plugin.initializeVaultIndex();
    h.emit('modify', h.liveFiles.get('resources/a.md')!);
    h.reads[0].resolve(markdown('a', 'Old full observation'));
    await flush();
    expect(h.engine.getIndex()).toBe(before);
    expect(h.reads).toHaveLength(3);
    h.reads[1].resolve(markdown('a', 'Latest'));
    await flush();
    h.reads[2].resolve(markdown('a', 'Latest'));
    await flush();
    expect(h.reads).toHaveLength(4);
    h.reads[3].resolve(markdown('a', 'Latest'));
    await rebuild;
    expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Latest');
  });

  it('retries instead of overwriting a completed incremental edit', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const rebuild = h.plugin.initializeVaultIndex();
    h.emit('modify', h.liveFiles.get('resources/a.md')!);
    h.reads[1].resolve(markdown('a', 'Latest'));
    await flush();
    h.reads[0].resolve(markdown('a', 'Old rebuild'));
    await flush();
    expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Latest');
    expect(h.reads).toHaveLength(3);
    h.reads[2].resolve(markdown('a', 'Latest'));
    await rebuild;
    expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Latest');
  });

  it('does not restore a file deleted while the full read was pending', async () => {
    const h = harness([initialFile('resources/a.md', 'a'), initialFile('resources/b.md', 'b')]);
    const rebuild = h.plugin.initializeVaultIndex();
    h.emit('delete', h.liveFiles.get('resources/b.md')!);
    h.reads[0].resolve(markdown('a'));
    h.reads[1].resolve(markdown('b'));
    await flush();
    expect(h.engine.getIndex()!.objects.has('b')).toBe(false);
    expect(h.reads).toHaveLength(3);
    h.reads[2].resolve(markdown('a'));
    await rebuild;
    expect([...h.engine.getIndex()!.objects.keys()]).toEqual(['a']);
  });

  it('rechecks file identity, rename and metadata without requiring an incremental callback', async () => {
    for (const mutation of ['replace', 'rename', 'metadata']) {
      const h = harness([initialFile('resources/a.md', 'a')]);
      const rebuild = h.plugin.initializeVaultIndex();
      const original = h.liveFiles.get('resources/a.md')!;
      if (mutation === 'replace') h.liveFiles.set(original.path, new SyntheticFile(original.path));
      if (mutation === 'rename') {
        h.liveFiles.delete(original.path);
        original.path = 'resources/new.md';
        h.liveFiles.set(original.path, original);
      }
      if (mutation === 'metadata') original.stat.mtime++;
      h.reads[0].resolve(markdown('a', 'Old'));
      await flush();
      expect(h.reads).toHaveLength(2);
      h.reads[1].resolve(markdown('a', 'Current'));
      await rebuild;
      expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Current');
      expect(h.engine.getIndex()!.objects.get('a')?.path).toBe(original.path);
    }
  });

  it('includes a newly listed file after retrying the observed roster', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const rebuild = h.plugin.initializeVaultIndex();
    h.liveFiles.set('resources/b.md', new SyntheticFile('resources/b.md'));
    h.reads[0].resolve(markdown('a'));
    await flush();
    expect(h.reads).toHaveLength(3);
    h.reads[1].resolve(markdown('a'));
    h.reads[2].resolve(markdown('b'));
    await rebuild;
    expect([...h.engine.getIndex()!.objects.keys()].sort()).toEqual(['a', 'b']);
  });

  it('restarts against the current shared settings instead of mixing settings generations', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const rebuild = h.plugin.initializeVaultIndex();
    h.plugin.sharedSettings = parseSharedSettings('---\ntype: quartzo_shared_settings\nschema_version: 1\n---\n')!;
    expect(h.plugin.sharedSettings).not.toBeNull();
    h.reads[0].resolve(markdown('a', 'Old'));
    await flush();
    expect(h.reads).toHaveLength(2);
    h.reads[1].resolve(markdown('a', 'Current'));
    await rebuild;
    expect(h.engine.getIndex()!.objects.get('a')?.frontmatter.title).toBe('Current');
  });

  it('never publishes into a replaced engine', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const oldSnapshot = h.engine.getIndex();
    const rebuild = h.plugin.initializeVaultIndex();
    const replacement = new VaultIndexEngine();
    const snapshot = VaultIndexEngine.createInitialIndex([]);
    replacement.setIndex(snapshot);
    h.plugin.vaultIndexEngine = replacement;
    h.reads[0].resolve(markdown('a'));
    await rebuild;
    expect(replacement.getIndex()).toBe(snapshot);
    expect(h.engine.getIndex()).toBe(oldSnapshot);
  });

  it('bounds retries and preserves the last usable snapshot during continuous edits', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const before = h.engine.getIndex();
    const rebuild = h.plugin.initializeVaultIndex();
    const observed = rebuild.then(() => null, error => error as Error);
    for (let attempt = 0; attempt < 3; attempt++) {
      h.liveFiles.get('resources/a.md')!.stat.mtime++;
      h.reads[attempt].resolve(markdown('a', 'Unstable'));
      await flush();
    }
    expect(h.reads).toHaveLength(3);
    expect(await observed).toBeInstanceOf(Error);
    expect(h.engine.getIndex()).toBe(before);
  });

  it('preserves an existing index when initial bootstrap cannot complete a rebuild', async () => {
    const h = harness([initialFile('resources/a.md', 'a')]);
    const before = h.engine.getIndex();
    h.plugin.vaultRuntimeReady = false;
    h.plugin.initializeVaultIndex = async () => { throw new Error('synthetic unstable rebuild'); };
    await h.plugin.initializeVaultRuntime();
    expect(h.engine.getIndex()).toBe(before);
    expect(h.plugin.vaultRuntimeReady).toBe(true);
    expect(h.notices.some(message => message.includes('Reload vault index'))).toBe(true);
  });

  it('keeps partial-read warnings free of raw filesystem error paths', async () => {
    const h = harness([initialFile('resources/a.md', 'a'), initialFile('resources/b.md', 'b')]);
    const rebuild = h.plugin.initializeVaultIndex();
    h.reads[0].resolve(markdown('a'));
    h.reads[1].reject(new Error('private/path/do-not-log.md'));
    await rebuild;
    expect([...h.engine.getIndex()!.objects.keys()]).toEqual(['a']);
    expect(h.notices.some(message => message.includes('1 unreadable'))).toBe(true);
    expect(JSON.stringify(h.warnings)).not.toContain('private/path');
  });
});

describe('explicit vault-index reload command', () => {
  it('handles a shared-settings event reload rejection without exposing raw errors', async () => {
    const h = harness();
    h.plugin.reloadSharedSettingsAndIndex = async () => { throw new Error('private/path.md'); };
    h.emit('modify', new SyntheticFile('app/quartzo_shared_settings.md'));
    await flush();
    expect(h.notices.join(' ')).toContain('index reload failed');
    expect(h.notices.join(' ')).not.toContain('private/path');
    expect(h.reads).toEqual([]);
  });

  it('does not start before readiness or during an existing shared-settings reload', async () => {
    const h = harness();
    let calls = 0;
    h.plugin.reloadSharedSettingsAndIndex = async () => { calls++; return 0; };
    h.plugin.vaultRuntimeReady = false;
    await h.plugin.reloadVaultIndexFromCommand();
    h.plugin.vaultRuntimeReady = true;
    h.plugin.sharedSettingsReloadInFlight = true;
    await h.plugin.reloadVaultIndexFromCommand();
    expect(calls).toBe(0);
    expect(h.notices.join(' ')).toContain('still loading');
    expect(h.notices.join(' ')).toContain('already in progress');
  });

  it('announces success only after the existing reload owner finishes', async () => {
    const h = harness();
    let done!: (value: number) => void;
    h.plugin.reloadSharedSettingsAndIndex = () => new Promise<number>(resolve => { done = resolve; });
    const command = h.plugin.reloadVaultIndexFromCommand();
    expect(h.notices).toEqual([]);
    done(0);
    await command;
    expect(h.notices).toEqual(['Quartzo vault index reloaded.']);
  });

  it('shows a fixed retryable failure and suppresses late notices after unload', async () => {
    const h = harness();
    h.plugin.reloadSharedSettingsAndIndex = async () => { throw new Error('private/path.md'); };
    await h.plugin.reloadVaultIndexFromCommand();
    expect(h.notices.join(' ')).toContain('Existing entries were kept');
    expect(h.notices.join(' ')).not.toContain('private/path');
    h.notices.length = 0;
    h.plugin.reloadSharedSettingsAndIndex = async () => { h.plugin.unloaded = true; return 0; };
    await h.plugin.reloadVaultIndexFromCommand();
    expect(h.notices).toEqual([]);
  });

  it('distinguishes partial and unpublished reloads from a zero-failure reload', async () => {
    const h = harness();
    h.plugin.reloadSharedSettingsAndIndex = async () => 2;
    await h.plugin.reloadVaultIndexFromCommand();
    expect(h.notices).toEqual(['Quartzo index reloaded with unreadable files. Some entries may be missing.']);
    h.notices.length = 0;
    h.plugin.reloadSharedSettingsAndIndex = async () => undefined;
    await h.plugin.reloadVaultIndexFromCommand();
    expect(h.notices.join(' ')).toContain('did not finish');
  });

  it('uses the last read-failure count from the actual coalescing reload owner', async () => {
    const h = harness();
    h.plugin.reloadSharedSettingsAndIndex = FixtureClass.prototype.reloadSharedSettingsAndIndex;
    let calls = 0;
    h.plugin.initializeVaultIndex = async () => {
      calls++;
      if (calls === 1) h.plugin.sharedSettingsReloadRequested = true;
      return calls;
    };
    expect(await h.plugin.reloadSharedSettingsAndIndex()).toBe(2);
    expect(calls).toBe(2);
    expect(h.plugin.sharedSettingsReloadInFlight).toBe(false);
  });
});
