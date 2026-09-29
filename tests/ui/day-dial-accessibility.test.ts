import { describe, expect, it } from 'vitest';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';
import { parseSharedSettings } from '../../src/core/shared-settings';
import { renderDayDial } from '../../src/ui/day-dial/view';

class FakeClassList {
  private readonly values = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.values.add(name);
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }

  toString(): string {
    return [...this.values].join(' ');
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList();
  readonly style: Record<string, string> = {};
  textContent = '';
  className = '';
  disabled = false;
  title = '';
  tabIndex = 0;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(): void {}
}

function findAll(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const matches: FakeElement[] = [];
  const visit = (element: FakeElement) => {
    if (predicate(element)) matches.push(element);
    for (const child of element.children) visit(child);
  };
  visit(root);
  return matches;
}

function item(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    id: 'item-1',
    sourceId: 'task-1',
    sourceType: 'task',
    sourceLabel: 'Campaign task',
    date: '2026-09-19',
    start: '09:00',
    end: '10:00',
    isTimed: true,
    isAllDay: false,
    isCompletable: true,
    isCompleted: true,
    isSkipped: false,
    outcome: 'done',
    isPlayable: false,
    editable: true,
    origin: 'schedule',
    ...overrides,
  };
}

describe('Day Dial accessibility DOM', () => {
  it('uses the same resolved color for ring arcs and legend swatches', () => {
    const originalDocument = globalThis.document;
    const fakeDocument = {
      createElement: (tagName: string) => new FakeElement(tagName),
      createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    } as unknown as Document;
    (globalThis as typeof globalThis & { document: Document }).document = fakeDocument;

    try {
      const container = new FakeElement('div') as unknown as HTMLElement;
      const schedule: NormalizedSchedule = {
        kind: 'daily_schedule',
        count: 1,
        items: [item({
          id: 'time-block:morning',
          sourceId: 'morning',
          sourceType: 'time_block',
          sourceLabel: 'Manha',
          start: '07:00',
          end: '11:59',
          outcome: undefined,
          isCompleted: false,
        })],
      };
      const sharedSettings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  time_block:
    objectType: time_block
    markerType: property
    markerValue: "type: time_block"
    colorHex: "#F97316"
---
`)!;

      renderDayDial(container, {
        selectedDate: '2026-09-19',
        schedule,
        index: null,
        sharedSettings,
        now: new Date('2026-09-19T08:00:00'),
      });

      const root = container as unknown as FakeElement;
      const arcs = findAll(root, element => element.classList.contains('quartzo-day-dial-arc'));
      const swatches = findAll(root, element => element.className === 'quartzo-day-dial-swatch');

      expect(arcs).toHaveLength(1);
      expect(swatches).toHaveLength(1);
      expect(arcs[0]?.style.stroke).toBe('#F97316');
      expect(swatches[0]?.style.backgroundColor).toBe('#F97316');
    } finally {
      (globalThis as typeof globalThis & { document: Document | undefined }).document = originalDocument;
    }
  });

  it('exposes keyboard role, accessible label and non-color status text', () => {
    const originalDocument = globalThis.document;
    const fakeDocument = {
      createElement: (tagName: string) => new FakeElement(tagName),
      createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    } as unknown as Document;
    (globalThis as typeof globalThis & { document: Document }).document = fakeDocument;

    try {
      const container = new FakeElement('div') as unknown as HTMLElement;
      const schedule: NormalizedSchedule = {
        kind: 'daily_schedule',
        count: 1,
        items: [item()],
      };

      renderDayDial(container, {
        selectedDate: '2026-09-19',
        schedule,
        index: null,
        now: new Date('2026-09-19T08:00:00'),
        onOpenItem: () => {},
        iconFactory: (name: string) => {
          const svg = fakeDocument.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg',
          ) as unknown as SVGSVGElement;
          svg.setAttribute('data-icon', name);
          return svg;
        },
      });

      const root = container as unknown as FakeElement;
      const interactive = findAll(root, element => element.getAttribute('role') === 'button');
      expect(interactive.some(element =>
        element.getAttribute('aria-label') === '09:00–10:00 Campaign task, Done'
      )).toBe(true);

      const legendLabels = findAll(root, element => element.textContent.includes('Campaign task'));
      expect(legendLabels.some(element => element.textContent.includes('Done'))).toBe(true);
    } finally {
      (globalThis as typeof globalThis & { document: Document | undefined }).document = originalDocument;
    }
  });

  it('renders short canonical occurrences as keyboard-accessible icon markers', () => {
    const originalDocument = globalThis.document;
    const fakeDocument = {
      createElement: (tagName: string) => new FakeElement(tagName),
      createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    } as unknown as Document;
    (globalThis as typeof globalThis & { document: Document }).document = fakeDocument;

    try {
      const container = new FakeElement('div') as unknown as HTMLElement;
      const schedule: NormalizedSchedule = {
        kind: 'daily_schedule',
        count: 1,
        items: [item({
          id: 'reminder:short',
          sourceId: 'reminder-short',
          sourceType: 'reminder',
          sourceLabel: 'Short reminder',
          start: '09:00',
          end: '09:15',
          isCompletable: true,
          isCompleted: true,
          outcome: 'done',
        })],
      };

      renderDayDial(container, {
        selectedDate: '2026-09-19',
        schedule,
        index: null,
        now: new Date('2026-09-19T08:00:00'),
        onOpenItem: () => {},
        iconFactory: (name: string) => {
          const svg = fakeDocument.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg',
          ) as unknown as SVGSVGElement;
          svg.setAttribute('data-icon', name);
          return svg;
        },
      });

      const root = container as unknown as FakeElement;
      const markers = findAll(root, element =>
        element.classList.contains('quartzo-day-dial-icon-marker')
      );
      expect(markers).toHaveLength(1);
      expect(markers[0]?.getAttribute('role')).toBe('button');
      expect(markers[0]?.getAttribute('aria-label')).toBe(
        '09:00–09:15 Short reminder, Done',
      );
      expect(markers[0]?.classList.contains('is-completed')).toBe(true);
      const icons = findAll(root, element => element.getAttribute('data-icon') === 'bell');
      expect(icons.length).toBeGreaterThan(0);
    } finally {
      (globalThis as typeof globalThis & { document: Document | undefined }).document = originalDocument;
    }
  });
});
