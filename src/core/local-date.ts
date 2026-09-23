const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function localIsoDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function localIsoDateTime(date: Date): string {
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
  return `${localIsoDate(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${milliseconds}`;
}

export function parseLocalIsoDate(value: string): Date {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid local ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`Invalid local ISO date: ${value}`);
  }
  return parsed;
}

export function addLocalDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function daysInLocalMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Stable Gregorian civil-day ordinal. This deliberately avoids UTC/millisecond
 * arithmetic so calendar membership is independent of DST and timezone offset.
 */
export function localCivilDayNumber(value: string): number {
  const date = parseLocalIsoDate(value);
  let year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra;
}

export function localCivilDayDifference(later: string, earlier: string): number {
  return localCivilDayNumber(later) - localCivilDayNumber(earlier);
}

export function shiftLocalMonth(value: string, delta: number): string {
  const source = parseLocalIsoDate(value);
  const targetMonthStart = new Date(source.getFullYear(), source.getMonth() + delta, 1);
  const maxDay = daysInLocalMonth(targetMonthStart);
  const target = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(source.getDate(), maxDay),
  );
  return localIsoDate(target);
}
