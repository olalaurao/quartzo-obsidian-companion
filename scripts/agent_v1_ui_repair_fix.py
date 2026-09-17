from pathlib import Path
import re

ROOT = Path('.')

def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8', newline='\n')

core_shared = r'''import { ObjectParser } from './objects';
import type { ObjectType, ParseResult } from './objects/types';

export const SHARED_SETTINGS_PATH = 'app/quartzo_shared_settings.md';

export type MarkerType = 'tag' | 'property' | 'folder';

export interface TypeSignature {
  objectType: string;
  markerType: MarkerType;
  markerValue: string;
  emoji?: string;
  iconName?: string | null;
  colorHex?: string | null;
}

export interface QuartzoSharedSettings {
  schemaVersion: number;
  typeSignatures: Record<string, TypeSignature>;
  folderPaths: Record<string, string>;
  categoryColors: Record<string, string>;
  accentColor: string;
  plannerColorMode: string;
  plannerVisibleKinds: string[];
  plannerShowAdaptiveTimeBlocks: boolean;
  startOfWeek: number;
  dayStartHour: number;
  showDayDialLegend: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> {
  const source = asRecord(value);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, String(item)]));
}

export function normalizeSharedFolder(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function normalizeSharedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '');
}

function parseSignature(value: unknown, key: string): TypeSignature | null {
  const raw = asRecord(value);
  const markerType = String(raw.markerType ?? '');
  const markerValue = String(raw.markerValue ?? '');
  if (!['tag', 'property', 'folder'].includes(markerType) || !markerValue.trim()) return null;
  return {
    objectType: String(raw.objectType ?? key),
    markerType: markerType as MarkerType,
    markerValue,
    emoji: raw.emoji == null ? undefined : String(raw.emoji),
    iconName: raw.iconName == null ? null : String(raw.iconName),
    colorHex: raw.colorHex == null ? null : String(raw.colorHex),
  };
}

export function parseSharedSettings(markdown: string): QuartzoSharedSettings | null {
  const parsed = ObjectParser.parseMarkdown(markdown);
  const fm = parsed.frontmatter;
  if (fm.type !== 'quartzo_shared_settings') return null;

  const rawSignatures = asRecord(fm.type_signatures);
  const typeSignatures: Record<string, TypeSignature> = {};
  for (const [key, value] of Object.entries(rawSignatures)) {
    const signature = parseSignature(value, key);
    if (signature) typeSignatures[key] = signature;
  }

  const planner = asRecord(fm.planner);
  const calendar = asRecord(fm.calendar);
  const day = asRecord(fm.day);
  const dayDial = asRecord(fm.day_dial);
  const visibleKinds = Array.isArray(planner.visible_kinds)
    ? planner.visible_kinds.map(value => String(value))
    : [];

  return {
    schemaVersion: Number(fm.schema_version ?? 1),
    typeSignatures,
    folderPaths: stringMap(fm.folder_paths),
    categoryColors: stringMap(fm.category_colors),
    accentColor: String(fm.accent_color ?? '#F97316'),
    plannerColorMode: String(planner.color_mode ?? 'category'),
    plannerVisibleKinds: visibleKinds,
    plannerShowAdaptiveTimeBlocks: planner.show_adaptive_time_blocks !== false,
    startOfWeek: Number(calendar.start_of_week ?? 1),
    dayStartHour: Number(day.start_hour ?? 0),
    showDayDialLegend: dayDial.show_legend !== false,
  };
}

export function resolveTypeSignature(
  settings: QuartzoSharedSettings | null,
  objectType: string,
): TypeSignature | null {
  if (!settings) return null;
  return settings.typeSignatures[objectType]
    ?? Object.values(settings.typeSignatures).find(signature => signature.objectType === objectType)
    ?? null;
}

export function resolveCreationFolder(
  settings: QuartzoSharedSettings | null,
  objectType: string,
): string | null {
  if (!settings) return null;
  const signature = resolveTypeSignature(settings, objectType);
  if (signature?.markerType === 'folder') {
    const folder = normalizeSharedFolder(signature.markerValue);
    return folder || null;
  }
  const configured = settings.folderPaths[objectType];
  if (!configured) return null;
  const folder = normalizeSharedFolder(configured);
  return folder || null;
}

export function applyTypeSignature(
  frontmatter: Record<string, unknown>,
  body: string,
  signature: TypeSignature | null,
): { frontmatter: Record<string, unknown>; body: string } {
  if (!signature) return { frontmatter: { ...frontmatter }, body };
  const next = { ...frontmatter };
  if (signature.markerType === 'property') {
    const separator = signature.markerValue.indexOf(':');
    if (separator >= 0) {
      const key = signature.markerValue.slice(0, separator).trim();
      const value = signature.markerValue.slice(separator + 1).trim();
      if (key) next[key] = value;
    } else {
      const key = signature.markerValue.trim();
      if (key) next[key] = true;
    }
  }
  if (signature.markerType === 'tag') {
    const marker = signature.markerValue.trim();
    if (marker && !body.split(/\s+/).includes(marker)) {
      body = body.trimEnd() + (body.trim() ? '\n\n' : '') + marker;
    }
  }
  return { frontmatter: next, body };
}

function propertySignatureMatches(frontmatter: Record<string, unknown>, markerValue: string): boolean {
  const separator = markerValue.indexOf(':');
  if (separator < 0) return frontmatter[markerValue.trim()] === true;
  const key = markerValue.slice(0, separator).trim();
  const expected = markerValue.slice(separator + 1).trim().toLowerCase();
  const actual = frontmatter[key];
  if (Array.isArray(actual)) return actual.some(item => String(item).trim().toLowerCase() === expected);
  return String(actual ?? '').trim().toLowerCase() === expected;
}

function tagSignatureMatches(frontmatter: Record<string, unknown>, body: string, markerValue: string): boolean {
  const marker = markerValue.trim();
  const normalized = marker.replace(/^#/, '');
  const tags = frontmatter.tags;
  if (Array.isArray(tags) && tags.some(tag => String(tag).replace(/^#/, '') === normalized)) return true;
  const token = marker.startsWith('#') ? marker : `#${marker}`;
  return body.split(/\s+/).includes(token) || body.split(/\s+/).includes(marker);
}

export function identifyTypeFromSignatures(
  settings: QuartzoSharedSettings | null,
  filePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): ObjectType | null {
  if (!settings) return null;
  const normalizedPath = normalizeSharedPath(filePath);
  const matches = new Set<string>();

  for (const signature of Object.values(settings.typeSignatures)) {
    let matched = false;
    if (signature.markerType === 'folder') {
      const folder = normalizeSharedFolder(signature.markerValue);
      matched = normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
    } else if (signature.markerType === 'property') {
      matched = propertySignatureMatches(frontmatter, signature.markerValue);
    } else if (signature.markerType === 'tag') {
      matched = tagSignatureMatches(frontmatter, body, signature.markerValue);
    }
    if (matched) matches.add(signature.objectType);
  }

  if (matches.size !== 1) return null;
  return [...matches][0] as ObjectType;
}

export function parseObjectWithSharedSettings(
  markdown: string,
  filePath: string,
  settings: QuartzoSharedSettings | null,
): ParseResult {
  try {
    return ObjectParser.parse(markdown);
  } catch (originalError) {
    const parsed = ObjectParser.parseMarkdown(markdown);
    const identified = identifyTypeFromSignatures(settings, filePath, parsed.frontmatter, parsed.body);
    if (!identified) throw originalError;
    return ObjectParser.parse(ObjectParser.serializeMarkdown({ ...parsed.frontmatter, type: identified }, parsed.body));
  }
}
'''
write('src/core/shared-settings.ts', core_shared)

