import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/ui/shell/view.ts', 'utf8');

describe('Organization Issues ignored folders surface', () => {
  it('manages ignored folders inline instead of redirecting to Settings', () => {
    expect(source).toContain('Ignored folders affect Organization Issues only');
    expect(source).toContain('System exclusion');
    expect(source).toContain('Add folder');
    expect(source).toContain('Remove');
    expect(source).toContain('normalizeIssueIgnoredFolders');
    expect(source).not.toContain("settingsBtn.addEventListener('click', () => {\n       this.context.plugin.openSettings();");
  });

  it('filters the already-projected issue list without rebuilding the projection per interaction', () => {
    expect(source).toContain('const renderFilteredIssues = () => {');
    expect(source).toMatch(/catSelect\.addEventListener\('change',\s*\(\)\s*=>\s*\{\s*this\.issueCategoryFilter = catSelect\.value as IssueCategory \| 'All';\s*renderFilteredIssues\(\);/);
    expect(source).toMatch(/searchInput\.addEventListener\('input',\s*\(\)\s*=>\s*\{\s*this\.issueSearchQuery = searchInput\.value;\s*renderFilteredIssues\(\);/);
  });
});
