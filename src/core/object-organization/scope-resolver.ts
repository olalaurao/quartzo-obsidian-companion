/**
 * Scope Resolver (§23, §24, §25, §26)
 *
 * Canonical owner of "selection resolution" — transforms Obsidian inputs
 * (files, folders, multi-select) into a ResolvedOrganizationScope.
 *
 * Key invariants:
 * - Folder selection is a SCOPE, not an Object Identification rule (§3.3, §4)
 * - Always offer "This folder only" vs "This folder + subfolders" (§24)
 * - Never infer recursive without showing it (§24)
 * - Attachments are ignored for object mutation and shown as ignoredAttachments (§26)
 * - .base files are ignored and shown as ignoredBases
 * - _deleted/ paths are excluded
 * - deduplicate by normalized path when files and folders overlap (§25)
 * - Do not persist the scope
 */

export interface ResolvedOrganizationScope {
  /** Source files explicitly selected */
  files: string[];
  /** Source folders explicitly selected */
  folders: string[];
  /** Include subfolders when resolving folder scope */
  includeSubfolders: boolean;
  /** Markdown paths eligible for object mutation */
  eligibleMarkdownPaths: string[];
  /** Object IDs already indexed in VaultIndex (subset of eligible) */
  indexedObjectIds: string[];
  /** Markdown paths not yet identified as Quartzo objects */
  unidentifiedMarkdownPaths: string[];
  /** Non-Markdown files ignored for object mutation */
  ignoredAttachments: string[];
  /** .base files ignored for object mutation */
  ignoredBases: string[];
  /** Count of paths removed during deduplication */
  duplicatesRemoved: number;
}

export interface ScopeResolverInput {
  /** Explicitly selected file paths */
  files?: string[];
  /** Explicitly selected folder paths */
  folders?: string[];
  /** If true, include subfolders when expanding folder scope (§24) */
  includeSubfolders: boolean;
  /** All paths in the vault — used to enumerate folder contents */
  allVaultPaths: string[];
  /** Object IDs indexed for each eligible path */
  indexedObjectsByPath: Map<string, string>;
  /** Paths to exclude unconditionally (e.g. _deleted, app/) */
  excludedPaths?: ReadonlySet<string>;
}

const MARKDOWN_EXT = '.md';
const BASE_EXT = '.base';
const DELETED_PREFIX = '_deleted/';
const APP_PREFIX = 'app/';

/**
 * Resolve a selection scope from Obsidian inputs.
 * Does NOT mutate vault or settings — pure computation.
 */
export function resolveOrganizationScope(input: ScopeResolverInput): ResolvedOrganizationScope {
  const { includeSubfolders, allVaultPaths, indexedObjectsByPath } = input;
  const files = (input.files ?? []).map(normalizePath).filter(Boolean);
  const folders = (input.folders ?? []).map(normalizePath).filter(Boolean);
  const excluded = input.excludedPaths ?? new Set<string>();

  // Step 1: expand folders to contained paths
  const fromFolders = new Set<string>();
  for (const folder of folders) {
    for (const vaultPath of allVaultPaths) {
      const normalized = normalizePath(vaultPath);
      if (isUnderFolder(normalized, folder, includeSubfolders)) {
        fromFolders.add(normalized);
      }
    }
  }

  // Step 2: union files + folder-expanded paths, tracking duplicates
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  const allPaths: string[] = [];

  const addPath = (p: string) => {
    if (seen.has(p)) {
      duplicatesRemoved++;
    } else {
      seen.add(p);
      allPaths.push(p);
    }
  };

  for (const f of files) addPath(f);
  for (const f of fromFolders) addPath(f);

  // Step 3: classify
  const eligibleMarkdownPaths: string[] = [];
  const unidentifiedMarkdownPaths: string[] = [];
  const ignoredAttachments: string[] = [];
  const ignoredBases: string[] = [];
  const indexedObjectIds: string[] = [];

  for (const path of allPaths) {
    // Always exclude
    if (excluded.has(path)) continue;
    if (path.startsWith(DELETED_PREFIX)) continue;

    if (path.endsWith(BASE_EXT)) {
      ignoredBases.push(path);
      continue;
    }

    if (!path.endsWith(MARKDOWN_EXT)) {
      ignoredAttachments.push(path);
      continue;
    }

    // Exclude app/ system files (like shared settings)
    if (path.startsWith(APP_PREFIX)) continue;

    eligibleMarkdownPaths.push(path);

    const objectId = indexedObjectsByPath.get(path);
    if (objectId) {
      indexedObjectIds.push(objectId);
    } else {
      unidentifiedMarkdownPaths.push(path);
    }
  }

  return {
    files,
    folders,
    includeSubfolders,
    eligibleMarkdownPaths,
    indexedObjectIds,
    unidentifiedMarkdownPaths,
    ignoredAttachments,
    ignoredBases,
    duplicatesRemoved,
  };
}

/**
 * Returns a human-readable summary of the scope for display before Apply (§24, §25).
 */
export function describeScopeForDisplay(scope: ResolvedOrganizationScope): {
  eligible: number;
  ignored: number;
  includeSubfolders: boolean;
  alreadyType: number;
  summary: string;
} {
  const eligible = scope.eligibleMarkdownPaths.length;
  const ignored = scope.ignoredAttachments.length + scope.ignoredBases.length;
  const summary = `${eligible} Markdown file${eligible !== 1 ? 's' : ''} eligible${ignored > 0 ? `, ${ignored} ignored` : ''}`;
  return {
    eligible,
    ignored,
    includeSubfolders: scope.includeSubfolders,
    alreadyType: 0, // caller fills this after type analysis
    summary,
  };
}

function isUnderFolder(path: string, folder: string, includeSubfolders: boolean): boolean {
  const folderWithSlash = folder.endsWith('/') ? folder : `${folder}/`;
  if (includeSubfolders) {
    return path.startsWith(folderWithSlash);
  }
  // Direct children only: path = folder/filename, no further slash after folder/
  if (!path.startsWith(folderWithSlash)) return false;
  const remainder = path.slice(folderWithSlash.length);
  return !remainder.includes('/');
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}
