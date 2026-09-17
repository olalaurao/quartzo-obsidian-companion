import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function replaceExact(content, from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  return content.replace(from, to);
}

function patch(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Patch made no change: ${relativePath}`);
  fs.writeFileSync(file, after);
}

patch('src/ui/shell/view.ts', content => {
  content = replaceExact(
    content,
    "import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';\n",
    "import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';\nimport { addLocalDays, daysInLocalMonth, localIsoDate, parseLocalIsoDate, shiftLocalMonth } from '../../core/local-date';\nimport { createCanonicalObjectId } from '../../platform/object-id';\n",
    'shell local-date imports',
  );
  content = replaceExact(
    content,
    `function isoDate(date: Date): string {\n  return date.toISOString().slice(0, 10);\n}\n\nfunction addDays(date: Date, days: number): Date {\n  const copy = new Date(date);\n  copy.setUTCDate(copy.getUTCDate() + days);\n  return copy;\n}\n\nfunction parseIsoDate(value: string): Date {\n  return new Date(\`${'${value}'}T00:00:00.000Z\`);\n}\n`,
    `function isoDate(date: Date): string {\n  return localIsoDate(date);\n}\n\nfunction addDays(date: Date, days: number): Date {\n  return addLocalDays(date, days);\n}\n\nfunction parseIsoDate(value: string): Date {\n  return parseLocalIsoDate(value);\n}\n`,
    'shell local-date helpers',
  );
  content = replaceExact(
    content,
    "        const id = `${this.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;",
    '        const id = createCanonicalObjectId();',
    'Quick Add canonical UUID',
  );
  content = replaceExact(
    content,
    `      const step = this.plannerMode === 'week' ? -7 : this.plannerMode === 'month' ? -30 : -1;\n      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));`,
    `      if (this.plannerMode === 'month') {\n        this.selectedDate = shiftLocalMonth(this.selectedDate, -1);\n      } else {\n        const step = this.plannerMode === 'week' ? -7 : -1;\n        this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));\n      }`,
    'previous month navigation',
  );
  content = replaceExact(
    content,
    `      const step = this.plannerMode === 'week' ? 7 : this.plannerMode === 'month' ? 30 : 1;\n      this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));`,
    `      if (this.plannerMode === 'month') {\n        this.selectedDate = shiftLocalMonth(this.selectedDate, 1);\n      } else {\n        const step = this.plannerMode === 'week' ? 7 : 1;\n        this.selectedDate = isoDate(addDays(parseIsoDate(this.selectedDate), step));\n      }`,
    'next month navigation',
  );
  content = replaceExact(content, '      const weekday = selected.getUTCDay();', '      const weekday = selected.getDay();', 'local weekday');
  content = replaceExact(
    content,
    `    const year = selected.getUTCFullYear();\n    const month = selected.getUTCMonth();\n    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();\n    for (let day = 1; day <= days; day++) {\n      this.renderScheduleItems(container, isoDate(new Date(Date.UTC(year, month, day))));\n    }`,
    `    const year = selected.getFullYear();\n    const month = selected.getMonth();\n    const days = daysInLocalMonth(selected);\n    for (let day = 1; day <= days; day++) {\n      this.renderScheduleItems(container, isoDate(new Date(year, month, day)));\n    }`,
    'local month rendering',
  );
  return content;
});

