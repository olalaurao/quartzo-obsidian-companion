import { buildQuickAddDocument, type QuickAddInput, type QuickAddType } from '../object-creation';
import { ObjectParser } from '../objects';
import {
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from '../shared-settings';
import type { VaultIndex } from '../../vault/index/types';
import type { OrganizationIssue } from './issues-projection';
import { isOrganizationIssuePathExcluded } from './issues-projection';

export type BatchProgressPhase =
  | 'analyzing'
  | 'checking_files'
  | 'checking_sync'
  | 'applying'
  | 'finalizing';

export interface BatchProgress {
  phase: BatchProgressPhase;
  completed: number;
  total: number;
  currentPath?: string;
}

export interface BatchOperationReport {
  attempted: number;
  applied: number;
  skipped: number;
  failed: number;
  messages: string[];
  failedPath?: string;
}

export interface BatchIssueCategorySummary {
  category: OrganizationIssue['category'];
  count: number;
}

export interface BatchDuplicateGroup {
  objectId: string;
  paths: string[];
  survivorPath: string;
}

export interface BatchAnalysisPlan {
  selectedPathCount: number;
  issueCount: number;
  actionableIssueCount: number;
  categories: BatchIssueCategorySummary[];
  unidentifiedPaths: string[];
  duplicateGroups: BatchDuplicateGroup[];
  availableActions: {
    organize: boolean;
    mergeDuplicates: boolean;
    delete: boolean;
    create: boolean;
  };
  blockers: string[];
  warnings: string[];
}

export type BatchCreatableType = QuickAddType | 'area' | 'project';

export interface BatchCreateDraft {
  type: BatchCreatableType;
  title: string;
  folder?: string;
  body?: string;
  tags?: string[];
  links?: string[];
  sourceUrl?: string;
  platform?: string;
  mediaType?: string;
}

export interface BatchCreateActionPlan {
  draftIndex: number;
  id: string;
  type: BatchCreatableType;
  title: string;
  path: string;
  content: string;
}

export interface BatchCreatePlan {
  kind: 'batch_create';
  actions: BatchCreateActionPlan[];
  blockers: string[];
  warnings: string[];
}

export interface BatchAnalysisInput {
  issues: readonly OrganizationIssue[];
  index: VaultIndex;
  selectedPaths?: readonly string[];
  ignoredFolderPaths: readonly string[];
}

export interface BatchCreatePlanInput {
  settings: QuartzoSharedSettings | null;
  drafts: readonly BatchCreateDraft[];
  existingPaths: ReadonlySet<string>;
  createId?: (draft: BatchCreateDraft, index: number) => string;
}

const SUPPORTED_BATCH_CREATE_TYPES = new Set<BatchCreatableType>([
  'task',
  'entry',
  'note',
  'reminder',
  'resource',
  'recipe',
  'social_post',
  'area',
  'project',
]);

export function planBatchAnalysis(input: BatchAnalysisInput): BatchAnalysisPlan {
  const selected = new Set((input.selectedPaths ?? []).map(normalizePath).filter(Boolean));
  const relevantIssues = selected.size > 0
    ? input.issues.filter(issue => selected.has(normalizePath(issue.subjectPath)))
    : input.issues.slice();

  const categories = new Map<OrganizationIssue['category'], number>();
  for (const issue of relevantIssues) {
    categories.set(issue.category, (categories.get(issue.category) ?? 0) + 1);
  }

  const duplicateGroups = projectDuplicateGroups(input.index, input.ignoredFolderPaths, selected);
  const unidentifiedPaths = relevantIssues
    .filter(issue => issue.category === 'unidentified')
    .map(issue => issue.subjectPath)
    .sort((left, right) => left.localeCompare(right));
  const actionableIssueCount = relevantIssues.filter(issue => issue.actionable).length;

  return {
    selectedPathCount: selected.size,
    issueCount: relevantIssues.length,
    actionableIssueCount,
    categories: Array.from(categories.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category)),
    unidentifiedPaths,
    duplicateGroups,
    availableActions: {
      organize: relevantIssues.some(issue => issue.actionable && ['unidentified', 'ambiguous', 'mismatch'].includes(issue.category)),
      mergeDuplicates: duplicateGroups.length > 0,
      delete: selected.size > 0,
      create: true,
    },
    blockers: [],
    warnings: selected.size === 0
      ? ['No paths are selected. Workbench actions will use all visible Organization Issues where applicable.']
      : [],
  };
}

