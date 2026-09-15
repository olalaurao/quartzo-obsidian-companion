import { ItemView, WorkspaceLeaf } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import { ViewContext } from '../types';

export class HomeView extends ItemView {
  private context: ViewContext;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
  }

  getViewType() { return 'quartzo-home-view'; }
  getDisplayText() { return 'Quartzo Home'; }
  getIcon() { return 'calendar-clock'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-home">
        <h2>Quartzo Home</h2>
        <p>Welcome to Quartzo Companion</p>
        <div id="daily-schedule-preview"></div>
      </div>
    `;
    
    this.renderDailySchedule();
  }

  private async renderDailySchedule() {
    const today = new Date().toISOString().split('T')[0];
    const schedule = DailyScheduleEngine.normalize({
      date: today,
      today,
      objects: [],
      googleEvents: []
    });
    
    const previewEl = this.contentEl.querySelector('#daily-schedule-preview');
    if (previewEl) {
      previewEl.innerHTML = `
        <p><strong>Today's Schedule:</strong></p>
        <p>Kind: ${schedule.kind}</p>
        <p>Items: ${schedule.count}</p>
      `;
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}
