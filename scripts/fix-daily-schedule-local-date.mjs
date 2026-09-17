import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function replaceExact(filePath, from, to, label) {
  const file = path.join(root, filePath);
  let content = fs.readFileSync(file, 'utf8');
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  content = content.replace(from, to);
  fs.writeFileSync(file, content);
}

replaceExact(
  'src/core/daily_schedule/engine.ts',
  "import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';\n",
  "import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';\nimport { localIsoDate } from '../local-date';\n",
  'Daily Schedule local date import',
);
replaceExact(
  'src/core/daily_schedule/engine.ts',
  "    const targetDate = nextContactDate.toISOString().split('T')[0];",
  '    const targetDate = localIsoDate(nextContactDate);',
  'person contact local date projection',
);

const architecturePath = path.join(root, 'scripts/architecture-check.mjs');
let architecture = fs.readFileSync(architecturePath, 'utf8');
const oldLine = "  const main = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');\n  const forbidden = ['toISOString().slice(0, 10)', 'setUTCDate(', 'getUTCDay(', 'Date.UTC(', 'Math.random().toString(36)'];\n  const violations = forbidden.filter(pattern => shell.includes(pattern) || main.includes(pattern));";
const newLine = "  const main = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');\n  const dailySchedule = fs.readFileSync(path.join(rootDir, 'src/core/daily_schedule/engine.ts'), 'utf8');\n  const forbidden = ['toISOString().slice(0, 10)', \"toISOString().split('T')[0]\", 'setUTCDate(', 'getUTCDay(', 'Date.UTC(', 'Math.random().toString(36)'];\n  const violations = forbidden.filter(pattern => shell.includes(pattern) || main.includes(pattern) || dailySchedule.includes(pattern));";
if (!architecture.includes(oldLine)) throw new Error('Architecture local-date check shape changed unexpectedly');
architecture = architecture.replace(oldLine, newLine);
fs.writeFileSync(architecturePath, architecture);

console.log('Daily Schedule person-contact projection now uses canonical local date semantics.');
