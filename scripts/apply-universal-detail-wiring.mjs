import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/ui/shell/view.ts');
let content = fs.readFileSync(file, 'utf8');

function replaceExact(from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  content = content.replace(from, to);
}

replaceExact(
  "import { VaultIndexEngine } from '../../vault/index';\n",
  "import { VaultIndexEngine } from '../../vault/index';\nimport { renderObjectDetail } from '../detail/object-detail';\n",
  'detail import',
);
replaceExact(
  "  private action: QuartzoAction | null = null;\n",
  "  private action: QuartzoAction | null = null;\n  private selectedObjectId: string | null = null;\n",
  'detail selection state',
);
replaceExact(
  "    this.section = section;\n    this.action = null;\n",
  "    this.section = section;\n    this.action = null;\n    this.selectedObjectId = null;\n",
  'section resets detail',
);
replaceExact(
  "  async handleAction(action: QuartzoAction): Promise<void> {\n    if (action === 'add') {\n",
  "  async handleAction(action: QuartzoAction): Promise<void> {\n    this.selectedObjectId = null;\n    if (action === 'add') {\n",
  'actions reset detail',
);
replaceExact(
  "    shell.appendChild(content);\n\n    if (this.action === 'search') {\n",
  "    shell.appendChild(content);\n\n    if (this.selectedObjectId) {\n      const object = this.getIndex()?.objects.get(this.selectedObjectId);\n      if (object) {\n        renderObjectDetail(content, object, {\n          onBack: () => { this.selectedObjectId = null; void this.render(); },\n          onOpenMarkdown: () => this.openMarkdown(object),\n        });\n        return;\n      }\n      this.selectedObjectId = null;\n    }\n\n    if (this.action === 'search') {\n",
  'render selected detail',
);
replaceExact(
  "        row.addEventListener('click', () => this.openMarkdown(object));\n",
  "        row.addEventListener('click', () => this.openObjectDetail(object));\n",
  'planner detail navigation',
);
replaceExact(
  "    row.addEventListener('click', () => this.openMarkdown(object));\n",
  "    row.addEventListener('click', () => this.openObjectDetail(object));\n",
  'browse search detail navigation',
);
replaceExact(
  "  private openMarkdown(object: IndexedObject): void {\n",
  "  private openObjectDetail(object: IndexedObject): void {\n    this.selectedObjectId = object.id;\n    void this.render();\n  }\n\n  private openMarkdown(object: IndexedObject): void {\n",
  'detail navigation method',
);

fs.writeFileSync(file, content);
console.log('Wired Universal Object Detail into the Quartzo shell.');
