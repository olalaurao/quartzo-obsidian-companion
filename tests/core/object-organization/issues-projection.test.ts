import { describe, it, expect } from 'vitest';
import {
  projectOrganizationIssues,
  isPathInsideIssueIgnoredFolder,
  normalizeIssueFolderPath,
} from '../../../src/core/object-organization/issues-projection';
import { VaultIndex } from '../../../src/vault/index/types';

describe('issues-projection path-ignore logic', () => {
  it('normalizes folder paths correctly', () => {
    expect(normalizeIssueFolderPath(' ')).toBe('');
    expect(normalizeIssueFolderPath('_trash')).toBe('_trash');
    expect(normalizeIssueFolderPath('/_trash/')).toBe('_trash');
    expect(normalizeIssueFolderPath('\\_trash\\')).toBe('_trash');
    expect(normalizeIssueFolderPath(' SOME/folder ')).toBe('some/folder');
  });

  it('identifies if a path is inside an ignored folder', () => {
    const folders = ['_trash', 'hidden/stuff'];
    
    expect(isPathInsideIssueIgnoredFolder('foo.md', folders)).toBe(false);
    expect(isPathInsideIssueIgnoredFolder('_trash/foo.md', folders)).toBe(true);
    expect(isPathInsideIssueIgnoredFolder('_trash/sub/foo.md', folders)).toBe(true);
    expect(isPathInsideIssueIgnoredFolder('hidden/stuff/foo.md', folders)).toBe(true);
    expect(isPathInsideIssueIgnoredFolder('hidden/stuff2/foo.md', folders)).toBe(false);
    expect(isPathInsideIssueIgnoredFolder('_trash_other/foo.md', folders)).toBe(false);
  });

  it('ignores files in system and ignored folders', () => {
    const index: VaultIndex = { objects: new Map() };
    
    // Add an object that is valid but inside an ignored folder
    index.objects.set('1', {
      id: '1',
      type: 'test_type',
      path: '_trash/my-object.md',
      frontmatter: { id: '1', type: 'test_type' },
      body: '',
      identification: { rulesMatched: 1, typeMatch: 'folder', matchedSignatures: [] }
    });
    
    // Add an object inside app (system)
    index.objects.set('2', {
      id: '2',
      type: 'test_type',
      path: 'app/system-object.md',
      frontmatter: { id: '2', type: 'test_type' },
      body: '',
      identification: { rulesMatched: 1, typeMatch: 'folder', matchedSignatures: [] }
    });
    
    // Add a valid unignored object
    index.objects.set('3', {
      id: '3',
      type: 'test_type',
      path: 'valid/object.md',
      frontmatter: { id: '3', type: 'test_type' },
      body: '',
      identification: { rulesMatched: 1, typeMatch: 'folder', matchedSignatures: [] }
    });

    const allMarkdownPaths = new Set([
      'unidentified.md',
      '_trash/unidentified-trash.md',
      'app/system-unidentified.md',
      '_trash/my-object.md',
      'app/system-object.md',
      'valid/object.md'
    ]);

    const issues = projectOrganizationIssues({
      index,
      settings: null,
      allMarkdownPaths,
      ignoredFolderPaths: ['_trash']
    });

    // Unidentified file in root should be an issue
    const unidentifiedIssue = issues.find(i => i.subjectPath === 'unidentified.md');
    expect(unidentifiedIssue).toBeDefined();

    // Unidentified file in _trash or app should NOT be an issue
    const trashUnidentifiedIssue = issues.find(i => i.subjectPath === '_trash/unidentified-trash.md');
    expect(trashUnidentifiedIssue).toBeUndefined();
    
    const appUnidentifiedIssue = issues.find(i => i.subjectPath === 'app/system-unidentified.md');
    expect(appUnidentifiedIssue).toBeUndefined();

    // Object in _trash or app should NOT be flagged for any issues (e.g. broken relationship, etc)
    const trashObjectIssue = issues.find(i => i.subjectPath === '_trash/my-object.md');
    expect(trashObjectIssue).toBeUndefined();

    const appObjectIssue = issues.find(i => i.subjectPath === 'app/system-object.md');
    expect(appObjectIssue).toBeUndefined();
  });
});
