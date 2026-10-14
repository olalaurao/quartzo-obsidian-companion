import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const shellSource = readFileSync(resolve(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
const batchCreateSource = readFileSync(resolve(process.cwd(), 'src/ui/organization/batch-create-modal.ts'), 'utf8');
const batchMergeSource = readFileSync(resolve(process.cwd(), 'src/ui/organization/batch-merge-modal.ts'), 'utf8');
const mergeSource = readFileSync(resolve(process.cwd(), 'src/ui/organization/merge-modal.ts'), 'utf8');
const repositorySource = readFileSync(resolve(process.cwd(), 'src/vault/object-organization.ts'), 'utf8');

describe('Organization Workbench UI contract', () => {
  it('exposes Workbench actions from Organization Issues', () => {
    expect(shellSource).toContain('Organization Workbench');
    expect(shellSource).toContain('Analyze selection');
    expect(shellSource).toContain('Merge duplicate groups');
    expect(shellSource).toContain('Batch create…');
    expect(shellSource).toContain('renderActionReport(workbench');
    expect(shellSource).toContain('planBatchAnalysis');
  });

  it('routes batch create through the canonical repository owner', () => {
    expect(batchCreateSource).toContain('planBatchCreate');
    expect(batchCreateSource).toContain('parseBatchCreateInput');
    expect(batchCreateSource).toContain('applyBatchCreate(plan)');
    expect(batchCreateSource).not.toContain('.vault.create(');
    expect(repositorySource).toContain('async applyBatchCreate');
    expect(repositorySource).toContain('this.vault.create(action.path, action.content)');
  });

  it('routes batch duplicate merge through planMerge and applyMerge', () => {
    expect(batchMergeSource).toContain('planMerge');
    expect(batchMergeSource).toContain('applyMerge(group.plan)');
    expect(batchMergeSource).toContain("bodyResolution: 'combine'");
    expect(batchMergeSource).not.toContain('.vault.delete(');
    expect(batchMergeSource).toContain('createAliases = true');
    expect(batchMergeSource).toContain('aliasesToAdd: this.createAliases ? aliases : []');
    expect(batchMergeSource).toContain('Create aliases from previous names');
    expect(batchMergeSource).toContain('index.files.values()');
  });

  it('offers editable aliases in individual merges and repairs references before retirement', () => {
    expect(mergeSource).toContain('createAliases = true');
    expect(mergeSource).toContain('aliasesToAdd: this.createAliases ? this.parseAliases(this.aliasesText) : []');
    expect(mergeSource).toContain('dd.addOption(obj.path');
    const rewrite = repositorySource.indexOf('rewriteMergeWikiLinks(');
    const retire = repositorySource.indexOf('await this.retireFile({', rewrite);
    expect(rewrite).toBeGreaterThanOrEqual(0);
    expect(retire).toBeGreaterThan(rewrite);
    expect(repositorySource).toContain('restoreMergeLoser(');
  });
});
