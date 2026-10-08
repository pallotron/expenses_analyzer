/**
 * Display only. Amounts arrive as integer cents; dividing by 100 here is the
 * safe direction (cents to euros for display), never the reverse.
 */

const full = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const compact = new Intl.NumberFormat("en-IE", {
  // The minimum is explicit: without it some ICU versions (Node 22) pad to
  // "€1.0K" and "€0.0" while others (Node 24, most browsers) print "€1K".
  style: "currency", currency: "EUR", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const whole = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/**
 * Compact only from €1,000 up: below that, compact notation would show "€29.4".
 * `whole` drops the cents, for a grid too wide for them on paper.
 */
export function formatCents(cents: number, opts: { compact?: boolean; whole?: boolean } = {}): string {
  if (opts.whole) return whole.format(cents / 100);
  return (opts.compact && Math.abs(cents) >= 100_000 ? compact : full).format(cents / 100);
}

/**
 * Chart axis ticks: always the short form, so "€0" sits under "€4K" rather
 * than "€0.00". For round tick values only, never for figures a reader adds up.
 */
export function formatAxisCents(cents: number): string {
  return compact.format(cents / 100);
}

/** get_cash_flow_totals' savings rate, in percent. Null when there is no income. */
export function savingsRate(incomeCents: number, expensesCents: number): number | null {
  if (incomeCents <= 0) return null;
  return ((incomeCents - expensesCents) / incomeCents) * 100;
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}
