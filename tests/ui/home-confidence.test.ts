import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectionSource = readFileSync(resolve(process.cwd(), 'src/ui/home/home-projection.ts'), 'utf8');
const homeViewSource = readFileSync(resolve(process.cwd(), 'src/ui/home/view.ts'), 'utf8');
const shellSource = readFileSync(resolve(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
const guidelines = readFileSync(resolve(process.cwd(), 'guidelines.md'), 'utf8');
const agents = readFileSync(resolve(process.cwd(), 'agents.md'), 'utf8');

describe('Home Confidence Panel contract', () => {
  it('keeps confidence projection presentation-only', () => {
    expect(projectionSource).toContain('export function projectHomeConfidence');
    expect(projectionSource).toContain('HomeConfidenceSnapshot');
    expect(projectionSource).not.toContain("from 'obsidian'");
    expect(projectionSource).not.toContain('DriveSyncCoordinator');
    expect(projectionSource).not.toContain('VaultIndex');
    expect(projectionSource).not.toContain('new Notice');
    expect(projectionSource).not.toContain('.vault.');
  });

  it('renders a persistent confidence panel in Home', () => {
    expect(homeViewSource).toContain('quartzo-home-confidence');
    expect(homeViewSource).toContain('renderHomeConfidencePanel');
    expect(homeViewSource).toContain('options.confidence');
    expect(homeViewSource).toContain('onConfidenceAction');
  });

  it('routes confidence actions to owner surfaces from the shell', () => {
    expect(shellSource).toContain('projectHomeConfidence({');
    expect(shellSource).toContain("await this.handleAction('sync')");
    expect(shellSource).toContain("await this.handleAction('conflicts')");
    expect(shellSource).toContain("await this.setSection('issues')");
    expect(shellSource).not.toContain('onConfidenceAction: action => { void this.context.plugin.driveSyncCoordinator');
  });

  it('documents Home confidence ownership boundaries', () => {
    expect(guidelines).toContain('Home Confidence');
    expect(agents).toContain('Home confidence projection');
  });
});
