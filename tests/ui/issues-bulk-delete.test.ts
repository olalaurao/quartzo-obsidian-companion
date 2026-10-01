import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const shellSource = readFileSync(resolve(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
const deleteModalSource = readFileSync(resolve(process.cwd(), 'src/ui/organization/delete-modal.ts'), 'utf8');
const repositorySource = readFileSync(resolve(process.cwd(), 'src/vault/object-organization.ts'), 'utf8');
const coordinatorSource = readFileSync(resolve(process.cwd(), 'src/sync/coordinator/index.ts'), 'utf8');

describe('Organization Issues bulk delete contract', () => {
  it('offers bulk and per-row delete through one canonical delete modal', () => {
    expect(shellSource).toContain("text: 'Delete selected…'");
    expect(shellSource).toContain("text: 'Delete…'");
    expect(shellSource).toContain("require('../organization/delete-modal')");
    expect(shellSource).toContain('openBulkDelete(selectedPaths)');
    expect(shellSource).toContain('isDeletableIssue');
  });

  it('renders observable preflight progress before scanning a large selection', () => {
    expect(deleteModalSource).toMatch(/async onOpen\(\): Promise<void> \{[\s\S]*?this\.render\(\);[\s\S]*?await this\.refreshPreview\(\)/);
    expect(deleteModalSource).toContain("phase: 'checking_files'");
    expect(deleteModalSource).toContain('Checking files ${progress.completed}/${progress.total}…');
    expect(deleteModalSource).toContain("phase: 'checking_sync'");
    expect(deleteModalSource).toContain('Checking sync safety for ${progress.total} selected file');
    expect(deleteModalSource).toContain("status.setAttribute('role', 'status')");
    expect(deleteModalSource).toContain('window.setTimeout(resolve, 0)');
  });

  it('uses canonical retirement instead of raw vault deletion', () => {
    expect(deleteModalSource).toContain('applyRetirements(preview.requests)');
    expect(deleteModalSource).toContain('preflightCanonicalRetire');
    expect(repositorySource).toContain('canonicalRetirementPath');
    expect(repositorySource).toContain('this.vault.rename(sourceNow, destinationPath)');
    expect(repositorySource).not.toContain('this.vault.delete(');
    expect(deleteModalSource).not.toContain('.vault.delete(');
    expect(shellSource).not.toContain('.vault.delete(');
  });

  it('requires Drive baseline proof and race-safe revalidation before remote rename', () => {
    expect(coordinatorSource).toContain('async preflightCanonicalRetire');
    expect(coordinatorSource).toContain("reason: 'remote_changed'");
    expect(coordinatorSource).toContain('const currentRemoteHash = await this.driveAdapter.resolveRemoteHash(currentRemote)');
    expect(coordinatorSource).toContain('currentRemoteHash !== oldSyncFile.baseHash');
    expect(coordinatorSource).toContain('this.pendingRenames.find(rename => rename.oldPath === normalizedRemote)');
  });

  it('keeps _deleted outside the live Issues projection', () => {
    const projectionSource = readFileSync(resolve(process.cwd(), 'src/core/object-organization/issues-projection.ts'), 'utf8');
    expect(projectionSource).toContain("['app', '_deleted']");
  });
});
