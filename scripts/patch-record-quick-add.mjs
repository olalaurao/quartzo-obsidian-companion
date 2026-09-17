import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, patches) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, 'utf8');
  for (const [label, from, to] of patches) {
    const first = source.indexOf(from);
    if (first < 0) throw new Error(`Missing ${label} in ${relativePath}`);
    if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one ${label} in ${relativePath}`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source);
}

patchFile('src/core/objects/parser.ts', [
  [
    'tracker canonical input_fields read',
    "              fields = (section.fields as unknown[]) || [];",
    "              fields = (section.input_fields as unknown[]) || (section.fields as unknown[]) || [];",
  ],
  [
    'tracker input_fields fallback key',
    "                  if (key === 'fields') {\n                    fields = Array.isArray(section[key]) ? section[key] as unknown[] : [];\n                  }",
    "                  if (key === 'input_fields' || key === 'fields') {\n                    fields = Array.isArray(section[key]) ? section[key] as unknown[] : [];\n                  }",
  ],
]);

patchFile('src/core/object-creation.ts', [
  [
    'QuickAddType tracker record',
    "export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder' | 'resource';",
    "export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder' | 'resource' | 'tracker_record';",
  ],
  [
    'record quick add interface',
    "export interface QuickAddInput {\n  title: string;\n  body: string;\n  date?: string;\n  time?: string;\n  resource?: ResourceQuickAddInput;\n}",
    "export interface TrackerRecordQuickAddInput {\n  trackerId: string;\n  trackerTitle: string;\n  date: string;\n  fieldValues: Record<string, unknown>;\n}\n\nexport interface QuickAddInput {\n  title: string;\n  body: string;\n  date?: string;\n  time?: string;\n  resource?: ResourceQuickAddInput;\n  record?: TrackerRecordQuickAddInput;\n}",
  ],
  [
    'record generated title',
    "  const title = trimmedTitle || (type === 'entry' ? 'Journal Entry' : 'Untitled');\n  const frontmatter: Record<string, unknown> = { id, type, title };",
    "  const record = type === 'tracker_record' ? input.record : undefined;\n  if (type === 'tracker_record' && !record) throw new Error('Record fields are required.');\n  const recordTrackerTitle = record?.trackerTitle.trim() ?? '';\n  if (type === 'tracker_record' && !recordTrackerTitle) throw new Error('Record Tracker title is required.');\n  const title = type === 'tracker_record'\n    ? `${recordTrackerTitle} ${record?.date ?? ''}`.trim()\n    : trimmedTitle || (type === 'entry' ? 'Journal Entry' : 'Untitled');\n  const frontmatter: Record<string, unknown> = { id, type, title };",
  ],
  [
    'record frontmatter',
    "  if (type === 'resource') {",
    "  if (type === 'tracker_record') {\n    const trackerId = record?.trackerId.trim() ?? '';\n    const date = record?.date.trim() ?? '';\n    if (!trackerId) throw new Error('Record Tracker is required.');\n    if (!date) throw new Error('Record date is required.');\n    frontmatter.tracker_id = trackerId;\n    frontmatter.date = date;\n    frontmatter.field_values = { ...(record?.fieldValues ?? {}) };\n    frontmatter.categories = ['[[tracker_records]]'];\n  }\n  if (type === 'resource') {",
  ],
]);

patchFile('src/ui/shell/view.ts', [
  [
    'record form imports',
    "import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';\n",
    "import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';\nimport { ObjectParser } from '../../core/objects';\nimport type { TrackerDefinition } from '../../core/objects/types';\n",
  ],
  [
    'record form renderer import',
    "import { projectHomeSchedule } from '../home/home-projection';\n",
    "import { projectHomeSchedule } from '../home/home-projection';\nimport { renderTrackerRecordQuickAdd, type TrackerRecordFormController } from '../quick-add/record-form';\n",
  ],
  [
    'record label',
    "function labelForType(type: string): string {\n  return type.replace(/_/g, ' ').replace(/\\b\\w/g, char => char.toUpperCase());\n}",
    "function labelForType(type: string): string {\n  if (type === 'tracker_record') return 'Record';\n  return type.replace(/_/g, ' ').replace(/\\b\\w/g, char => char.toUpperCase());\n}",
  ],
  [
    'Quick Add record type',
    "    for (const type of ['task', 'entry', 'note', 'reminder', 'resource'] as QuickAddType[]) {",
    "    for (const type of ['task', 'entry', 'note', 'reminder', 'tracker_record', 'resource'] as QuickAddType[]) {",
  ],
  [
    'hide generic fields for record',
    "    titleInput.className = 'quartzo-input';\n    contentEl.appendChild(titleInput);\n\n    const bodyInput = document.createElement('textarea');\n    bodyInput.placeholder = this.type === 'resource' ? 'Synopsis or notes' : 'Content';\n    bodyInput.className = 'quartzo-input';\n    contentEl.appendChild(bodyInput);",
    "    titleInput.className = 'quartzo-input';\n    if (this.type !== 'tracker_record') contentEl.appendChild(titleInput);\n\n    const bodyInput = document.createElement('textarea');\n    bodyInput.placeholder = this.type === 'resource' ? 'Synopsis or notes' : 'Content';\n    bodyInput.className = 'quartzo-input';\n    if (this.type !== 'tracker_record') contentEl.appendChild(bodyInput);",
  ],
  [
    'record form controller',
    "    let sourceUrlInput: HTMLInputElement | null = null;",
    "    let recordForm: TrackerRecordFormController | null = null;\n    if (this.type === 'tracker_record') {\n      recordForm = renderTrackerRecordQuickAdd(contentEl, this.trackerDefinitions(), isoDate(new Date()));\n    }\n\n    let sourceUrlInput: HTMLInputElement | null = null;",
  ],
  [
    'record input read',
    "        const resourceInput = this.type === 'resource'\n          ? {",
    "        const recordInput = this.type === 'tracker_record' ? recordForm?.value() : undefined;\n        const resourceInput = this.type === 'resource'\n          ? {",
  ],
  [
    'record save wiring',
    "          resource: resourceInput,\n        }, id);",
    "          resource: resourceInput,\n          record: recordInput,\n        }, id);",
  ],
  [
    'tracker definitions helper',
    "  private resourceObjects(): IndexedObject[] {",
    "  private trackerDefinitions(): TrackerDefinition[] {\n    const index = this.getIndex();\n    if (!index) return [];\n    const trackers: TrackerDefinition[] = [];\n    for (const indexed of index.objects.values()) {\n      if (indexed.type !== 'tracker_definition' || indexed.frontmatter.archived === true) continue;\n      try {\n        const parsed = ObjectParser.parse(ObjectParser.serializeMarkdown(indexed.frontmatter, indexed.body)).object;\n        if (parsed.type === 'tracker_definition') trackers.push(parsed);\n      } catch {\n        // Malformed Trackers fail closed and are not offered for Record creation.\n      }\n    }\n    return trackers.sort((left, right) => left.title.localeCompare(right.title));\n  }\n\n  private resourceObjects(): IndexedObject[] {",
  ],
]);

console.log('Record Quick Add wired through canonical Tracker and TrackingRecord owners.');
