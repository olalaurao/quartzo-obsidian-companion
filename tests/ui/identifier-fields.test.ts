import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ObjectIdentifierFields } from '../../src/ui/organization/identifier-fields';

class Element {
  hidden = false;
  textContent = '';
  readonly attributes = new Map<string, string>();
  readonly children: Element[] = [];
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  createEl(_tag: string, options?: { attr?: Record<string, string> }): Element {
    const child = new Element();
    for (const [key, value] of Object.entries(options?.attr ?? {})) child.setAttribute(key, value);
    this.children.push(child);
    return child;
  }
}

interface Input {
  value: string;
  placeholder: string;
  change(value: string): void;
}
interface Button { buttonEl: { hidden: boolean }; click(): void }
interface Picker { getItems(): string[]; onChooseItem(value: string): void }
const ui = vi.hoisted(() => ({
  text: [] as Input[], dropdown: [] as Input[], buttons: [] as Button[], pickers: [] as Picker[],
  folders: [] as unknown[], pickerError: '',
}));

vi.mock('obsidian', () => {
  class Component {
    value = '';
    placeholder = '';
    inputEl = { setAttribute: vi.fn() };
    callback: (value: string) => void = () => {};
    setValue(value: string): this { this.value = value; return this; }
    setPlaceholder(value: string): this { this.placeholder = value; return this; }
    onChange(callback: (value: string) => void): this { this.callback = callback; return this; }
    addOption(): this { return this; }
    change(value: string): void { this.value = value; this.callback(value); }
  }
  class Button {
    buttonEl = { hidden: false };
    callback: () => void = () => {};
    setButtonText(): this { return this; }
    onClick(callback: () => void): this { this.callback = callback; return this; }
    click(): void { this.callback(); }
  }
  class TFolder { constructor(public path: string) {} }
  return {
    TFolder,
    Setting: class {
      setName(): this { return this; }
      setDesc(): this { return this; }
      addText(callback: (input: Component) => void): this {
        const input = new Component(); ui.text.push(input); callback(input); return this;
      }
      addDropdown(callback: (input: Component) => void): this {
        const input = new Component(); ui.dropdown.push(input); callback(input); return this;
      }
      addButton(callback: (button: Button) => void): this {
        const button = new Button(); ui.buttons.push(button); callback(button); return this;
      }
    },
    FuzzySuggestModal: class {
      constructor(public app: App) {}
      setPlaceholder(): void {}
      open(): void {
        if (ui.pickerError) throw new Error(ui.pickerError);
        ui.pickers.push(this as unknown as Picker);
      }
    },
  };
});

function open(markerType: 'folder' | 'property' | 'tag' = 'property', markerValue = 'type: resource') {
  const container = new Element();
  const app = { vault: { getAllLoadedFiles: () => ui.folders } } as unknown as App;
  const fields = new ObjectIdentifierFields(app, container as unknown as HTMLElement, { markerType, markerValue });
  return { fields, input: ui.text[0], type: ui.dropdown[0], folder: ui.buttons[0], error: container.children[0] };
}

beforeEach(() => {
  ui.text.length = ui.dropdown.length = ui.buttons.length = ui.pickers.length = ui.folders.length = 0;
  ui.pickerError = '';
});

describe('Object Identification editor interactions', () => {
  it('switches Property to an empty editable Folder draft and saves the typed value', () => {
    const form = open();
    expect(form.input.value).toBe('type: resource');
    expect(form.folder.buttonEl.hidden).toBe(true);
    form.type.change('folder');
    expect(form.input.value).toBe('');
    expect(form.input.placeholder).toBe('resources/movies');
    expect(form.folder.buttonEl.hidden).toBe(false);
    form.input.change(' resources/movies ');
    expect(form.fields.markerType).toBe('folder');
    expect(form.fields.markerValue).toBe('resources/movies');
    expect(form.fields.validate()).toBe(true);
  });

  it('restores each mode draft without leaking property syntax', () => {
    const form = open();
    form.type.change('folder'); form.input.change('resources/movies');
    form.type.change('tag'); expect(form.input.value).toBe('');
    form.input.change('#movie');
    form.type.change('property'); expect(form.input.value).toBe('type: resource');
    form.type.change('folder'); expect(form.input.value).toBe('resources/movies');
    form.type.change('tag'); expect(form.input.value).toBe('#movie');
  });

  it('selects a vault folder into the exact editable draft used by Save', async () => {
    const { TFolder } = await import('obsidian');
    ui.folders.push(Object.assign(Object.create(TFolder.prototype), { path: 'resources/movies' }),
      Object.assign(Object.create(TFolder.prototype), { path: '/' }), { path: 'note.md' });
    const form = open(); form.type.change('folder'); form.folder.click();
    expect(ui.pickers[0].getItems()).toEqual(['resources/movies']);
    ui.pickers[0].onChooseItem('resources/movies');
    expect(form.input.value).toBe('resources/movies');
    expect(form.fields.markerValue).toBe('resources/movies');
    form.input.change('resources/books');
    expect(form.fields.markerValue).toBe('resources/books');
  });

  it('canceling the picker keeps the existing Folder draft', () => {
    const form = open('folder', 'notes/'); form.folder.click();
    expect(form.fields.markerValue).toBe('notes/');
    expect(form.input.value).toBe('notes/');
  });

  it.each(['type', 'typing', 'closed'])('ignores stale folder selection after %s changes', change => {
    const form = open('folder', 'notes'); form.folder.click();
    if (change === 'type') form.type.change('property');
    if (change === 'typing') form.input.change('new-notes');
    if (change === 'closed') form.fields.dispose();
    ui.pickers[0].onChooseItem('stale');
    expect(form.fields.markerValue).toBe(change === 'type' ? '' : change === 'typing' ? 'new-notes' : 'notes');
  });

  it.each(['', 'type: resource', 'C:\\notes', '/notes', '../notes', 'notes/../secret', 'notes\u0000'])('blocks invalid Folder value %j with a persistent error', value => {
    const form = open('folder', value);
    expect(form.fields.validate()).toBe(false);
    expect(form.error.hidden).toBe(false);
    expect(form.error.textContent).not.toBe('');
    form.input.change('notes');
    expect(form.fields.validate()).toBe(true);
    expect(form.error.hidden).toBe(true);
  });

  it('keeps picker failures visible while allowing manual correction', () => {
    const form = open('folder', 'notes'); ui.pickerError = 'Folder inventory unavailable'; form.folder.click();
    expect(form.error.textContent).toBe('Folder inventory unavailable');
    expect(form.error.hidden).toBe(false);
    form.input.change('resources');
    expect(form.fields.validate()).toBe(true);
    expect(form.error.hidden).toBe(true);
  });
});
