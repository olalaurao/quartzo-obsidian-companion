import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/core/objects/parser.ts');
let source = fs.readFileSync(file, 'utf8');

function replaceExact(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  source = source.replace(from, to);
}

replaceExact(
  '  TrackerDefinition,\n  Entry,',
  '  TrackerDefinition,\n  TrackingRecord,\n  Entry,',
  'TrackingRecord import',
);
replaceExact(
  "  tracker_record: new Set(['id', 'type', 'title', 'tracker_id', 'date', 'body']),",
  "  tracker_record: new Set(['id', 'type', 'title', 'tracker_id', 'date', 'field_values', 'body']),",
  'TrackingRecord known fields',
);
replaceExact(
  `        } as TrackerDefinition;\n        break;\n      \n      case 'entry':`,
  `        } as TrackerDefinition;\n        break;\n\n      case 'tracker_record':\n        object = {\n          ...baseObject,\n          type: 'tracker_record',\n          tracker_id: String(frontmatter.tracker_id || ''),\n          date: String(frontmatter.date || ''),\n          field_values: frontmatter.field_values && typeof frontmatter.field_values === 'object' && !Array.isArray(frontmatter.field_values)\n            ? { ...(frontmatter.field_values as Record<string, unknown>) }\n            : {},\n        } as TrackingRecord;\n        break;\n      \n      case 'entry':`,
  'TrackingRecord parse case',
);

fs.writeFileSync(file, source);
console.log('TrackingRecord parser now owns tracker_id, date and field_values canonically.');
