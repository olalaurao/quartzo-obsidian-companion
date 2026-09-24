import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/core/object-creation';
import { parseSharedSettings } from '../../src/core/shared-settings';
import { ObjectParser } from '../../src/core/objects';
import fs from 'fs';
import path from 'path';

describe('Companion V1 shell contract', () => {
  const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  task:
    objectType: task
    markerType: property
    markerValue: "kind: task"
  entry:
    objectType: entry
    markerType: tag
    markerValue: "#journal"
  note:
    objectType: note
    markerType: folder
    markerValue: notes/custom
  reminder:
    objectType: reminder
    markerType: property
    markerValue: "kind: reminder"
folder_paths:
  task: tasks/custom
  entry: journal/custom
  reminder: reminders/custom
  tracker_record: trackers/records/custom
  resource: resources/custom
---
`)!;

  it.each([
    ['task', { title: 'Prepare campaign', body: 'Draft' }],
    ['entry', { title: 'Reflection', body: 'Text', date: '2026-09-16', time: '20:00' }],
    ['note', { title: 'Idea', body: 'Text' }],
    ['reminder', { title: 'Call', body: '', date: '2026-09-17', time: '09:45' }],
    ['tracker_record', {
      title: '',
      body: '',
      record: {
        trackerId: 'tracker-energy',
        trackerTitle: 'Energy',
        date: '2026-09-17',
        fieldValues: { score: 4 },
      },
    }],
    ['resource', {
      title: 'Reference Book',
      body: 'Notes',
      resource: { mediaType: 'Book', sourceUrl: 'https://example.test/book' },
    }],
  ] as const)('creates %s through canonical settings and roundtrips', (type, input) => {
    const built = buildQuickAddDocument(settings, type, input, `${type}-fixture`);
    const parsed = ObjectParser.parse(built.content);
    expect(parsed.object.type).toBe(type);
    expect(parsed.object.id).toBe(`${type}-fixture`);
  });

  it('uses configured/folder-signature paths rather than hardcoded plural folders', () => {
    expect(buildQuickAddDocument(settings, 'task', { title: 'T', body: '' }, 't1').path).toBe('tasks/custom/t1.md');
    expect(buildQuickAddDocument(settings, 'note', { title: 'N', body: '' }, 'n1').path).toBe('notes/custom/n1.md');
  });

  it('registers one primary workspace view and no legacy top-level clones', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    expect((main.match(/registerView\(/g) ?? []).length).toBe(1);
    expect(main).toContain('QUARTZO_VIEW_TYPE');
    expect(main).not.toContain("registerView(HOME_VIEW_TYPE");
    expect(main).not.toContain("registerView(QUICK_ADD_VIEW_TYPE");
  });

  it('implements the canonical grouped device-local Settings contract', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    for (const heading of ['Connection', 'Sync', 'Calendar', 'Notifications', 'Appearance', 'Privacy']) {
      expect(main).toContain(`this.addHeading(containerEl, '${heading}')`);
    }
    expect(main).toContain("syncMode: 'manual'");
    expect(main).toContain(".setName('Sync mode')");
    expect(main).toContain(".addOption('manual', 'Manual')");
    expect(main).toContain(".addOption('automatic', 'Automatic')");
    expect(main).toContain("this.plugin.settings.syncMode === 'automatic'");
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
    expect(shell).toContain("Sync mode: ${plugin.settings.syncMode === 'automatic' ? 'Automatic' : 'Manual'}");
    expect(main).toContain('syncPollingIntervalSeconds');
    expect(main).toContain('hideSensitivePreviews');
    expect(main).toContain('hideJournalPreviewText');
    expect(main).toContain('hideNotificationBody');
    expect(main).toContain('app/quartzo_shared_settings.md');
    expect(main).not.toContain('this.settings.privacyMode');
    expect(main).not.toContain(".setName('Auto sync')");
    expect(main).not.toContain(".setName('Sync on Obsidian startup')");
    expect(main).not.toContain(".setName('Sync on window focus')");
  });

  it('keeps first run explicit without marking setup complete before pairing', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    const start = main.indexOf('class QuartzoFirstRunModal extends Modal');
    const end = main.indexOf('class QuartzoSettingTab', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const firstRun = main.slice(start, end);
    expect(firstRun).toContain('Connect Google Drive');
    expect(firstRun).toContain('Use without sync');
    expect(firstRun).toContain('Google Drive Desktop');
    expect(firstRun).toContain('Google Drive pairing is optional');
    expect(firstRun).toContain('Sync mode starts in Manual');
    expect(firstRun).toContain('startPairingFlow()');
    expect(firstRun).toContain("activateQuartzo('home', 'sync')");
    expect(firstRun).not.toContain('firstRunCompleted = true');
  });

  it('uses one manual-default sync mode for every automatic trigger', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    expect(main).toContain("syncMode: 'manual'");
    expect(main).toContain("registerDomEvent(window, 'focus'");
    expect(main).toContain("this.settings.syncMode !== 'automatic'");
    expect(main).toContain("this.settings.syncMode === 'automatic'");
    expect(main).toContain('this.settings.syncPollingIntervalSeconds');
    expect(main).toContain('seconds * 1000');
    expect(main).toContain('triggerStartupSync()');
    expect(main).toContain('restartAutoSync()');
    expect(main).toContain("stored.syncAuto === true");
    expect(main).not.toContain('this.settings.syncAuto');
    expect(main).not.toContain('this.settings.syncOnStartup');
    expect(main).not.toContain('this.settings.syncOnFocus');
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
    expect(shell).toContain('Companion can stay local-first');
    expect(shell).toContain('Drive pairing is optional');
  });

  it('keeps C1 accessibility labels and status semantics on core UI surfaces', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');
    const quickAdd = fs.readFileSync(path.join(process.cwd(), 'src/ui/quick-add/modal.ts'), 'utf8');
    const dayDial = fs.readFileSync(path.join(process.cwd(), 'src/ui/day-dial/view.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');

    expect(shell).toContain("button.setAttribute('aria-current', 'page')");
    expect(shell).toContain("focusButton.setAttribute('aria-pressed', 'true')");
    expect(shell).toContain("previous.setAttribute('aria-label', `Previous ${plannerMode}`)");
    expect(shell).toContain("dateInput.setAttribute('aria-label', 'Planner date')");
    expect(shell).toContain("date.setAttribute('aria-label', 'Journal date')");
    expect(shell).toContain("input.setAttribute('aria-label', 'Filter Quartzo objects')");
    expect(shell).toContain("filter.setAttribute('aria-label', 'Filter by object type')");
    expect(shell).toContain("input.setAttribute('aria-label', 'Search Quartzo objects')");
    expect(shell).toContain("summary.setAttribute('role', 'status')");
    expect(shell).toContain("lastError.setAttribute('role', 'alert')");
    expect(shell).toContain("syncProgressLine.setAttribute('aria-live', 'polite')");
    expect(shell).toContain("connect.title = 'Google Drive connection requires network access.'");
    expect(shell).toContain("sync.title = offline ? 'Sync requires network access.' : 'A sync operation is already running.'");

    expect(quickAdd).toContain("typeSelect.setAttribute('aria-label', 'Quick Add type')");
    expect(quickAdd).toContain("titleInput.setAttribute('aria-label'");
    expect(quickAdd).toContain("bodyInput.setAttribute('aria-label'");
    expect(quickAdd).toContain("metadataStatus.setAttribute('role', 'status')");

    expect(dayDial).toContain('function statusLabel(item: NormalizedItem): string');
    expect(dayDial).toContain("element.setAttribute('aria-label', accessibleItemLabel(projected.item, projected.title))");
    expect(dayDial).toContain("label.textContent = `${timeLabel(entry.item)} · ${entry.title}${status ? ` · ${status}` : ''}`");

    expect(styles).toContain('.quartzo-shell button:focus-visible');
    expect(styles).toContain('.quartzo-sync-pending-diagnostics');
    expect(styles).toContain('overflow-wrap: anywhere');
  });

  it('guards async UI renders against stale Calendar responses', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/ui/shell/view.ts'), 'utf8');

    expect(shell).toContain('private renderGeneration = 0');
    expect(shell).toContain('private isCurrentRender(container: HTMLElement, generation: number): boolean');
    expect(shell).toContain('const generation = ++this.renderGeneration');
    expect(shell).toContain('await this.renderHome(content, generation)');
    expect(shell).toContain('await this.renderPlanner(content, generation)');
    expect(shell).toContain('await this.renderJournal(content, generation)');
    expect(shell).toContain("await this.renderSync(content, this.action === 'conflicts', generation)");
    expect(shell).toContain('if (!this.isCurrentRender(container, generation)) return;');
    expect(shell).toContain('if (this.isCurrentRender(container, generation)) {');
  });

  it('guards late vault callbacks after plugin unload', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');

    expect(main).toContain('private unloaded = false');
    expect(main).toContain('this.unloaded = false');
    expect(main).toContain('this.unloaded = true');
    expect(main).toContain('if (this.unloaded || !this.vaultIndexEngine) return;');
    expect(main).toContain('if (this.unloaded || !this.driveSyncCoordinator) return;');
    expect(main).toContain('if (this.unloaded) return [];');
    expect(main).toContain('if (this.unloaded) return;');
    expect(main).toContain('this.oauthClient?.abort();');
  });

  it('coalesces shared-settings reindex and preserves one canonical index owner', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');

    expect(main).toContain('private sharedSettingsReloadInFlight = false');
    expect(main).toContain('private sharedSettingsReloadRequested = false');
    expect(main).toContain('if (this.sharedSettingsReloadInFlight) {');
    expect(main).toContain('this.sharedSettingsReloadRequested = true');
    expect(main).toContain('await this.initializeVaultIndex()');
    expect(main).toContain('} while (this.sharedSettingsReloadRequested && !this.unloaded);');
    expect((main.match(/VaultIndexEngine\.createInitialIndex/g) ?? []).length).toBe(1);
  });

});