export function parseBatchCreateInput(text: string): BatchCreateDraft[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = splitLine(lines[0], delimiter);
  const normalizedFirst = firstCells.map(cell => normalizeHeader(cell));
  const hasHeader = normalizedFirst.includes('type') && normalizedFirst.includes('title');
  const headers = hasHeader
    ? normalizedFirst
    : ['type', 'title', 'folder', 'body', 'tags', 'links'];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const drafts: BatchCreateDraft[] = [];
  for (const line of dataLines) {
    const cells = splitLine(line, delimiter);
    const values = new Map<string, string>();
    headers.forEach((header, index) => {
      if (!header) return;
      values.set(header, cells[index]?.trim() ?? '');
    });
    const rawType = values.get('type') ?? '';
    const type = normalizeCreateType(rawType);
    const title = values.get('title') ?? '';
    if (!rawType && !title) continue;
    drafts.push({
      type,
      title,
      folder: optional(values.get('folder')),
      body: optional(values.get('body')),
      tags: splitList(values.get('tags') ?? ''),
      links: splitList(values.get('links') ?? ''),
      sourceUrl: optional(values.get('sourceurl') ?? values.get('source_url') ?? values.get('url')),
      platform: optional(values.get('platform')),
      mediaType: optional(values.get('mediatype') ?? values.get('media_type')),
    });
  }
  return drafts;
}

