/**
 * The monthly grid's red cells: SummaryScreen._calculate_historical_stats and
 * _create_monthly_cell.
 *
 * pandas pivots category × month over the months that have any data (the
 * Grouper drops a month with no rows at all, so the window counts months
 * present, not calendar months; a category missing from a present month counts
 * as 0), takes rolling(window=12, min_periods=1) mean and sample std, then
 * shift(1), so each month is judged against the up to 12 present months
 * before it. Checked against the vectors: a calendar-filled index disagrees. std of a single value is NaN and becomes 0. A cell
 * is an anomaly when mean > 0, std > 0 and amount > mean + 2·std.
 */

import type { CategoryRow } from "../queries/analysis";

export interface MonthStats {
  mean: number;
  std: number;
}

/** category -> "YYYY-MM" -> the stats that month is judged against. */
export type HistoricalStats = Map<string, Map<string, MonthStats>>;

export function historicalStats(cells: CategoryRow[]): HistoricalStats {
  const stats: HistoricalStats = new Map();
  if (cells.length === 0) return stats;
  const index = [...new Set(cells.map((c) => c.period))].sort();

  const byCategory = new Map<string, Map<string, number>>();
  for (const c of cells) {
    const series = byCategory.get(c.category) ?? new Map<string, number>();
    series.set(c.period, (series.get(c.period) ?? 0) + c.amountCents);
    byCategory.set(c.category, series);
  }

  for (const [category, amounts] of byCategory) {
    const series = index.map((m) => amounts.get(m) ?? 0);
    const perMonth = new Map<string, MonthStats>();
    index.forEach((month, i) => {
      const window = series.slice(Math.max(0, i - 12), i);
      if (window.length === 0) return; // mean is NaN: never an anomaly
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const std = window.length < 2
        ? 0
        : Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1));
      perMonth.set(month, { mean, std });
    });
    stats.set(category, perMonth);
  }
  return stats;
}

export function isAnomaly(stats: HistoricalStats, category: string, month: string, amountCents: number): boolean {
  const s = stats.get(category)?.get(month);
  return s !== undefined && s.mean > 0 && s.std > 0 && amountCents > s.mean + 2 * s.std;
}
