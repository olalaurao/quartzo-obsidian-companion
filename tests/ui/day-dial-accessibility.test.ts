import { describe, expect, it } from 'vitest';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';
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
});
