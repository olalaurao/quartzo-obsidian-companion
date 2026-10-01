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
  id: string; // Deterministic ID for the issue
  category: IssueCategory;
  subjectPath: string;
  subjectId?: string;
  title: string;
  why: string; // Evidence-first reasoning (§46)
  actionable: boolean;
}

export interface IssuesProjectionInput {
  index: VaultIndex;
  settings: QuartzoSharedSettings | null;
  allMarkdownPaths: ReadonlySet<string>;
  ignoredFolderPaths: readonly string[];
}

export function normalizeIssueFolderPath(folderPath: string): string {
  if (!folderPath) return '';
  let normalized = folderPath.replace(/\\/g, '/').trim().toLowerCase();
  while (normalized.startsWith('/')) normalized = normalized.substring(1);
  while (normalized.endsWith('/')) normalized = normalized.substring(0, normalized.length - 1);
  return normalized;
}

export function isPathInsideIssueIgnoredFolder(filePath: string, normalizedFolders: readonly string[]): boolean {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/').trim().toLowerCase();
  for (const folder of normalizedFolders) {
    if (!folder) continue;
    if (normalizedPath === folder || normalizedPath.startsWith(folder + '/')) {
      return true;
    }
  }
  return false;
}

export function projectOrganizationIssues(input: IssuesProjectionInput): OrganizationIssue[] {
  const { index, settings, allMarkdownPaths, ignoredFolderPaths } = input;
  const issues: OrganizationIssue[] = [];
  const normalizedIgnoredFolders = Array.from(new Set(ignoredFolderPaths.map(normalizeIssueFolderPath).filter(Boolean)));

  // §47: Unidentified files
  // Files that are valid markdown but don't exist in the VaultIndex (because they didn't match any rule).
  const indexedPaths = new Set<string>();
  for (const obj of index.objects.values()) {
    indexedPaths.add(obj.path.toLowerCase());
  }

  for (const path of allMarkdownPaths) {
    if (path.startsWith('app/')) continue; // Ignore system
    if (isPathInsideIssueIgnoredFolder(path, normalizedIgnoredFolders)) continue;
    
    const normalized = path.toLowerCase();
    
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

  // Iterate over indexed objects to find other issues
  const idCounts = new Map<string, number>();
  
  const issueEligibleObjects = Array.from(index.objects.values()).filter(obj => !isPathInsideIssueIgnoredFolder(obj.path, normalizedIgnoredFolders));

  for (const obj of issueEligibleObjects) {
    idCounts.set(obj.id, (idCounts.get(obj.id) || 0) + 1);

    // §45: ambiguous (multiple identification rules match)
    if (obj.identification && obj.identification.matchedSignatures.length > 1) {
       // Only an issue if they resolve to different types or markers, though the core currently picks the highest priority.
       // We flag it if they actually conflict in type.
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

    // §45: broken_relationship
    // Basic check for frontmatter links that don't exist in the index.
    const rawLinks = obj.frontmatter.links;
    if (Array.isArray(rawLinks)) {
       for (const link of rawLinks) {
          const match = /^\[\[(.*?)\]\]$/.exec(String(link));
          if (match) {
             const target = match[1].toLowerCase();
             // Simple heuristic: if we can't find an object whose path starts with this target...
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

  // §48/49: Duplicate IDs
  for (const [id, count] of idCounts.entries()) {
     if (count > 1) {
        // Find all eligible paths
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

  // §45: Interrupted
  // If there's an active transition in settings, it might be interrupted if not progressing.
  if (settings && settings.objectIdentification.transition) {
     const t = settings.objectIdentification.transition;
     issues.push({
        id: `interrupted:${t.operationId}`,
        category: 'interrupted',
        subjectPath: 'app/quartzo_shared_settings.md',
        title: 'Interrupted Migration',
        why: `A structural migration for "${t.objectType}" is in phase "${t.phase}".`,
        actionable: false, // Usually resolved by resuming the sync coordinator
     });
  }

  return issues;
}