patch('src/main.ts', content => {
  content = replaceExact(
    content,
    "import { ViewContext } from './ui/types';\n",
    "import { ViewContext } from './ui/types';\nimport { localIsoDate } from './core/local-date';\n",
    'main local-date import',
  );
  content = replaceExact(
    content,
    "        dailyScheduleDate: new Date().toISOString().split('T')[0],",
    '        dailyScheduleDate: localIsoDate(new Date()),',
    'main local day state',
  );
  const unsafeModal = `      const modal = document.createElement('div');\n      modal.className = 'quartzo-pairing-summary-modal';\n      modal.innerHTML = \`\n        <div class="modal-content" style="padding: 20px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;">\n          <h2>Pairing Summary</h2>\n          <p>Folder: <strong>${'${folderName}'}</strong></p>\n          <ul>\n            <li>Identical files: ${'${summary.identical.length}'}</li>\n            <li>Remote-only (to pull): ${'${summary.remoteOnly.length}'}</li>\n            <li>Local-only (to adopt): ${'${summary.localOnly.length}'}</li>\n            <li>Ambiguous (blocked): ${'${summary.ambiguous.length}'}</li>\n          </ul>\n          <p>Do you want to adopt local-only files and pull remote-only files?</p>\n          <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;">\n            <button id="pairing-cancel">Cancel</button>\n            <button id="pairing-confirm">Accept & Pair</button>\n          </div>\n        </div>\n      \`;\n      document.body.appendChild(modal);`;
  const safeModal = `      const modal = document.createElement('div');\n      modal.className = 'quartzo-pairing-summary-modal';\n      const modalContent = document.createElement('div');\n      modalContent.className = 'modal-content';\n      modalContent.style.cssText = 'padding: 20px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;';\n      const modalTitle = document.createElement('h2');\n      modalTitle.textContent = 'Pairing Summary';\n      modalContent.appendChild(modalTitle);\n      const folder = document.createElement('p');\n      folder.textContent = \`Folder: ${'${folderName}'}\`;\n      modalContent.appendChild(folder);\n      const counts = document.createElement('ul');\n      for (const text of [\n        \`Identical files: ${'${summary.identical.length}'}\`,\n        \`Remote-only (to pull): ${'${summary.remoteOnly.length}'}\`,\n        \`Local-only (to adopt): ${'${summary.localOnly.length}'}\`,\n        \`Ambiguous (blocked): ${'${summary.ambiguous.length}'}\`,\n      ]) {\n        const item = document.createElement('li');\n        item.textContent = text;\n        counts.appendChild(item);\n      }\n      modalContent.appendChild(counts);\n      const question = document.createElement('p');\n      question.textContent = 'Do you want to adopt local-only files and pull remote-only files?';\n      modalContent.appendChild(question);\n      const actions = document.createElement('div');\n      actions.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;';\n      const cancelButton = document.createElement('button');\n      cancelButton.id = 'pairing-cancel';\n      cancelButton.textContent = 'Cancel';\n      actions.appendChild(cancelButton);\n      const confirmButton = document.createElement('button');\n      confirmButton.id = 'pairing-confirm';\n      confirmButton.textContent = 'Accept & Pair';\n      actions.appendChild(confirmButton);\n      modalContent.appendChild(actions);\n      modal.appendChild(modalContent);\n      document.body.appendChild(modal);`;
  content = replaceExact(content, unsafeModal, safeModal, 'safe pairing modal DOM');
  return content;
});

patch('scripts/architecture-check.mjs', content => {
  const marker = `function main() {\n`;
  const checks = `function checkNoUnsafeInnerHtml() {\n  const violations = [];\n  function scan(dir) {\n    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n      const full = path.join(dir, entry.name);\n      if (entry.isDirectory()) {\n        scan(full);\n      } else if (entry.name.endsWith('.ts')) {\n        const source = fs.readFileSync(full, 'utf8');\n        if (source.includes('.innerHTML')) violations.push(path.relative(rootDir, full));\n      }\n    }\n  }\n  scan(path.join(rootDir, 'src'));\n  if (violations.length > 0) {\n    console.error(\`FAIL: Runtime source uses innerHTML instead of safe DOM/textContent: ${'${violations.join(\', \')}'}\`);\n    return false;\n  }\n  console.log('PASS: Runtime UI does not use innerHTML');\n  return true;\n}\n\nfunction checkCanonicalUiDateAndIdentityOwners() {\n  const shell = fs.readFileSync(path.join(rootDir, 'src/ui/shell/view.ts'), 'utf8');\n  const main = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');\n  const forbidden = ['toISOString().slice(0, 10)', 'setUTCDate(', 'getUTCDay(', 'Date.UTC(', 'Math.random().toString(36)'];\n  const violations = forbidden.filter(pattern => shell.includes(pattern) || main.includes(pattern));\n  if (violations.length > 0) {\n    console.error(\`FAIL: Quartzo UI bypasses canonical local-date/identity owners: ${'${violations.join(\', \')}'}\`);\n    return false;\n  }\n  if (!shell.includes('createCanonicalObjectId()') || !shell.includes('shiftLocalMonth(') || !main.includes('localIsoDate(new Date())')) {\n    console.error('FAIL: Quartzo UI is not wired to canonical local-date and object identity owners');\n    return false;\n  }\n  console.log('PASS: UI uses canonical local-date and object identity owners');\n  return true;\n}\n\n`;
  content = replaceExact(content, marker, checks + marker, 'architecture security/date checks');
  content = replaceExact(
    content,
    `  if (!checkNoHardcodedQuickAddFolders()) allPassed = false;\n`,
    `  if (!checkNoHardcodedQuickAddFolders()) allPassed = false;\n  if (!checkNoUnsafeInnerHtml()) allPassed = false;\n  if (!checkCanonicalUiDateAndIdentityOwners()) allPassed = false;\n`,
    'architecture new checks invocation',
  );
  return content;
});

console.log('Applied beta structural fixes.');