vault_wrapper = r'''import { TFile, Vault } from 'obsidian';
import {
  SHARED_SETTINGS_PATH,
  parseSharedSettings,
  type QuartzoSharedSettings,
} from '../core/shared-settings';

export * from '../core/shared-settings';

export class SharedSettingsRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<QuartzoSharedSettings | null> {
    const file = this.vault.getAbstractFileByPath(SHARED_SETTINGS_PATH);
    if (!(file instanceof TFile)) return null;
    return parseSharedSettings(await this.vault.read(file));
  }
}
'''
write('src/vault/shared-settings.ts', vault_wrapper)

creation = r'''import { ObjectParser } from './objects';
import {
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from './shared-settings';

export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder';

export interface QuickAddInput {
  title: string;
  body: string;
  date?: string;
  time?: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildQuickAddDocument(
  settings: QuartzoSharedSettings | null,
  type: QuickAddType,
  input: QuickAddInput,
  id: string,
): { path: string; content: string } {
  const folder = resolveCreationFolder(settings, type);
  if (!folder) {
    throw new Error(`No canonical creation folder is configured for ${type}. Configure Object Identification in Quartzo first.`);
  }
  const title = input.title.trim() || (type === 'entry' ? 'Journal Entry' : 'Untitled');
  const frontmatter: Record<string, unknown> = { id, type, title };
  if (type === 'entry') {
    frontmatter.date = input.date ?? isoDate(new Date());
    if (input.time) frontmatter.time = input.time;
  }
  if (type === 'reminder') {
    frontmatter.date = input.date ?? isoDate(new Date());
    frontmatter.time = input.time ?? '09:00';
    frontmatter.is_completed = false;
    frontmatter.reminder_id = id;
    frontmatter.reminder_count = 1;
  }
  const signature = resolveTypeSignature(settings, type);
  const signed = applyTypeSignature(frontmatter, input.body, signature);
  const path = `${folder}/${id}.md`.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
  const roundtrip = ObjectParser.parse(content);
  if (roundtrip.object.id !== id || roundtrip.object.type !== type) {
    throw new Error(`Creation roundtrip failed for ${type}`);
  }
  return { path, content };
}
'''
write('src/core/object-creation.ts', creation)

