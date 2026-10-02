import type { PeriodsResponse } from "../lib/types";

/**
 * What Transactions shows when opened with no filters: this month, or last
 * month while this one is still empty, or failing both the newest month with
 * data. `today` is the browser's local date.
 */
export function defaultMonth(periods: PeriodsResponse, today: Date): { year: number; month: number } | null {
  const has = (year: number, month: number) => periods.years.find((y) => y.year === year)?.months.includes(month) ?? false;
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  if (has(year, month)) return { year, month };
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  if (has(prev.year, prev.month)) return prev;
  const newest = periods.years[0];
  if (!newest || newest.months.length === 0) return null;
  return { year: newest.year, month: newest.months[newest.months.length - 1] };
}
