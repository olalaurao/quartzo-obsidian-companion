import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  daysInLocalMonth,
  localIsoDate,
  parseLocalIsoDate,
  shiftLocalMonth,
} from '../../src/core/local-date';

describe('local calendar date semantics', () => {
  it('roundtrips a local calendar date without UTC conversion', () => {
    const parsed = parseLocalIsoDate('2026-09-17');
    expect(localIsoDate(parsed)).toBe('2026-09-17');
  });

  it('rejects impossible calendar dates', () => {
    expect(() => parseLocalIsoDate('2026-02-30')).toThrow(/Invalid local ISO date/);
  });

  it('adds days using the local calendar', () => {
    expect(localIsoDate(addLocalDays(parseLocalIsoDate('2026-12-31'), 1))).toBe('2027-01-01');
  });

  it('clamps month navigation instead of approximating with 30 days', () => {
    expect(shiftLocalMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftLocalMonth('2028-01-31', 1)).toBe('2028-02-29');
    expect(shiftLocalMonth('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('reports the actual days in the selected local month', () => {
    expect(daysInLocalMonth(parseLocalIsoDate('2028-02-01'))).toBe(29);
    expect(daysInLocalMonth(parseLocalIsoDate('2026-04-01'))).toBe(30);
  });
});
