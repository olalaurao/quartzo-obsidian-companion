import { getIcon } from 'obsidian';
import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import { localIsoDate } from '../../core/local-date';
import type { QuartzoSharedSettings } from '../../core/shared-settings';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import type { VaultIndex } from '../../vault/index/types';
import { projectDayDial, type DayDialProjectedItem } from './projection';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 320;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 124;
const ARC_BASE_RADIUS = 111;
const ARC_LANE_GAP = 10;

export interface DayDialViewOptions {
  selectedDate: string;
  schedule: NormalizedSchedule;
  index: VaultIndex | null;
  googleEvents?: GoogleCalendarProjection[];
  sharedSettings?: QuartzoSharedSettings | null;
  now?: Date;
  onOpenItem?: (item: NormalizedItem) => void;
  canOpenItem?: (item: NormalizedItem) => boolean;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function pointForMinute(minute: number, radius: number): { x: number; y: number } {
  const angle = minute / (24 * 60) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

function arcPath(startMinute: number, endMinute: number, radius: number): string {
  const start = pointForMinute(startMinute, radius);
  const end = pointForMinute(endMinute, radius);
  const span = Math.max(0, endMinute - startMinute);
  const largeArc = span > 12 * 60 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function timeLabel(item: NormalizedItem): string {
  if (!item.start) return 'All day';
  return item.end ? `${item.start}–${item.end}` : item.start;
}

function statusClass(item: NormalizedItem): string {
  if (item.outcome === 'done') return ' is-completed';
  if (item.outcome === 'skipped') return ' is-skipped';
  return '';
}

function statusLabel(item: NormalizedItem): string {
  if (item.outcome === 'done') return 'Done';
  if (item.outcome === 'skipped') return 'Skipped';
  return '';
}

function accessibleItemLabel(item: NormalizedItem, title: string): string {
  const status = statusLabel(item);
  return `${timeLabel(item)} ${title}${status ? `, ${status}` : ''}`;
}

function makeInteractive(
  element: SVGElement,
  projected: DayDialProjectedItem,
  options: DayDialViewOptions,
): void {
  if (!options.onOpenItem || options.canOpenItem?.(projected.item) === false) return;
  element.classList.add('quartzo-day-dial-interactive');
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', accessibleItemLabel(projected.item, projected.title));
  const open = () => options.onOpenItem?.(projected.item);
  element.addEventListener('click', open);
  element.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  });
}

function renderHourTicks(svg: SVGSVGElement): void {
  for (let hour = 0; hour < 24; hour++) {
    const minute = hour * 60;
    const major = hour % 6 === 0;
    const inner = pointForMinute(minute, major ? 132 : 136);
    const outer = pointForMinute(minute, 142);
    const tick = svgElement('line');
    tick.setAttribute('x1', String(inner.x));
    tick.setAttribute('y1', String(inner.y));
    tick.setAttribute('x2', String(outer.x));
    tick.setAttribute('y2', String(outer.y));
    tick.classList.add(major ? 'quartzo-day-dial-tick-major' : 'quartzo-day-dial-tick');
    svg.appendChild(tick);
  }

  for (const [hour, label] of [[0, '00'], [6, '06'], [12, '12'], [18, '18']] as const) {
    const point = pointForMinute(hour * 60, 151);
    const text = svgElement('text');
    text.setAttribute('x', String(point.x));
    text.setAttribute('y', String(point.y));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.classList.add('quartzo-day-dial-hour-label');
    text.textContent = label;
    svg.appendChild(text);
  }
}

function renderNowIndicator(svg: SVGSVGElement, selectedDate: string, now: Date): void {
  if (selectedDate !== localIsoDate(now)) return;
  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const point = pointForMinute(minute, OUTER_RADIUS + 4);
  const line = svgElement('line');
  line.setAttribute('x1', String(CENTER));
  line.setAttribute('y1', String(CENTER));
  line.setAttribute('x2', String(point.x));
  line.setAttribute('y2', String(point.y));
  line.classList.add('quartzo-day-dial-now');
  line.setAttribute('aria-hidden', 'true');
  svg.appendChild(line);
}

function renderProjectedItem(
  svg: SVGSVGElement,
  projected: DayDialProjectedItem,
  options: DayDialViewOptions,
): void {
  const classSuffix = statusClass(projected.item);
  if (projected.visual === 'arc') {
    const radius = Math.max(54, ARC_BASE_RADIUS - projected.lane * ARC_LANE_GAP);
    if (projected.durationMinutes >= (24 * 60 - 1)) {
      const circle = svgElement('circle');
      circle.setAttribute('cx', String(CENTER));
      circle.setAttribute('cy', String(CENTER));
      circle.setAttribute('r', String(radius));
      circle.classList.add('quartzo-day-dial-arc');
      if (classSuffix) circle.classList.add(classSuffix.trim());
      if (projected.color) circle.setAttribute('stroke', projected.color);
      makeInteractive(circle, projected, options);
      svg.appendChild(circle);
      return;
    }
    const path = svgElement('path');
    path.setAttribute('d', arcPath(projected.startMinute, projected.endMinute, radius));
    path.classList.add('quartzo-day-dial-arc');
    if (classSuffix) path.classList.add(classSuffix.trim());
    if (projected.color) path.setAttribute('stroke', projected.color);
    makeInteractive(path, projected, options);
    svg.appendChild(path);
    return;
  }

  const point = pointForMinute(projected.startMinute, ARC_BASE_RADIUS);
  const group = svgElement('g');
  group.classList.add('quartzo-day-dial-icon-marker');
  if (classSuffix) group.classList.add(classSuffix.trim());
  if (projected.color) group.setAttribute('color', projected.color);

  const hitTarget = svgElement('circle');
  hitTarget.setAttribute('cx', String(point.x));
  hitTarget.setAttribute('cy', String(point.y));
  hitTarget.setAttribute('r', '12');
  hitTarget.classList.add('quartzo-day-dial-marker-hit-target');
  group.appendChild(hitTarget);

  const icon = getIcon(projected.iconName);
  if (icon) {
    icon.setAttribute('x', String(point.x - 8));
    icon.setAttribute('y', String(point.y - 8));
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('quartzo-day-dial-marker-icon');
    group.appendChild(icon);
  } else {
    const fallback = svgElement('circle');
    fallback.setAttribute('cx', String(point.x));
    fallback.setAttribute('cy', String(point.y));
    fallback.setAttribute('r', '4');
    fallback.classList.add('quartzo-day-dial-marker-fallback');
    group.appendChild(fallback);
  }

  makeInteractive(group, projected, options);
  svg.appendChild(group);
}

function renderAllDay(
  container: HTMLElement,
  items: NormalizedItem[],
  options: DayDialViewOptions,
): void {
  if (items.length === 0) return;
  const group = document.createElement('div');
  group.className = 'quartzo-day-dial-all-day';
  const label = document.createElement('small');
  label.textContent = 'All day';
  group.appendChild(label);
  for (const item of items) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `quartzo-day-dial-chip${statusClass(item)}`;
    const object = options.index?.objects.get(item.sourceId);
    const title = String(object?.frontmatter.title ?? item.sourceLabel);
    const status = statusLabel(item);
    chip.textContent = `${title}${status ? ` · ${status}` : ''}`;
    chip.setAttribute('aria-label', accessibleItemLabel(item, title));
    const canOpen = options.onOpenItem && options.canOpenItem?.(item) !== false;
    chip.disabled = !canOpen;
    if (!canOpen) chip.title = 'This item is read-only in Companion V1.';
    if (canOpen) chip.addEventListener('click', () => options.onOpenItem?.(item));
    group.appendChild(chip);
  }
  container.appendChild(group);
}

