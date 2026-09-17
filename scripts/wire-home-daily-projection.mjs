import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/ui/shell/view.ts');
let content = fs.readFileSync(file, 'utf8');

function replaceExact(from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  content = content.replace(from, to);
}

replaceExact(
  "import { DailyScheduleEngine } from '../../core/daily_schedule';\n",
  "import { DailyScheduleEngine } from '../../core/daily_schedule';\nimport type { NormalizedItem } from '../../core/daily_schedule/types';\n",
  'NormalizedItem import',
);
replaceExact(
  "import { renderObjectDetail } from '../detail/object-detail';\n",
  "import { renderObjectDetail } from '../detail/object-detail';\nimport { projectHomeSchedule } from '../home/home-projection';\n",
  'Home projection import',
);

const oldScheduleRenderer = `  private renderScheduleItems(container: HTMLElement, date: string): void {\n    const schedule = this.buildSchedule(date);\n    const heading = document.createElement('h3');\n    heading.textContent = date;\n    container.appendChild(heading);\n    if (schedule.items.length === 0) {\n      const empty = document.createElement('p');\n      empty.textContent = 'Nothing scheduled.';\n      container.appendChild(empty);\n      return;\n    }\n    const list = document.createElement('ul');\n    for (const item of schedule.items) {\n      const row = document.createElement('li');\n      const time = item.start ? \`${'${item.start}'} · \` : '';\n      row.textContent = \`${'${time}'}${'${this.titleForSource(item.sourceId)}'}\`;\n      const object = this.getIndex()?.objects.get(item.sourceId);\n      if (object) {\n        row.className = 'quartzo-clickable';\n        row.addEventListener('click', () => this.openObjectDetail(object));\n      }\n      list.appendChild(row);\n    }\n    container.appendChild(list);\n  }`;

const newScheduleRenderer = `  private renderScheduleList(container: HTMLElement, items: NormalizedItem[]): void {\n    const list = document.createElement('ul');\n    for (const item of items) {\n      const row = document.createElement('li');\n      const time = item.start ? \`${'${item.start}'} · \` : '';\n      row.textContent = \`${'${time}'}${'${this.titleForSource(item.sourceId)}'}\`;\n      const object = this.getIndex()?.objects.get(item.sourceId);\n      if (object) {\n        row.className = 'quartzo-clickable';\n        row.addEventListener('click', () => this.openObjectDetail(object));\n      }\n      list.appendChild(row);\n    }\n    container.appendChild(list);\n  }\n\n  private renderScheduleItems(container: HTMLElement, date: string): void {\n    const schedule = this.buildSchedule(date);\n    const heading = document.createElement('h3');\n    heading.textContent = date;\n    container.appendChild(heading);\n    if (schedule.items.length === 0) {\n      const empty = document.createElement('p');\n      empty.textContent = 'Nothing scheduled.';\n      container.appendChild(empty);\n      return;\n    }\n    this.renderScheduleList(container, schedule.items);\n  }\n\n  private renderHomeBucket(container: HTMLElement, titleText: string, items: NormalizedItem[], emptyText: string): void {\n    const section = document.createElement('section');\n    section.className = 'quartzo-home-section';\n    const heading = document.createElement('h3');\n    heading.textContent = titleText;\n    section.appendChild(heading);\n    if (items.length === 0) {\n      const empty = document.createElement('p');\n      empty.textContent = emptyText;\n      section.appendChild(empty);\n    } else {\n      this.renderScheduleList(section, items);\n    }\n    container.appendChild(section);\n  }`;
replaceExact(oldScheduleRenderer, newScheduleRenderer, 'reusable schedule list');

const oldHome = `  private async renderHome(container: HTMLElement): Promise<void> {\n    const title = document.createElement('h2');\n    title.textContent = 'Home';\n    container.appendChild(title);\n    const dial = document.createElement('section');\n    const dialTitle = document.createElement('h3');\n    dialTitle.textContent = 'Day Dial';\n    dial.appendChild(dialTitle);\n    const schedule = this.buildSchedule(this.selectedDate);\n    const summary = document.createElement('p');\n    summary.textContent = \`${'${schedule.count}'} item${'${schedule.count === 1 ? \'\' : \'s\'}'} on today’s canonical Daily Schedule.\`;\n    dial.appendChild(summary);\n    container.appendChild(dial);\n    this.renderScheduleItems(container, this.selectedDate);\n  }`;

const newHome = `  private async renderHome(container: HTMLElement): Promise<void> {\n    const title = document.createElement('h2');\n    title.textContent = 'Home';\n    container.appendChild(title);\n\n    const date = document.createElement('p');\n    date.className = 'quartzo-home-date';\n    date.textContent = this.selectedDate;\n    container.appendChild(date);\n\n    const schedule = this.buildSchedule(this.selectedDate);\n    const projection = projectHomeSchedule(schedule, this.selectedDate, new Date());\n\n    const dial = document.createElement('section');\n    dial.className = 'quartzo-home-section quartzo-day-dial-summary';\n    const dialTitle = document.createElement('h3');\n    dialTitle.textContent = 'Day Dial';\n    dial.appendChild(dialTitle);\n    const summary = document.createElement('p');\n    summary.textContent = \`${'${schedule.count}'} item${'${schedule.count === 1 ? \'\' : \'s\'}'} on the canonical Daily Schedule.\`;\n    dial.appendChild(summary);\n    container.appendChild(dial);\n\n    this.renderHomeBucket(container, 'Now', projection.now, 'Nothing active right now.');\n    this.renderHomeBucket(container, 'Up Next', projection.upNext, 'Nothing timed is coming up.');\n    this.renderHomeBucket(container, 'Today', projection.today, 'Nothing scheduled today.');\n  }`;
replaceExact(oldHome, newHome, 'Home daily projection');

fs.writeFileSync(file, content);
console.log('Home now renders Now, Up Next and Today from one canonical Daily Schedule projection.');
