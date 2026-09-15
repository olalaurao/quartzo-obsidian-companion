import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, '.smoke-test');

const ALLOWED_EXTERNALS = new Set([
  'obsidian', 'electron',
  '@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands',
  '@codemirror/language', '@codemirror/lint', '@codemirror/search',
  '@codemirror/state', '@codemirror/view',
  '@lezer/common', '@lezer/highlight', '@lezer/lr',
  'path', 'fs', 'os', 'crypto', 'http', 'https', 'url', 'child_process',
  'events', 'stream', 'buffer', 'util', 'net', 'tls', 'zlib', 'assert',
  'querystring', 'string_decoder', 'timers', 'tty', 'url', 'util', 'v8',
  'vm', 'worker_threads',
]);

const NODE_BUILTIN_RE = /^(node:)?(path|fs|os|crypto|http|https|url|child_process|events|stream|buffer|util|net|tls|zlib|assert|querystring|string_decoder|timers|tty|v8|vm|worker_threads)$/;

function cleanup() {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
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

function checkNoUnresolvedRequires() {
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');

  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  let match;
  const unresolved = [];

  while ((match = requireRegex.exec(mainJs)) !== null) {
    const dep = match[1];
    if (dep.startsWith('.') || dep.startsWith('/')) continue;
    if (NODE_BUILTIN_RE.test(dep)) continue;
    if (ALLOWED_EXTERNALS.has(dep)) continue;
    unresolved.push(dep);
  }

  if (unresolved.length > 0) {
    console.error(`FAIL: Unresolved runtime requires: ${unresolved.join(', ')}`);
    return false;
  }

  console.log('PASS: No unresolved runtime requires');
  return true;
}

function checkNoNodeModulesRef() {
  const mainJs = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8');
  if (mainJs.includes('node_modules')) {
    console.error('FAIL: main.js references node_modules');
    return false;
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
  return true;
}

function main() {
  console.log('=== Clean Artifact Smoke Test ===\n');
  let allPassed = true;

  stageDist();
  if (!checkNoUnresolvedRequires()) allPassed = false;
  if (!checkNoNodeModulesRef()) allPassed = false;
  if (!checkClientIdWiring()) allPassed = false;
  if (!checkBundleSize()) allPassed = false;

  cleanup();

  console.log('\n' + (allPassed ? 'All smoke tests passed' : 'Some smoke tests failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
