import { ItemView, WorkspaceLeaf } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import { ViewContext } from '../types';

export class DayDialView extends ItemView {
  private context: ViewContext;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
  }

  getViewType() { return 'quartzo-day-dial-view'; }
  getDisplayText() { return 'Day Dial'; }
  getIcon() { return 'clock'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-day-dial">
        <h2>Day Dial</h2>
        <div id="day-dial-content"></div>
      </div>
    `;
    
    this.renderDayDial();
  }

  private async renderDayDial() {
    const today = new Date().toISOString().split('T')[0];
    const schedule = DailyScheduleEngine.normalize({
      date: today,
      today,
      objects: [],
      googleEvents: []
    });
    
    const contentEl = this.contentEl.querySelector('#day-dial-content');
    if (contentEl) {
      contentEl.innerHTML = `
        <p><strong>Day Dial View</strong></p>
        <p>Kind: ${schedule.kind}</p>
        <p>Items: ${schedule.count}</p>
        <p>Sharing normalized Daily Schedule snapshot with Home and Planner</p>
      `;
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}