function renderLegend(
  container: HTMLElement,
  projected: ReturnType<typeof projectDayDial>['timed'],
  options: DayDialViewOptions,
): void {
  if (options.sharedSettings?.showDayDialLegend === false || projected.length === 0) return;
  const list = document.createElement('ul');
  list.className = 'quartzo-day-dial-legend';
  for (const entry of projected) {
    const row = document.createElement('li');
    row.className = `quartzo-day-dial-legend-row${statusClass(entry.item)}`;
    const status = statusLabel(entry.item);
    row.setAttribute('aria-label', accessibleItemLabel(entry.item, entry.title));

    const swatch = document.createElement('span');
    swatch.className = 'quartzo-day-dial-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    if (entry.visual === 'marker') {
      swatch.classList.add('is-icon');
      if (entry.color) swatch.style.color = entry.color;
      const icon = getIcon(entry.iconName);
      if (icon) {
        icon.setAttribute('width', '14');
        icon.setAttribute('height', '14');
        swatch.appendChild(icon);
      }
    } else if (entry.color) {
      swatch.style.backgroundColor = entry.color;
    }
    row.appendChild(swatch);

    const label = document.createElement('span');
    label.textContent = `${timeLabel(entry.item)} · ${entry.title}${status ? ` · ${status}` : ''}`;
    row.appendChild(label);

    if (options.onOpenItem && options.canOpenItem?.(entry.item) !== false) {
      row.classList.add('quartzo-clickable');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const open = () => options.onOpenItem?.(entry.item);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    }

    list.appendChild(row);
  }
  container.appendChild(list);
}

export function renderDayDial(container: HTMLElement, options: DayDialViewOptions): void {
  const projection = projectDayDial(options.schedule.items, {
    index: options.index,
    googleEvents: options.googleEvents,
    sharedSettings: options.sharedSettings,
  });

  const section = document.createElement('section');
  section.className = 'quartzo-home-section quartzo-day-dial';
  const heading = document.createElement('h3');
  heading.textContent = 'Day Dial';
  section.appendChild(heading);

  renderAllDay(section, projection.allDay, options);

  const viewport = document.createElement('div');
  viewport.className = 'quartzo-day-dial-viewport';
  const svg = svgElement('svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `24-hour Day Dial for ${options.selectedDate}, ${projection.timed.length} timed items`);
  svg.classList.add('quartzo-day-dial-svg');

  const ring = svgElement('circle');
  ring.setAttribute('cx', String(CENTER));
  ring.setAttribute('cy', String(CENTER));
  ring.setAttribute('r', String(OUTER_RADIUS));
  ring.classList.add('quartzo-day-dial-ring');
  svg.appendChild(ring);
  renderHourTicks(svg);

  for (const item of projection.timed) renderProjectedItem(svg, item, options);
  renderNowIndicator(svg, options.selectedDate, options.now ?? new Date());

  viewport.appendChild(svg);
  section.appendChild(viewport);

  if (projection.timed.length === 0 && projection.allDay.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Nothing scheduled on the canonical Daily Schedule.';
    section.appendChild(empty);
  }

  if (projection.invalidTimed.length > 0) {
    const diagnostic = document.createElement('p');
    diagnostic.className = 'quartzo-day-dial-diagnostic';
    diagnostic.setAttribute('role', 'status');
    diagnostic.textContent = `${projection.invalidTimed.length} timed item${projection.invalidTimed.length === 1 ? '' : 's'} could not be placed because the canonical time is invalid.`;
    section.appendChild(diagnostic);
  }

  renderLegend(section, projection.timed, options);
  container.appendChild(section);
}
