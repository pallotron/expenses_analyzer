/**
 * The Summary API's JSON, shared with the frontend, which imports this file
 * directly. Keep it free of imports so the frontend can compile and bundle it
 * as it is.
 *
 * All money is integer cents. The client derives rates and averages.
 */

export interface GridCell {
  amountCents: number;
  /** Spend above mean + 2σ of the previous 12 months (expense grid only). */
  anomaly: boolean;
}

export interface GridRow {
  category: string;
  /** Twelve entries, January first. */
  months: GridCell[];
  totalCents: number;
}

export interface Grid {
  /** Descending by total, ties by category name. */
  rows: GridRow[];
  /** Column sums, category "Total". Never an anomaly. */
  total: GridRow;
}

/**
 * The Average column. A category row averages over the months it has spend in
 * (_prepare_monthly_summary); the Total row over all twelve
 * (_populate_monthly_breakdown). Fractional cents: format, don't store.
 */
export function averageCents(row: GridRow, isTotal = false): number {
  if (isTotal) return row.totalCents / 12;
  const active = row.months.filter((m) => m.amountCents > 0).length;
  return active ? row.totalCents / active : 0;
}
