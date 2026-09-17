import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, '.smoke-test');
const metafilePath = path.join(rootDir, 'metafile.json');

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'stream/web',
  'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib'
]);

const OBSIDIAN_EXTERNALS = new Set([
  'obsidian', 'electron',
  '@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands',
  '@codemirror/language', '@codemirror/lint', '@codemirror/search',
  '@codemirror/state', '@codemirror/view',
  '@lezer/common', '@lezer/highlight', '@lezer/lr',
]);

function cleanup() {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  if (fs.existsSync(metafilePath)) {
    fs.unlinkSync(metafilePath);
  }
}

function stageDist() {
  cleanup();
  fs.mkdirSync(distDir, { recursive: true });

  const files = ['main.js', 'manifest.json', 'styles.css'];
  for (const file of files) {
    const src = path.join(rootDir, file);
    if (!fs.existsSync(src)) {
      console.error(`FAIL: Required artifact missing: ${file}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(distDir, file));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    console.error(`FAIL: manifest version ${manifest.version} != package.json ${pkg.version}`);
    process.exit(1);
  }

  if (manifest.minAppVersion < '1.11.4') {
    console.error(`FAIL: minAppVersion ${manifest.minAppVersion} < 1.11.4`);
    process.exit(1);
  }
}

function checkMetafileOrFallback(preloadedMeta) {
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');

  if (preloadedMeta) {
    const meta = preloadedMeta;
    const outputs = Object.values(meta.outputs || {});
    const externals = new Set();
    for (const output of outputs) {
      for (const imp of output.imports || []) {
        if (imp.external) {
          externals.add(imp.path);
        }
      }
    }

    for (const ext of externals) {
      const baseName = ext.replace(/^node:/, '');
      if (NODE_BUILTINS.has(baseName)) continue;
      if (OBSIDIAN_EXTERNALS.has(ext)) continue;
      console.error(`FAIL: Unexpected external in metafile: ${ext}`);
      return false;
    }
    console.log(`PASS: Metafile inspection - ${externals.size} external(s), all allowed`);
    return true;
  }

  console.log('INFO: No metafile found, falling back to string inspection');

  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  let match;
  const unresolved = [];
  while ((match = requireRegex.exec(mainJs)) !== null) {
    const dep = match[1];
    const baseDep = dep.replace(/^node:/, '');
    if (dep.startsWith('.') || dep.startsWith('/')) continue;
    if (NODE_BUILTINS.has(baseDep)) continue;
    if (OBSIDIAN_EXTERNALS.has(dep)) continue;
    unresolved.push(dep);
  }

  if (unresolved.length > 0) {
    console.error(`FAIL: Unresolved runtime requires: ${unresolved.join(', ')}`);
    return false;
  }
  console.log('PASS: No unexpected runtime requires (string fallback)');
  return true;
}

function checkNoNodeModulesRef() {
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');
  const lines = mainJs.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    if (line.includes('"node_modules"') || line.includes("'node_modules'")) continue;
    if (line.includes('node_modules')) {
      console.error(`FAIL: main.js references node_modules (line ${i + 1}: ${line.substring(0, 100)})`);
      return false;
    }
  }
  console.log('PASS: No node_modules references');
  return true;
}

function checkClientIdWiring() {
  const clientIdEnv = process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID;
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');

  if (clientIdEnv && clientIdEnv !== 'PLACEHOLDER_CLIENT_ID') {
    if (!mainJs.includes(clientIdEnv)) {
      console.error('FAIL: Built main.js does not contain the injected CLIENT_ID');
      return false;
    }
    console.log('PASS: Client ID properly injected');
  } else {
    console.log('PASS: Client ID check skipped (no env set)');
  }
  return true;
}

function checkBundleSize() {
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');
  const sizeKB = Buffer.byteLength(mainJs, 'utf8') / 1024;
  console.log(`INFO: main.js bundle size: ${sizeKB.toFixed(1)} KB`);

  if (sizeKB > 5000) {
    console.error('FAIL: Bundle exceeds 5MB');
    return false;
  }
  console.log('PASS: Bundle size OK');
  return true;
}

function checkStubLoad() {
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');

  const stubModules = {
    'obsidian': {
      Plugin: class Plugin { constructor() { this.vault = { on() { return {}; }, offref() {}, getMarkdownFiles() { return []; }, adapter: { getBasePath() { return ''; } } }; } loadData() { return {}; } saveData() {} registerView() {} addRibbonIcon() { return { addClass() {} }; } addCommand() {} addSettingTab() {} },
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting { setName() { return this; } setDesc() { return this; } addText() { return this; } addToggle() { return this; } },
      WorkspaceLeaf: class WorkspaceLeaf {},
      Notice: class Notice {},
      ItemView: class ItemView { get contentEl() { return { empty() {}, innerHTML: '', querySelector() { return null; } }; } },
      Modal: class Modal { constructor() { this.contentEl = {}; } open() {} close() {} },
      TFile: class TFile {},
      TAbstractFile: class TAbstractFile {},
      FileSystemAdapter: class FileSystemAdapter {},
    },
    'electron': {},
  };

  try {
    const moduleCache = {};
    for (const [name, exports] of Object.entries(stubModules)) {
      moduleCache[name] = { exports, loaded: true, id: name };
    }

    const requireStub = (id) => {
      if (moduleCache[id]) return moduleCache[id].exports;
      const baseId = id.replace(/^node:/, '');
      if (NODE_BUILTINS.has(baseId)) return require(baseId);
      const err = new Error(`Cannot find module '${id}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    };

    const script = new vm.Script(mainJs, { filename: 'main.js' });
    const context = vm.createContext({
      ...global,
      module: { exports: {} },
      exports: {},
      require: requireStub,
      process: process,
      console,
    });
    script.runInContext(context);
    console.log('PASS: main.js loads against minimal Obsidian/Electron stub');
    return true;
  } catch (error) {
    console.error(`FAIL: Stub load failed: ${error.stack}`);
    return false;
  }
}

function main() {
  console.log('=== Clean Artifact Smoke Test ===\n');
  let allPassed = true;

  const metafileContent = fs.existsSync(metafilePath) ? JSON.parse(fs.readFileSync(metafilePath, 'utf8')) : null;
  stageDist();
  if (!checkMetafileOrFallback(metafileContent)) allPassed = false;
  if (!checkNoNodeModulesRef()) allPassed = false;
  if (!checkClientIdWiring()) allPassed = false;
  if (!checkBundleSize()) allPassed = false;
  if (!checkStubLoad()) allPassed = false;

  cleanup();

  console.log('\n' + (allPassed ? 'All smoke tests passed' : 'Some smoke tests failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
