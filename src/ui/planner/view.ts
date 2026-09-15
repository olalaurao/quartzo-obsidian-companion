import { ItemView, WorkspaceLeaf } from 'obsidian';
import { DailyScheduleEngine } from '../../core/daily_schedule';
import { ViewContext } from '../types';

export class PlannerView extends ItemView {
  private context: ViewContext;
  private currentView: 'day' | 'week' | 'month' = 'day';

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
  }

  getViewType() { return 'quartzo-planner-view'; }
  getDisplayText() { return 'Quartzo Planner'; }
  getIcon() { return 'calendar'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-planner">
        <div class="planner-header">
          <h2>Quartzo Planner</h2>
          <div class="view-switcher">
            <button data-view="day" class="active">Day</button>
            <button data-view="week">Week</button>
            <button data-view="month">Month</button>
          </div>
        </div>
        <div id="planner-content"></div>
      </div>
    `;
    
    this.setupViewSwitcher();
    this.renderCurrentView();
  }

  private setupViewSwitcher() {
    const buttons = this.contentEl.querySelectorAll('.view-switcher button');
    buttons.forEach(button => {
      button.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        this.currentView = target.dataset.view as 'day' | 'week' | 'month';
        
        buttons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        
        this.renderCurrentView();
      });
    });
  }

  private async renderCurrentView() {
    const contentEl = this.contentEl.querySelector('#planner-content');
    if (!contentEl) return;

    const today = new Date().toISOString().split('T')[0];
    const schedule = DailyScheduleEngine.normalize({
      date: today,
      today,
      objects: [],
      googleEvents: []
    });

    contentEl.innerHTML = `
      <div class="planner-${this.currentView}">
        <p><strong>${this.currentView.charAt(0).toUpperCase() + this.currentView.slice(1)} View</strong></p>
        <p>Kind: ${schedule.kind}</p>
        <p>Items: ${schedule.count}</p>
        <p>Sharing normalized Daily Schedule snapshot with Home and Day Dial</p>
      </div>
    `;
  }

  async onClose() {
    this.contentEl.empty();
  }
}
