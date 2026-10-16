import { App, FuzzySuggestModal, Setting, TFolder, type ButtonComponent, type TextComponent } from 'obsidian';
import type { MarkerType } from '../../core/shared-settings';

class IdentificationFolderPicker extends FuzzySuggestModal<string> {
  constructor(app: App, private readonly onSelected: (path: string) => void) {
    super(app);
    this.setPlaceholder('Search vault folders...');
  }

  getItems(): string[] {
    return this.app.vault.getAllLoadedFiles()
      .filter((entry): entry is TFolder => entry instanceof TFolder && entry.path.length > 0 && entry.path !== '/')
      .map(folder => folder.path)
      .sort((left, right) => left.localeCompare(right));
  }

  getItemText(path: string): string { return path; }

  onChooseItem(path: string): void { this.onSelected(path); }
}

/** Transient modal drafts only; the existing migration owner still persists the signature. */
export class ObjectIdentifierFields {
  private currentType: MarkerType;
  private readonly drafts: Record<MarkerType, string> = { property: '', tag: '', folder: '' };
  private readonly valueInput: TextComponent;
  private readonly folderButton: ButtonComponent;
  private readonly valueSetting: Setting;
  private readonly errorEl: HTMLElement;
  private generation = 0;

  constructor(
    private readonly app: App,
    container: HTMLElement,
    initial: { markerType: MarkerType; markerValue: string },
  ) {
    this.currentType = initial.markerType;
    this.drafts[initial.markerType] = initial.markerValue;
    new Setting(container)
      .setName('Identifier type')
      .addDropdown(dropdown => dropdown
        .addOption('folder', 'Folder')
        .addOption('tag', 'Tag')
        .addOption('property', 'Property')
        .setValue(this.currentType)
        .onChange(value => {
          this.currentType = value as MarkerType;
          this.generation++;
          this.refresh();
        }));

    this.valueSetting = new Setting(container).setName('Identifier value');
    let valueInput!: TextComponent;
    let folderButton!: ButtonComponent;
    this.valueSetting
      .addText(text => {
        valueInput = text;
        text.inputEl.setAttribute('aria-label', 'Identifier value');
        text.onChange(value => {
          this.generation++;
          this.drafts[this.currentType] = value;
          this.showError('');
        });
      })
      .addButton(button => {
        folderButton = button;
        button.setButtonText('Choose folder').onClick(() => this.chooseFolder());
      });
    this.valueInput = valueInput;
    this.folderButton = folderButton;
    this.errorEl = container.createEl('div', { cls: 'quartzo-error', attr: { role: 'alert' } });
    this.refresh();
  }

  get markerType(): MarkerType { return this.currentType; }
  get markerValue(): string { return this.drafts[this.currentType].trim(); }

  validate(): boolean {
    const value = this.markerValue;
    let error = value ? '' : 'Identifier value is required.';
    if (value && this.currentType === 'folder') {
      const path = value.replace(/\\/g, '/');
      if (path.startsWith('/') || path.includes(':') || path.includes('\u0000') || path.split('/').some(part => part === '.' || part === '..')) {
        error = 'Enter a folder path relative to this vault, for example resources/movies.';
      }
    }
    this.showError(error);
    return !error;
  }

  showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.hidden = !message;
  }

  dispose(): void { this.generation++; }

  private refresh(): void {
    const folder = this.currentType === 'folder';
    this.valueInput
      .setPlaceholder(folder ? 'resources/movies' : this.currentType === 'tag' ? '#task' : 'type: task')
      .setValue(this.drafts[this.currentType]);
    this.valueSetting.setDesc(folder
      ? 'Path relative to this vault. Type a path or choose an existing folder.'
      : this.currentType === 'tag' ? 'Tag used to identify this object type.' : 'Frontmatter property, for example type: task.');
    this.folderButton.buttonEl.hidden = !folder;
    this.showError('');
  }

  private chooseFolder(): void {
    const generation = ++this.generation;
    try {
      new IdentificationFolderPicker(this.app, path => {
        if (this.currentType !== 'folder' || generation !== this.generation) return;
        this.drafts.folder = path;
        this.refresh();
      }).open();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }
}
