import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface QuartzoCompanionSettings {
  googleDriveFolderId: string | null;
  syncAuto: boolean;
  privacyMode: boolean;
}

const DEFAULT_SETTINGS: QuartzoCompanionSettings = {
  googleDriveFolderId: null,
  syncAuto: false,
  privacyMode: false,
}

export default class QuartzoCompanionPlugin extends Plugin {
  settings!: QuartzoCompanionSettings;

  async onload() {
    await this.loadSettings();

    // Registrar icones da fita (ribbon)
    const ribbonIconEl = this.addRibbonIcon('calendar-clock', 'Open Quartzo', (evt: MouseEvent) => {
      // Called when the user clicks the icon.
      console.log('Quartzo Companion: Ribbon icon clicked');
    });
    ribbonIconEl.addClass('quartzo-ribbon-icon');

    // Registrar Comandos Conforme Spec
    this.addCommand({
      id: 'quartzo-open',
      name: 'Quartzo: Open',
      callback: () => {
        console.log('Quartzo: Open command triggered');
      }
    });

    this.addCommand({
      id: 'quartzo-sync-now',
      name: 'Quartzo: Sync now',
      callback: () => {
        console.log('Quartzo: Sync now triggered');
      }
    });

    // Configurações
    this.addSettingTab(new QuartzoSettingTab(this.app, this));
  }

  onunload() {
    console.log('Quartzo Companion unloaded');
    // TODO: remover listeners, timers e cancelar requests OAuth/Drive
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class QuartzoSettingTab extends PluginSettingTab {
  plugin: QuartzoCompanionPlugin;

  constructor(app: App, plugin: QuartzoCompanionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Auto Sync')
      .setDesc('Enable automatic background synchronization with Google Drive')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncAuto)
        .onChange(async (value) => {
          this.plugin.settings.syncAuto = value;
          await this.plugin.saveSettings();
        }));
  }
}