shell_path = ROOT / 'src/ui/shell/view.ts'
shell = shell_path.read_text(encoding='utf-8')
shell = shell.replace("import { ObjectParser } from '../../core/objects';\nimport type { ObjectType } from '../../core/objects/types';\n", "import { buildQuickAddDocument, type QuickAddType } from '../../core/object-creation';\n")
shell = shell.replace("  applyTypeSignature,\n  resolveCreationFolder,\n  resolveTypeSignature,\n  type QuartzoSharedSettings,\n", "")
shell = shell.replace("export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder';\n\ninterface QuickAddInput {\n  title: string;\n  body: string;\n  date?: string;\n  time?: string;\n}\n\n", "")
start = shell.find('export function buildQuickAddDocument(')
end = shell.find('\nclass QuickAddModal', start)
if start < 0 or end < 0:
    raise RuntimeError('Could not remove shell-local Quick Add builder')
shell = shell[:start] + shell[end + 1:]
write('src/ui/shell/view.ts', shell)

shared_test = ROOT / 'tests/vault/shared-settings.test.ts'
text = shared_test.read_text(encoding='utf-8').replace("../../src/vault/shared-settings", "../../src/core/shared-settings")
write('tests/vault/shared-settings.test.ts', text)

ui_test = ROOT / 'tests/contracts/ui_shell.test.ts'
text = ui_test.read_text(encoding='utf-8')
text = text.replace("import { buildQuickAddDocument } from '../../src/ui/shell/view';", "import { buildQuickAddDocument } from '../../src/core/object-creation';")
text = text.replace("import { parseSharedSettings } from '../../src/vault/shared-settings';", "import { parseSharedSettings } from '../../src/core/shared-settings';")
write('tests/contracts/ui_shell.test.ts', text)

regression_path = ROOT / 'tests/sync/regression.test.ts'
regression = regression_path.read_text(encoding='utf-8')
old_pair = """    it('SyncCenterView renders folder list for explicit selection', () => {\n      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');\n      expect(mainSrc).toContain('folder-selection');\n      expect(mainSrc).toContain('listQuartzoVaultCandidates');\n      expect(mainSrc).toContain('confirm-pairing-btn');\n    });"""
new_pair = """    it('single Quartzo shell renders explicit vault candidates before pairing', () => {\n      const shellSrc = fs.readFileSync(path.join(__dirname, '../../src/ui/shell/view.ts'), 'utf-8');\n      expect(shellSrc).toContain('listQuartzoVaultCandidates');\n      expect(shellSrc).toContain('Pair with');\n      expect(shellSrc).toContain('confirmPairing(candidate.id, candidate.name, false, false)');\n    });"""
if old_pair not in regression:
    raise RuntimeError('Old pairing regression not found')
regression = regression.replace(old_pair, new_pair)
old_parser = """    it('main.ts uses ObjectParser from core/objects', () => {\n      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');\n      expect(mainSrc).toContain(\"import { ObjectParser } from './core/objects'\");\n      expect(mainSrc).toContain('ObjectParser.parse(content)');\n    });"""
new_parser = """    it('vault indexing uses the canonical parser plus shared Object Identification', () => {\n      const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf-8');\n      const indexSrc = fs.readFileSync(path.join(__dirname, '../../src/vault/index/engine.ts'), 'utf-8');\n      expect(mainSrc).toContain('parseObjectWithSharedSettings');\n      expect(mainSrc).toContain('SharedSettingsRepository');\n      expect(indexSrc).toContain('parseFile(file.content, file.path)');\n    });"""
if old_parser not in regression:
    raise RuntimeError('Old parser regression not found')
regression = regression.replace(old_parser, new_parser)
write('tests/sync/regression.test.ts', regression)

print('V1 UI repair boundary fixes applied')
