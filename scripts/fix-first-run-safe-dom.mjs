import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/main.ts');
let content = fs.readFileSync(file, 'utf8');

const from = `  showFirstRunDialog() {\n    const modal = document.createElement('div');\n    modal.className = 'quartzo-first-run-modal';\n    modal.innerHTML = \`\n      <div class="modal-content">\n        <h2>Welcome to Quartzo Companion</h2>\n        <p>Set up your Google Drive sync to get started.</p>\n        <button id="setup-later">Setup Later</button>\n        <button id="setup-now">Setup Now</button>\n      </div>\n    \`;\n    document.body.appendChild(modal);\n`;

const to = `  showFirstRunDialog() {\n    const modal = document.createElement('div');\n    modal.className = 'quartzo-first-run-modal';\n    const modalContent = document.createElement('div');\n    modalContent.className = 'modal-content';\n    const title = document.createElement('h2');\n    title.textContent = 'Welcome to Quartzo Companion';\n    modalContent.appendChild(title);\n    const description = document.createElement('p');\n    description.textContent = 'Set up your Google Drive sync to get started.';\n    modalContent.appendChild(description);\n    const setupLater = document.createElement('button');\n    setupLater.id = 'setup-later';\n    setupLater.textContent = 'Setup Later';\n    modalContent.appendChild(setupLater);\n    const setupNow = document.createElement('button');\n    setupNow.id = 'setup-now';\n    setupNow.textContent = 'Setup Now';\n    modalContent.appendChild(setupNow);\n    modal.appendChild(modalContent);\n    document.body.appendChild(modal);\n`;

const first = content.indexOf(from);
if (first < 0) throw new Error('Expected first-run modal source not found');
if (content.indexOf(from, first + from.length) >= 0) throw new Error('Expected one first-run modal source');
content = content.replace(from, to);
fs.writeFileSync(file, content);
console.log('First-run modal now uses safe DOM/textContent.');
