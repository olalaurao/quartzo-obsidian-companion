import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const actionReportSource = readFileSync(resolve(process.cwd(), 'src/ui/action-report.ts'), 'utf8');
const shellSource = readFileSync(resolve(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
const quickAddSource = readFileSync(resolve(process.cwd(), 'src/ui/quick-add/modal.ts'), 'utf8');
const linkCaptureSource = readFileSync(resolve(process.cwd(), 'src/ui/quick-add/link-capture/view.ts'), 'utf8');
const guidelines = readFileSync(resolve(process.cwd(), 'guidelines.md'), 'utf8');
const agents = readFileSync(resolve(process.cwd(), 'agents.md'), 'utf8');

describe('UX Confidence Pack contracts', () => {
  it('provides a reusable persistent action report renderer with copy diagnostics', () => {
    expect(actionReportSource).toContain('export interface ActionReport');
    expect(actionReportSource).toContain("kind: string");
    expect(actionReportSource).toContain("attempted?: number");
    expect(actionReportSource).toContain("applied?: number");
    expect(actionReportSource).toContain("skipped?: number");
    expect(actionReportSource).toContain("failed?: number");
    expect(actionReportSource).toContain('export function renderActionReport');
    expect(actionReportSource).toContain('navigator.clipboard.writeText');
    expect(actionReportSource).toContain('Copy diagnostics');
  });

  it('keeps the report renderer presentation-only', () => {
    expect(actionReportSource).not.toContain("from '../../sync");
    expect(actionReportSource).not.toContain("from '../sync");
    expect(actionReportSource).not.toContain('ObjectOrganizationRepository');
    expect(actionReportSource).not.toContain('.vault.create(');
    expect(actionReportSource).not.toContain('.vault.modify(');
    expect(actionReportSource).not.toContain('.vault.delete(');
  });

  it('projects persistent reports in Workbench and Sync Center in addition to Notice', () => {
    expect(shellSource).toContain('issueWorkbenchReport: ActionReport | null');
    expect(shellSource).toContain('syncActionReport: ActionReport | null');
    expect(shellSource).toContain('renderActionReport(workbench');
    expect(shellSource).toContain('renderActionReport(summary');
    expect(shellSource).toContain('syncResultToActionReport');
    expect(shellSource).toContain('new Notice');
  });

  it('projects inline Quick Add and Save Link success, duplicate, and blocked feedback', () => {
    expect(quickAddSource).toContain('private actionReport: ActionReport | null');
    expect(quickAddSource).toContain("kind: 'quick_add.create'");
    expect(quickAddSource).toContain("kind: 'quick_add.blocked'");
    expect(quickAddSource).toContain("kind: 'quick_add.duplicate'");
    expect(quickAddSource).toContain('renderActionReport');
    expect(linkCaptureSource).toContain("kind: 'quick_add.link_create'");
    expect(linkCaptureSource).toContain("kind: 'quick_add.link_blocked'");
    expect(linkCaptureSource).toContain("kind: 'quick_add.link_duplicate'");
    expect(linkCaptureSource).toContain('renderActionReport');
  });

  it('documents the persistent feedback rule in product and architecture guidelines', () => {
    expect(guidelines).toContain('Feedback persistente de ações do usuário');
    expect(guidelines).toContain('`Notice` é suplementar');
    expect(agents).toContain('Persistent user-action feedback');
    expect(agents).toContain('`Notice` is supplemental');
  });
});
