/**
 * Issues Projection (§45, §46, §47, §48)
 *
 * Scans the vault index and shared settings to project a list of
 * actionable organization issues. Issues are NOT persisted.
 * Evidence-first: every issue must explain "Why?" (§46).
 */

import type { VaultIndex } from '../../vault/index/types';
import type { QuartzoSharedSettings } from '../shared-settings';

export type IssueCategory =
  | 'unidentified'
  | 'ambiguous'
  | 'mismatch'
  | 'duplicate'
  | 'broken_relationship'
  | 'interrupted';

export interface OrganizationIssue {
  id: string;
  category: IssueCategory;
  subjectPath: string;
  subjectId?: string;
  title: string;
  why: string;
  actionable: boolean;
}

export interface IssuesProjectionInput {
  index: VaultIndex;
  settings: QuartzoSharedSettings | null;
  allMarkdownPaths: ReadonlySet<string>;
  ignoredFolderPaths: readonly string[];
}

const SYSTEM_ISSUE_IGNORED_FOLDERS = ['app', '_deleted'] as const;

export function normalizeIssueFolderPath(folderPath: string): string {
  if (!folderPath) return '';
  let normalized = folderPath.replace(/\\/g, '/').trim().toLowerCase();
  while (normalized.startsWith('/')) normalized = normalized.substring(1);
  while (normalized.endsWith('/')) normalized = normalized.substring(0, normalized.length - 1);
  return normalized;
}

export function normalizeIssueIgnoredFolders(folderPaths: readonly string[]): string[] {
  return Array.from(new Set(folderPaths.map(normalizeIssueFolderPath).filter(Boolean)));
}

export function isPathInsideIssueIgnoredFolder(filePath: string, normalizedFolders: readonly string[]): boolean {
  if (!filePath) return false;
  const normalizedPath = normalizeIssueFolderPath(filePath);
  for (const folder of normalizedFolders) {
    const normalizedFolder = normalizeIssueFolderPath(folder);
    if (!normalizedFolder) continue;
    if (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`)) {
      return true;
    }
  }
  return false;
}

export function isSystemIssuePath(filePath: string): boolean {
  return isPathInsideIssueIgnoredFolder(filePath, SYSTEM_ISSUE_IGNORED_FOLDERS);
}

export function isOrganizationIssuePathExcluded(
  filePath: string,
  ignoredFolderPaths: readonly string[],
): boolean {
  return isSystemIssuePath(filePath)
    || isPathInsideIssueIgnoredFolder(filePath, normalizeIssueIgnoredFolders(ignoredFolderPaths));
}

export function projectOrganizationIssues(input: IssuesProjectionInput): OrganizationIssue[] {
  const { index, settings, allMarkdownPaths, ignoredFolderPaths } = input;
  const issues: OrganizationIssue[] = [];
  const normalizedIgnoredFolders = normalizeIssueIgnoredFolders(ignoredFolderPaths);
  const isExcludedOrdinarySubject = (path: string): boolean =>
    isSystemIssuePath(path) || isPathInsideIssueIgnoredFolder(path, normalizedIgnoredFolders);

  const indexedPaths = new Set<string>();
  for (const obj of index.objects.values()) {
    indexedPaths.add(normalizeIssueFolderPath(obj.path));
  }

  for (const path of allMarkdownPaths) {
    if (isExcludedOrdinarySubject(path)) continue;

    const normalized = normalizeIssueFolderPath(path);
    if (!indexedPaths.has(normalized)) {
      issues.push({
        id: `unidentified:${path}`,
        category: 'unidentified',
        subjectPath: path,
        title: 'Unidentified File',
        why: 'This Markdown file does not match any known Object Identification rule.',
        actionable: true,
      });
    }
  }

  const issueEligibleObjects = Array.from(index.objects.values()).filter(
    obj => !isExcludedOrdinarySubject(obj.path),
  );
  const idCounts = new Map<string, number>();

  for (const obj of issueEligibleObjects) {
    idCounts.set(obj.id, (idCounts.get(obj.id) || 0) + 1);

    if (obj.identification && obj.identification.matchedSignatures.length > 1) {
      const types = new Set(obj.identification.matchedSignatures.map(s => s.objectType));
      if (types.size > 1) {
        issues.push({
          id: `ambiguous:${obj.path}`,
          category: 'ambiguous',
          subjectPath: obj.path,
          subjectId: obj.id,
          title: 'Ambiguous Type',
          why: `Object matches rules for multiple types: ${Array.from(types).join(', ')}. Priority applied ${obj.type}.`,
          actionable: true,
        });
      }
    }

    const rawLinks = obj.frontmatter.links;
    if (Array.isArray(rawLinks)) {
      for (const link of rawLinks) {
        const match = /^\[\[(.*?)\]\]$/.exec(String(link));
        if (match) {
          const target = match[1].toLowerCase();
          const found = Array.from(index.objects.values()).some(o => o.path.toLowerCase().includes(target));
          if (!found) {
            issues.push({
              id: `broken_rel:${obj.path}:${target}`,
              category: 'broken_relationship',
              subjectPath: obj.path,
              subjectId: obj.id,
              title: 'Broken Link',
              why: `Property contains a link to "[[${match[1]}]]", but no matching object exists.`,
              actionable: true,
            });
          }
        }
      }
    }
  }

  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      const paths = issueEligibleObjects.filter(o => o.id === id).map(o => o.path);
      if (paths.length === 0) continue;
      issues.push({
        id: `duplicate:${id}`,
        category: 'duplicate',
        subjectPath: paths[0],
        subjectId: id,
        title: 'Duplicate Object ID',
        why: `The ID "${id}" is shared by ${count} files. Quartzo requires IDs to be unique.`,
        actionable: true,
      });
    }
  }

  if (settings && settings.objectIdentification.transition) {
    const t = settings.objectIdentification.transition;
    issues.push({
      id: `interrupted:${t.operationId}`,
      category: 'interrupted',
      subjectPath: 'app/quartzo_shared_settings.md',
      title: 'Interrupted Migration',
      why: `A structural migration for "${t.objectType}" is in phase "${t.phase}".`,
      actionable: false,
    });
  }

  return issues;
}
