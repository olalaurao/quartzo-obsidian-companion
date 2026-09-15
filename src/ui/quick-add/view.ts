import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { ObjectParser } from '../../core/objects';
import { ViewContext } from '../types';

export class QuickAddView extends ItemView {
  private context: ViewContext;

  constructor(leaf: WorkspaceLeaf, context: ViewContext) {
    super(leaf);
    this.context = context;
  }

  getViewType() { return 'quartzo-quick-add-view'; }
  getDisplayText() { return 'Quick Add'; }
  getIcon() { return 'plus'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.innerHTML = `
      <div class="quartzo-quick-add">
        <h2>Quick Add</h2>
        <div class="quick-add-options">
          <button data-type="task" class="quick-add-btn">
            <span class="icon">✓</span>
            <span>Task</span>
          </button>
          <button data-type="habit" class="quick-add-btn">
            <span class="icon">↻</span>
            <span>Habit</span>
          </button>
          <button data-type="reminder" class="quick-add-btn">
            <span class="icon">⏰</span>
            <span>Reminder</span>
          </button>
          <button data-type="goal" class="quick-add-btn">
            <span class="icon">🎯</span>
            <span>Goal</span>
          </button>
          <button data-type="entry" class="quick-add-btn">
            <span class="icon">📝</span>
            <span>Journal Entry</span>
          </button>
          <button data-type="note" class="quick-add-btn">
            <span class="icon">📄</span>
            <span>Note</span>
          </button>
        </div>
        <div id="quick-add-form"></div>
      </div>
    `;
    
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.contentEl.querySelectorAll('.quick-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = (e.currentTarget as HTMLElement).getAttribute('data-type');
        if (type) this.showForm(type);
      });
    });
  }

  private showForm(type: string) {
    const formContainer = this.contentEl.querySelector('#quick-add-form');
    if (!formContainer) return;

    const forms: Record<string, string> = {
      task: `
        <div class="object-form">
          <h3>New Task</h3>
          <input type="text" id="task-title" placeholder="Task title">
          <textarea id="task-body" placeholder="Description (optional)"></textarea>
          <button id="create-task">Create Task</button>
          <button id="cancel-form">Cancel</button>
        </div>
      `,
      habit: `
        <div class="object-form">
          <h3>New Habit</h3>
          <input type="text" id="habit-title" placeholder="Habit title">
          <textarea id="habit-body" placeholder="Description (optional)"></textarea>
          <button id="create-habit">Create Habit</button>
          <button id="cancel-form">Cancel</button>
        </div>
      `,
      reminder: `
        <div class="object-form">
          <h3>New Reminder</h3>
          <input type="text" id="reminder-title" placeholder="Reminder title">
          <input type="date" id="reminder-date">
          <input type="time" id="reminder-time">
          <button id="create-reminder">Create Reminder</button>
          <button id="cancel-form">Cancel</button>
        </div>
      `,
      goal: `
        <div class="object-form">
          <h3>New Goal</h3>
          <input type="text" id="goal-title" placeholder="Goal title">
          <textarea id="goal-body" placeholder="Description"></textarea>
          <input type="date" id="goal-deadline" placeholder="Deadline (optional)">
          <button id="create-goal">Create Goal</button>
          <button id="cancel-form">Cancel</button>
        </div>
      `,
      entry: `
        <div class="object-form">
          <h3>New Journal Entry</h3>
          <input type="date" id="entry-date">
          <textarea id="entry-body" placeholder="Write your journal entry..."></textarea>
          <button id="create-entry">Create Entry</button>
          <button id="cancel-form">Cancel</button>
        </div>
      `,
      note: `
        <div class="object-form">
          <h3>New Note</h3>
          <input type="text" id="note-title" placeholder="Note title">
          <textarea id="note-body" placeholder="Note content"></textarea>
          <button id="create-note">Create Note</button>
          <button id="cancel-form">Cancel</button>
        </div>
      `
    };

    formContainer.innerHTML = forms[type] || '';
    this.setupFormHandlers(type);
  }

  private setupFormHandlers(type: string) {
    const createBtn = this.contentEl.querySelector(`#create-${type}`);
    const cancelBtn = this.contentEl.querySelector('#cancel-form');

    cancelBtn?.addEventListener('click', () => {
      this.contentEl.querySelector('#quick-add-form')!.innerHTML = '';
    });

    createBtn?.addEventListener('click', () => this.createObject(type));
  }

  private async createObject(type: string) {
    const titleInput = this.contentEl.querySelector(`[id$="-title"]`) as HTMLInputElement;
    const bodyInput = this.contentEl.querySelector(`[id$="-body"]`) as HTMLTextAreaElement;
    const dateInput = this.contentEl.querySelector(`[id$="-date"]`) as HTMLInputElement;
    const timeInput = this.contentEl.querySelector(`[id$="-time"]`) as HTMLInputElement;

    const title = titleInput?.value || 'Untitled';
    const body = bodyInput?.value || '';
    const date = dateInput?.value || new Date().toISOString().split('T')[0];
    const time = timeInput?.value || '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseObject: any = {
      id: `${type}-${Date.now()}`,
      type: type,
      title,
      body
    };

    const objectData: Record<string, unknown> = { ...baseObject };
    if (date) objectData.date = date;
    if (time) objectData.time = time;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = ObjectParser.serialize(objectData as any, {});
      const fileName = `${type}s/${date}-${title.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
      
      if (this.context.app.vault) {
        await this.context.app.vault.create(fileName, content);
        new Notice(`${type.charAt(0).toUpperCase() + type.slice(1)} created successfully`);
        this.contentEl.querySelector('#quick-add-form')!.innerHTML = '';
      }
    } catch (error) {
      new Notice(`Failed to create ${type}: ${error}`);
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}