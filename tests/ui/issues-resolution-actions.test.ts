import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const shellSource = readFileSync(resolve(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
const modalSource = readFileSync(resolve(process.cwd(), 'src/ui/organization/modal.ts'), 'utf8');

describe('Organization Issues resolution UI contract', () => {
  it('plans reclassification from exact Vault bytes and canonical IDs', () => {
    expect(modalSource).toContain('await this.context.app.vault.read(file)');
    expect(modalSource).toContain('createCanonicalObjectId()');
    expect(modalSource).toContain('objectIdsByPath');
    expect(modalSource).not.toContain('JSON.stringify(frontmatter, null, 2)');
    expect(modalSource).not.toContain("return ''; // Stub for missing async read");
  });

  it('updates the canonical VaultIndex and verifies the target postcondition before closing', () => {
    expect(modalSource).toContain('updateCanonicalIndex(plan, result.migrated)');
    expect(modalSource).toContain('verifyTargetPostcondition(plan, result.migrated)');
    expect(modalSource).toContain('this.options.onApplied?.');
    expect(modalSource).toContain('still have an Object Identification conflict');
  });

  it('supports multi-select while keeping Organize on the same canonical organization modal', () => {
    expect(shellSource).toContain('issueSelectedPaths = new Set<string>()');
    expect(shellSource).toContain("text: `Select matching (${matchingSelectablePaths.length})`");
    expect(shellSource).toContain("text: 'Organize selected…'");
    expect(shellSource).toContain('if (allSelectedOrganizable) openOrganization(selectedPaths)');
    expect(shellSource).toContain("type: 'checkbox'");
    expect(shellSource).toContain("new Set<IssueCategory>(['unidentified', 'ambiguous', 'mismatch'])");
    expect(shellSource).toContain('const isDeletableIssue =');
    expect(shellSource).toContain('const allSelectedOrganizable =');
  });

  it('opens the exact Issue Markdown when its title is clicked', () => {
    expect(shellSource).toContain("const openIssueMarkdown = (path: string): void =>");
    expect(shellSource).toContain("cls: 'internal-link'");
    expect(shellSource).toContain("title: 'Open Markdown in Obsidian'");
    expect(shellSource).toContain('openIssueMarkdown(issue.subjectPath)');
  });

  it('reprojects Issues after an applied organization operation instead of hiding rows optimistically', () => {
    expect(shellSource).toContain('onApplied: async () =>');
    expect(shellSource).toContain('await this.render()');
    expect(shellSource).toContain("text: 'Open Markdown'");
  });
});
