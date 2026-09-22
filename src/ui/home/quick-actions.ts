import type { QuickAddType } from '../../core/object-creation';

export type HomeQuickAddType = QuickAddType;

export const HOME_QUICK_ACTIONS: ReadonlyArray<{ type: HomeQuickAddType; label: string }> = [
  { type: 'task', label: '+ Task' },
  { type: 'entry', label: '+ Entry' },
  { type: 'note', label: '+ Note' },
  { type: 'reminder', label: '+ Reminder' },
  { type: 'tracker_record', label: '+ Record' },
  { type: 'resource', label: '+ Resource' },
];
