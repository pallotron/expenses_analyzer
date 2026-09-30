/**
 * One year's category × month table: SummaryScreen._prepare_monthly_summary
 * and the Total row _populate_monthly_breakdown adds above it.
 */

import type { Grid, GridRow } from "../api/summary";
import type { CategoryRow } from "../queries/analysis";

type Flag = (category: string, month: string, amountCents: number) => boolean;

/** cells: one year, one type, as categoryBreakdown(db, "month", …) returns them. */
export function buildGrid(cells: CategoryRow[], flag: Flag): Grid {
  const byCategory = new Map<string, number[]>();
  for (const c of cells) {
    const months = byCategory.get(c.category) ?? new Array<number>(12).fill(0);
    months[Number(c.period.slice(5, 7)) - 1] += c.amountCents;
    byCategory.set(c.category, months);
  }
  const year = cells[0]?.period.slice(0, 4);

  const rows: GridRow[] = [...byCategory].map(([category, amounts]) => ({
    category,
    months: amounts.map((amountCents, i) => ({
      amountCents,
      anomaly: amountCents > 0 && flag(category, `${year}-${String(i + 1).padStart(2, "0")}`, amountCents),
    })),
    totalCents: amounts.reduce((a, b) => a + b, 0),
  }));
  rows.sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));

  const columnSums = Array.from({ length: 12 }, (_, i) => rows.reduce((sum, r) => sum + r.months[i].amountCents, 0));
  return {
    rows,
    total: {
      category: "Total",
      months: columnSums.map((amountCents) => ({ amountCents, anomaly: false })),
      totalCents: columnSums.reduce((a, b) => a + b, 0),
    },
  };
}
