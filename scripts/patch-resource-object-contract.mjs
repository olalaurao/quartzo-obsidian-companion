import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, replacements) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, 'utf8');
  for (const { from, to, label } of replacements) {
    const first = source.indexOf(from);
    if (first < 0) throw new Error(`Missing expected source for ${relativePath}: ${label}`);
    if (source.indexOf(from, first + from.length) >= 0) {
      throw new Error(`Expected one source for ${relativePath}: ${label}`);
    }
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source);
}

patchFile('src/core/objects/types.ts', [
  {
    label: 'resource object type',
    from: "  | 'wellbeing_indicator'\n  | 'area'",
    to: "  | 'wellbeing_indicator'\n  | 'resource'\n  | 'area'",
  },
  {
    label: 'resource interface',
    from: "export interface WellbeingIndicator extends BaseObject {\n  type: 'wellbeing_indicator';\n  signals?: unknown[];\n  signal_count?: number;\n}\n\nexport interface Area extends BaseObject {",
    to: "export interface WellbeingIndicator extends BaseObject {\n  type: 'wellbeing_indicator';\n  signals?: unknown[];\n  signal_count?: number;\n}\n\nexport interface Resource extends BaseObject {\n  type: 'resource';\n  media_type: string;\n  cover?: string;\n  source_url?: string;\n  book_id?: string;\n  status?: string;\n  rating?: number;\n  priority?: string;\n  author?: string;\n  year?: number;\n  pages?: number;\n  category?: string;\n  isbn?: string;\n  title_pt_br?: string;\n  title_original?: string;\n  publisher?: string;\n  language?: string;\n  google_books_id?: string;\n  imdb_id?: string;\n  read?: string;\n  start_date?: string;\n  end_date?: string;\n  scheduler?: Record<string, unknown>;\n  links?: string[];\n  categories?: string[];\n  tags?: string[];\n  aliases?: string[];\n}\n\nexport interface Area extends BaseObject {",
  },
  {
    label: 'resource union',
    from: "  | WellbeingIndicator\n  | Area",
    to: "  | WellbeingIndicator\n  | Resource\n  | Area",
  },
]);

patchFile('src/core/objects/parser.ts', [
  {
    label: 'resource known fields',
    from: "  wellbeing_indicator: new Set(['id', 'type', 'title', 'signals', 'signal_count', 'body']),\n  area:",
    to: "  wellbeing_indicator: new Set(['id', 'type', 'title', 'signals', 'signal_count', 'body']),\n  resource: new Set([\n    'id', 'type', 'title', 'body', 'media_type', 'resource_type', 'cover', 'cover_image',\n    'source_url', 'book_id', 'readwise_book_id', 'status', 'rating', 'priority', 'author',\n    'year', 'pages', 'category', 'isbn', 'title_pt_br', 'title_original', 'publisher',\n    'language', 'google_books_id', 'imdb_id', 'read', 'start_date', 'end_date', 'scheduler',\n    'links', 'categories', 'tags', 'aliases', 'organizers', 'reminders', 'archived',\n    'created_at', 'updated_at', 'order',\n  ]),\n  area:",
  },
  {
    label: 'resource type map',
    from: "      'wellbeing_indicator': 'wellbeing_indicator',\n      'area': 'area',",
    to: "      'wellbeing_indicator': 'wellbeing_indicator',\n      'resource': 'resource',\n      'area': 'area',",
  },
]);

console.log('Resource is now a first-class Quartzo object in the Companion parser contract.');
