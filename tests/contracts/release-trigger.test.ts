import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
const runbook = readFileSync('docs/BETA_RELEASE_RUNBOOK.md', 'utf8');

describe('release tag trigger contract', () => {
  it('keeps automated-tag publication inside the single canonical Release workflow', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('release_tag:');
    expect(workflow).toContain("RELEASE_TAG: ${{ github.event_name == 'workflow_dispatch' && inputs.release_tag || github.ref_name }}");
    expect(workflow).toContain('git rev-list -n 1 "$RELEASE_TAG"');
    expect(workflow).toContain('RELEASE_SHA=$release_sha');
    expect(workflow).toContain('git merge-base --is-ancestor "$RELEASE_SHA" origin/main');
    expect(workflow).toContain('select(.head_sha == env.RELEASE_SHA and .conclusion == "success")');
    expect(workflow).toContain('GITHUB_REF_TYPE=tag GITHUB_REF_NAME="$RELEASE_TAG" RELEASE_MODE=true npm run release:validate');
    expect(workflow).toContain('Revalidate tag before publication');
    expect(workflow).toContain('current_sha="$(git rev-list -n 1 "$RELEASE_TAG")"');
    expect(workflow).toContain('tag_name: ${{ env.RELEASE_TAG }}');
  });

  it('documents that GITHUB_TOKEN tag pushes do not recursively trigger Release', () => {
    expect(runbook).toContain("A tag push created with a workflow's `GITHUB_TOKEN` does not recursively start the tag-triggered Release workflow");
    expect(runbook).toContain('explicitly dispatch **Release** with `release_tag=<exact version>`');
    expect(runbook).toContain('Do not create a second release workflow');
  });
});