export function planBatchCreate(input: BatchCreatePlanInput): BatchCreatePlan {
  const actions: BatchCreateActionPlan[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const claimedPaths = new Set(Array.from(input.existingPaths).map(path => normalizePath(path).toLowerCase()));

  input.drafts.forEach((draft, index) => {
    const type = normalizeCreateType(draft.type);
    if (!SUPPORTED_BATCH_CREATE_TYPES.has(type)) {
      blockers.push(`Row ${index + 1}: unsupported batch create type "${draft.type}".`);
      return;
    }
    if (!draft.title.trim() && type !== 'entry') {
      blockers.push(`Row ${index + 1}: title is required for ${type}.`);
      return;
    }

    const id = input.createId?.(draft, index) ?? '';
    if (!id.trim()) {
      blockers.push(`Row ${index + 1}: could not allocate a canonical object ID.`);
      return;
    }

    let document: { path: string; content: string };
    try {
      document = buildBatchCreateDocument(input.settings, draft, id);
    } catch (error) {
      blockers.push(`Row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const normalizedPath = normalizePath(document.path);
    const key = normalizedPath.toLowerCase();
    if (claimedPaths.has(key)) {
      blockers.push(`Row ${index + 1}: target already exists or is duplicated in this batch: ${normalizedPath}.`);
      return;
    }
    claimedPaths.add(key);
    actions.push({
      draftIndex: index,
      id,
      type,
      title: draft.title.trim() || 'Untitled',
      path: normalizedPath,
      content: document.content,
    });
  });

  if (input.drafts.length === 0) warnings.push('Paste at least one row to preview batch creation.');
  return { kind: 'batch_create', actions, blockers, warnings };
}

function projectDuplicateGroups(
  index: VaultIndex,
  ignoredFolderPaths: readonly string[],
  selectedPaths: ReadonlySet<string>,
): BatchDuplicateGroup[] {
  const byId = new Map<string, string[]>();
  for (const object of index.objects.values()) {
    const path = normalizePath(object.path);
    if (isOrganizationIssuePathExcluded(path, ignoredFolderPaths)) continue;
    const paths = byId.get(object.id) ?? [];
    paths.push(path);
    byId.set(object.id, paths);
  }

  return Array.from(byId.entries())
    .filter(([, paths]) => paths.length > 1)
    .filter(([, paths]) => selectedPaths.size === 0 || paths.some(path => selectedPaths.has(path)))
    .map(([objectId, paths]) => {
      const sorted = paths.slice().sort(compareSurvivorPath);
      return {
        objectId,
        paths: sorted,
        survivorPath: sorted[0]!,
      };
    })
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
}

function buildBatchCreateDocument(
  settings: QuartzoSharedSettings | null,
  draft: BatchCreateDraft,
  id: string,
): { path: string; content: string } {
  const type = normalizeCreateType(draft.type);
  if (type === 'area' || type === 'project') {
    return buildOrganizerDocument(settings, draft, id, type);
  }

  const input: QuickAddInput = {
    title: draft.title,
    body: draft.body ?? '',
  };
  if (draft.tags?.length) input.resource = undefined;

  if (type === 'entry') {
    input.date = new Date().toISOString().slice(0, 10);
  }
  if (type === 'reminder') {
    input.date = new Date().toISOString().slice(0, 10);
    input.time = '09:00';
  }
  if (type === 'resource') {
    input.resource = {
      mediaType: draft.mediaType ?? 'General',
      sourceUrl: draft.sourceUrl,
      tags: draft.tags,
      links: draft.links,
      categories: [],
    };
  }
  if (type === 'recipe') {
    input.recipe = {
      sourceUrl: draft.sourceUrl,
    };
  }
  if (type === 'social_post') {
    const url = draft.sourceUrl ?? draft.links?.find(link => /^https?:\/\//i.test(link));
    if (!url) throw new Error('Social Post URL is required. Add a url/source_url column.');
    input.socialPost = {
      url,
      platform: draft.platform ?? platformFromUrl(url),
      mediaType: draft.mediaType ?? 'other',
      personalNote: draft.body,
    };
  }
  if (type === 'tracker_record') {
    throw new Error('Tracker Record batch creation requires tracker fields; use Quick Add for records.');
  }

  const effectiveSettings = draft.folder
    ? withFolderOverride(settings, type === 'recipe' ? 'note' : type, draft.folder)
    : settings;
  return buildQuickAddDocument(effectiveSettings, type, input, id);
}

function buildOrganizerDocument(
  settings: QuartzoSharedSettings | null,
  draft: BatchCreateDraft,
  id: string,
  type: 'area' | 'project',
): { path: string; content: string } {
  const title = draft.title.trim();
  if (!title) throw new Error(`${type} title is required.`);
  const folder = normalizePath(
    draft.folder
      ?? resolveCreationFolder(settings, type)
      ?? (type === 'area' ? 'organizers/areas' : 'organizers/projects'),
  );
  const frontmatter: Record<string, unknown> = {
    id,
    type,
    organizer_type: type,
    title,
  };
  if (type === 'project') frontmatter.rotation_groups = [];
  if (draft.tags?.length) frontmatter.tags = draft.tags;
  if (draft.links?.length) frontmatter.links = draft.links;

  const signature = resolveTypeSignature(settings, type);
  const signed = applyTypeSignature(frontmatter, draft.body ?? '', signature);
  const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
  const parsed = ObjectParser.parse(content).object;
  if (parsed.id !== id || parsed.type !== type) {
    throw new Error(`Creation roundtrip failed for ${type}.`);
  }
  return {
    path: `${folder}/${safeFilename(title || id)}.md`,
    content,
  };
}

function withFolderOverride(
  settings: QuartzoSharedSettings | null,
  objectType: string,
  folder: string,
): QuartzoSharedSettings | null {
  if (!settings) return settings;
  return {
    ...settings,
    folderPaths: {
      ...settings.folderPaths,
      [objectType]: normalizePath(folder),
    },
  };
}

function compareSurvivorPath(left: string, right: string): number {
  const leftDeleted = left === '_deleted' || left.startsWith('_deleted/');
  const rightDeleted = right === '_deleted' || right.startsWith('_deleted/');
  if (leftDeleted !== rightDeleted) return leftDeleted ? 1 : -1;
  return left.length - right.length || left.localeCompare(right);
}

function detectDelimiter(line: string): string {
  if (line.includes('\t')) return '\t';
  if (line.includes('|')) return '|';
  return ',';
}

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map(cell => cell.trim());
}

function normalizeHeader(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'source_url') return 'sourceurl';
  if (normalized === 'media_type') return 'mediatype';
  return normalized;
}

function normalizeCreateType(value: string): BatchCreatableType {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'record') return 'tracker_record';
  return normalized as BatchCreatableType;
}

function splitList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function safeFilename(title: string): string {
  const safe = title.replace(/[*"\\/<>:|?]/g, '').trim();
  return safe || 'Untitled';
}

function platformFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0] || 'web';
  } catch {
    return 'web';
  }
}
