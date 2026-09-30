/**
 * Display only. Amounts arrive as integer cents; dividing by 100 here is the
 * safe direction (cents to euros for display), never the reverse.
 */

const full = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const compact = new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1,
});

export function formatCents(cents: number, opts: { compact?: boolean } = {}): string {
  return (opts.compact ? compact : full).format(cents / 100);
}

/** get_cash_flow_totals' savings rate, in percent. Null when there is no income. */
export function savingsRate(incomeCents: number, expensesCents: number): number | null {
  if (incomeCents <= 0) return null;
  return ((incomeCents - expensesCents) / incomeCents) * 100;
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}
