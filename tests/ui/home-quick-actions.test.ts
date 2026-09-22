import { describe, expect, it } from 'vitest';
import type { QuickAddType } from '../../src/core/object-creation';
import { HOME_QUICK_ACTIONS } from '../../src/ui/home/quick-actions';

describe('HOME_QUICK_ACTIONS', () => {
  it('exposes every Quick Add type supported by the creation core', () => {
    const expected = ['task', 'entry', 'note', 'reminder', 'tracker_record', 'resource'] satisfies QuickAddType[];

    expect(HOME_QUICK_ACTIONS.map(action => action.type)).toEqual(expected);
    expect(new Set(HOME_QUICK_ACTIONS.map(action => action.label)).size).toBe(expected.length);
  });
});
