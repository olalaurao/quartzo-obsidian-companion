import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = [];
const fails = message => issues.push(message);
const exists = name => fs.existsSync(path.join(root, name));
const text = name => exists(name) ? fs.readFileSync(path.join(root, name), 'utf8') : '';
const mandatory = [
  'AGENT_BOOTSTRAP.md', 'guidelines.md', 'agents.md', 'docs/README.md',
  '.github/copilot-instructions.md', 'README.md',
  'contracts/UPSTREAM.lock.json', 'docs/audits/agent-docs-reconciliation.md',
  'docs/specs/drive-sync-operational.md', 'docs/specs/object-organization.md',
];
for (const name of mandatory) if (!exists(name)) fails('Missing required document: ' + name);

const map = text('docs/README.md');
const bootstrap = text('AGENT_BOOTSTRAP.md');
const guidelines = text('guidelines.md');
const agents = text('agents.md');
if (!bootstrap.includes('Read this file first')) fails('Bootstrap must require first read.');
for (const name of ['guidelines.md', 'agents.md', 'contracts/']) {
  if (!bootstrap.includes(name)) fails('Bootstrap missing instruction: ' + name);
}
if (!map.includes('contracts/UPSTREAM.lock.json') || !map.includes('upstream'))
  fails('Documentation map must point to pinned upstream authority.');
if (!agents.includes('DriveSyncCoordinator') || !agents.includes('VaultIndex'))
  fails('Owner map must retain canonical Drive and vault index owners.');
if (!guidelines.includes('upstream') || !guidelines.includes('C-GUID-'))
  fails('Guidelines must retain upstream authority and stable rule IDs.');

// Every legacy guideline obligation must have exactly one stable home:
// 1-8 and 24-50 in guidelines; 9-23 in the local operational specification.
const sync = text('docs/specs/drive-sync-operational.md');
for (let n = 1; n <= 50; n++) {
  const id = 'C-GUID-' + String(n).padStart(2, '0');
  const inGuidelines = guidelines.split(id).length - 1;
  const inSync = sync.split(id).length - 1;
  // The sync overview mentions a *range*, not individual IDs; count references separately.
  if (n >= 9 && n <= 23) {
    if (inSync !== 1) fails(id + ': expected exactly one operational rule, found ' + inSync);
  } else if (inGuidelines !== 1) {
    fails(id + ': expected exactly one product rule, found ' + inGuidelines);
  }
}

const specDir = path.join(root, 'docs/specs');
if (fs.existsSync(specDir)) {
  const specs = fs.readdirSync(specDir).filter(s => s.endsWith('.md'));
  for (const name of specs) {
    const spec = text('docs/specs/' + name);
    if (!map.includes('specs/' + name)) fails('Unindexed local spec: ' + name);
    for (const label of [
      'Status:', 'Last reconciled date:', 'Last reconciled main SHA:',
      'Canonical implementation owners:', 'Depends on:', 'Supersedes:', 'Authority boundary:',
    ]) {
      if (!spec.includes(label)) fails('Spec ' + name + ' missing metadata ' + label);
    }
  }
}

const linkDocs = [
  'AGENT_BOOTSTRAP.md', '.github/copilot-instructions.md', 'README.md',
  'docs/README.md', 'docs/specs/drive-sync-operational.md',
];
for (const name of linkDocs) {
  if (!exists(name)) continue;
  const content = text(name);
  const re = /\]\(([^)]+)\)/g;
  for (const match of content.matchAll(re)) {
    const target = match[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(name), decodeURIComponent(target));
    if (!resolved.startsWith(root + path.sep)) {
      fails(name + ': link escapes repository root: ' + target);
    } else if (!fs.existsSync(resolved)) {
      fails(name + ': broken link: ' + target);
    }
  }
}

// Use exact tracked Git paths, not fs.existsSync('AGENTS.md'): on Windows/macOS the filesystem aliases agents.md, causing false positives.
try {
  const all = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const known = new Map();
  for (const filename of all) {
    const key = filename.toLowerCase();
    if (known.has(key) && known.get(key) !== filename)
      fails('Case-only collision: ' + known.get(key) + ' <> ' + filename);
    known.set(key, filename);
  }
  if (all.includes('agents.md') && all.includes('AGENTS.md'))
    fails('Root AGENTS.md competes with root agents.md.');
  if (all.some(f => /(^|\/)LATEST_.*_RULES\.md$/.test(f)))
    fails('Unexpected competing rule authority document.');
} catch (error) { fails('Cannot inspect tracked files: ' + error.message); }

if (issues.length) {
  for (const issue of issues) console.error('DOCS FAIL: ' + issue);
  process.exitCode = 1;
} else {
  console.log('PASS: Companion documentation integrity, ' +
    '50 stable rules, active specs, local links, upstream authority and tracked path casing');
}
