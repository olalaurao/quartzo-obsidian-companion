import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/core/daily_schedule/engine.ts');
let source = fs.readFileSync(file, 'utf8');

function replaceExact(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  source = source.replace(from, to);
}

replaceExact(
  "import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';\nimport { localIsoDate } from '../local-date';\n",
  "import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';\nimport { localIsoDate } from '../local-date';\n\ntype PresentationField = 'sourceType' | 'sourceLabel' | 'isCompletable' | 'isCompleted' | 'origin';\ntype RawNormalizedItem = Omit<NormalizedItem, PresentationField>;\n",
  'raw item type',
);
source = source.replaceAll('items: NormalizedItem[]', 'items: RawNormalizedItem[]');
replaceExact(
  '    const items: NormalizedItem[] = [];',
  '    const items: RawNormalizedItem[] = [];',
  'normalize raw items',
);
replaceExact(
  `    // Determine kind based on what was processed\n    const kind = this.determineKind(items, objects, googleEvents);\n\n    return {\n      kind,\n      count: items.length,\n      items\n    };`,
  `    // Enrich the canonical occurrence projection with presentation capabilities.\n    // UI surfaces consume these values and must never infer them independently.\n    const normalizedItems = this.enrichPresentationContract(items, objects);\n\n    // Determine kind based on what was processed\n    const kind = this.determineKind(items, objects, googleEvents);\n\n    return {\n      kind,\n      count: normalizedItems.length,\n      items: normalizedItems\n    };`,
  'presentation enrichment invocation',
);

const marker = `  private static calculateEndTime(startTime: string, durationMinutes: number): string {`;
const helper = `  private static enrichPresentationContract(\n    items: RawNormalizedItem[],\n    objects: Array<Record<string, unknown>>,\n  ): NormalizedItem[] {\n    const byId = new Map<string, Record<string, unknown>>();\n    for (const object of objects) {\n      const id = String(object.id ?? '');\n      if (id) byId.set(id, object);\n    }\n\n    return items.map(item => {\n      const source = byId.get(item.sourceId);\n      const sourceType = source == null ? 'google_calendar' : String(source.type ?? '');\n      const sourcePath = source == null ? '' : String(source.__path ?? '');\n      const rotationGroup = item.id.startsWith('rotation:') ? item.id.split(':')[2] ?? '' : '';\n      const sourceLabel = source == null\n        ? \`google_calendar:${'${item.sourceId}'}\`\n        : rotationGroup\n          ? \`project:${'${item.sourceId}'}:rotation:${'${rotationGroup}'}\`\n          : \`${'${sourceType}'}:${'${item.sourceId}'}:${'${sourcePath}'}\`;\n\n      const completableTypes = new Set([\n        'task', 'habit', 'event', 'reminder', 'time_block', 'system',\n        'routine', 'project', 'goal', 'person',\n      ]);\n      const isCompletable = source != null && completableTypes.has(sourceType);\n      const isCompleted = source == null ? false : this.isSourceCompleted(sourceType, source);\n      const origin = item.id.startsWith('google_calendar:')\n        ? 'externalEvent' as const\n        : item.id.startsWith('legacyTime:')\n          ? 'legacyTime' as const\n          : 'schedule' as const;\n\n      return {\n        ...item,\n        sourceType,\n        sourceLabel,\n        isCompletable,\n        isCompleted,\n        origin,\n      };\n    });\n  }\n\n  private static isSourceCompleted(sourceType: string, source: Record<string, unknown>): boolean {\n    if (source.is_completed === true || source.completed === true) return true;\n    switch (sourceType) {\n      case 'task':\n        return source.stage === 'done' || source.stage === 'completed';\n      case 'event':\n      case 'pomodoro':\n      case 'pomodoro_session':\n        return source.state === 'completed';\n      default:\n        // Completion for Habits, Routines, Time Blocks and other occurrence-keyed\n        // sources is owned by shared occurrence state. Until that state is part\n        // of this input, never guess completion from presentation code.\n        return false;\n    }\n  }\n\n`;
replaceExact(marker, helper + marker, 'presentation enrichment helper');

fs.writeFileSync(file, source);
console.log('Daily Schedule normalized items now carry canonical presentation capabilities.');
