/**
 * Essential vs discretionary over time, for planning: the split of a period,
 * the monthly trend with a trailing average, and how the year is pacing.
 *
 * Unclassified spend (a category with no type) is reported on its own but is
 * always also inside discretionary, which is how budgets have counted it.
 */

import type { SpendingTrendMonth as TrendMonth, SpendingPacing as Pacing } from "../api/summary";
import type { MonthlySpendingTypeRow } from "../queries/analysis";

export interface Split {
  essentialCents: number;
  /** Includes unclassifiedCents. */
  discretionaryCents: number;
  unclassifiedCents: number;
}

/** Months the trend shows. */
export const TREND_MONTHS = 24;

const pad = (n: number) => String(n).padStart(2, "0");
const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthOf = (i: number) => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Each month's split. */
function byMonth(rows: MonthlySpendingTypeRow[]): Map<string, Split> {
  const months = new Map<string, Split>();
  for (const r of rows) {
    const s = months.get(r.period) ?? { essentialCents: 0, discretionaryCents: 0, unclassifiedCents: 0 };
    if (r.spendingType === "essential") s.essentialCents += r.amountCents;
    else s.discretionaryCents += r.amountCents;
    if (r.spendingType === "unclassified") s.unclassifiedCents += r.amountCents;
    months.set(r.period, s);
  }
  return months;
}

export function splitFor(rows: MonthlySpendingTypeRow[], inPeriod: (month: string) => boolean): Split {
  return [...byMonth(rows.filter((r) => inPeriod(r.period))).values()].reduce(
    (a, s) => ({
      essentialCents: a.essentialCents + s.essentialCents,
      discretionaryCents: a.discretionaryCents + s.discretionaryCents,
      unclassifiedCents: a.unclassifiedCents + s.unclassifiedCents,
    }),
    { essentialCents: 0, discretionaryCents: 0, unclassifiedCents: 0 },
  );
}

/** Up to TREND_MONTHS calendar months ending at `end` ("YYYY-MM"); a month with no rows is zero. */
export function spendingTrend(rows: MonthlySpendingTypeRow[], end: string): TrendMonth[] {
  const months = byMonth(rows);
  const last = index(end);
  const first = Math.min(...[...months.keys()].map(index));
  if (!(first <= last)) return [];
  const zero: Split = { essentialCents: 0, discretionaryCents: 0, unclassifiedCents: 0 };
  const at = (i: number) => months.get(monthOf(i)) ?? zero;
  const out: TrendMonth[] = [];
  for (let i = Math.max(first, last - TREND_MONTHS + 1); i <= last; i++) {
    const window: Split[] = [];
    for (let j = Math.max(first, i - 11); j <= i; j++) window.push(at(j));
    const mean = (pick: (s: Split) => number) => Math.round(window.reduce((a, s) => a + pick(s), 0) / window.length);
    out.push({
      month: monthOf(i),
      ...at(i),
      essentialAvgCents: mean((s) => s.essentialCents),
      discretionaryAvgCents: mean((s) => s.discretionaryCents),
    });
  }
  return out;
}

/**
 * Year-to-date spend of `year` and where it is heading. The year runs to its
 * latest expense row, so an import that lags today does not read as
 * underspending. The rest of the year is projected from last year's spend over
 * the same stretch, which carries annual bills and seasons; without a full
 * last year, from the year-to-date rate. Null when the year has no spend.
 */
export function spendingPacing(rows: MonthlySpendingTypeRow[], year: number): Pacing | null {
  const thisYear = rows.filter((r) => r.period.startsWith(`${year}-`));
  if (thisYear.length === 0) return null;
  const asOf = new Date(Math.max(...thisYear.map((r) => r.lastDate)) * 1000);
  const month = asOf.getUTCMonth() + 1;
  const dayOfYear = (asOf.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
  const elapsed = dayOfYear / ((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000);
  const ytd = splitFor(thisYear, () => true);

  const lastYear = byMonth(rows.filter((r) => r.period.startsWith(`${year - 1}-`)));
  const remaining = Array.from({ length: 13 - month }, (_, i) => `${year - 1}-${pad(month + i)}`);
  const basis = remaining.every((m) => lastYear.has(m)) ? "last-year" : "run-rate";
  // What is left of asOf's own month, taken as that share of last year's same month.
  const leftOfMonth = 1 - asOf.getUTCDate() / daysIn(year, month);
  const project = (ytdCents: number, pick: (s: Split) => number): number => {
    if (basis === "run-rate") return Math.round(ytdCents / elapsed);
    const [current, ...later] = remaining.map((m) => pick(lastYear.get(m)!));
    return ytdCents + Math.round(current * leftOfMonth) + later.reduce((a, c) => a + c, 0);
  };
  return {
    asOf: `${asOf.getUTCFullYear()}-${pad(month)}-${pad(asOf.getUTCDate())}`,
    elapsed,
    basis,
    essential: { ytdCents: ytd.essentialCents, projectedCents: project(ytd.essentialCents, (s) => s.essentialCents) },
    discretionary: { ytdCents: ytd.discretionaryCents, projectedCents: project(ytd.discretionaryCents, (s) => s.discretionaryCents) },
  };
}
