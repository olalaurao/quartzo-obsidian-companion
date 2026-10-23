import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { VaultIndexEngine, type VaultFile } from '../../src/vault/index';
import { parseObjectWithSharedSettings } from '../../src/core/shared-settings';

// Execute the actual registered index callbacks, with controlled SDK reads.
// This does not load Obsidian, OAuth, Drive, a user vault or the whole plugin.
const source = ts.createSourceFile('main.ts', readFileSync(resolve('src/main.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const pluginClass = source.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'QuartzoCompanionPlugin') as ts.ClassDeclaration;
const register = pluginClass.members.find(member => ts.isMethodDeclaration(member)
  && member.name.getText(source) === 'registerVaultEvents')!;
const compiled = ts.transpileModule(`class EventFixture { ${register.getText(source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class SyntheticFile {
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
  vaultIndexEngine: VaultIndexEngine;
  unloaded: boolean;
}
const FixtureClass = new Function('dependencies', `const {
  VaultIndexEngine,parseObjectWithSharedSettings,TFile,normalizeVaultPath,
  SHARED_SETTINGS_PATH,SHARED_OCCURRENCE_STATE_PATH,SHARED_PLANNING_STATE_PATH,
  FOCUS_RUNTIME_PATH,VaultSyncFilePolicy
} = dependencies; ${compiled}; return EventFixture;`)({
  VaultIndexEngine, parseObjectWithSharedSettings, TFile: SyntheticFile,
  normalizeVaultPath: (path: string) => path.replace(/\\/g, '/'),
  SHARED_SETTINGS_PATH: 'app/quartzo_shared_settings.md',
  SHARED_OCCURRENCE_STATE_PATH: 'app/occurrences.md',
  SHARED_PLANNING_STATE_PATH: 'app/planning.md', FOCUS_RUNTIME_PATH: 'sessions/current.md',
  VaultSyncFilePolicy: { shouldSyncFile: () => false },
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
  const engine = new VaultIndexEngine();
  engine.setIndex(VaultIndexEngine.createInitialIndex(initial,
    (content, path) => parseObjectWithSharedSettings(content, path, null)));
  const handlers = new Map<string, Handler[]>();
  const liveFiles = new Map(initial.map(file => [file.path, new SyntheticFile(file.path)]));
  const reads: PendingRead[] = [];
  const plugin = Object.assign(new FixtureClass(), {
    unloaded: false, vaultIndexEngine: engine, eventRefs: [], sharedSettings: null,
    settings: { isPaired: false },
    shouldIndexPath: (path: string) => path.endsWith('.md') && !path.startsWith('app/'),
    reloadSharedSettingsAndIndex: async () => {},
    app: { vault: {
      getAbstractFileByPath: (path: string) => liveFiles.get(path) ?? null,
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
  return { engine, plugin, reads,
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
