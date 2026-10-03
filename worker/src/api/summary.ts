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

/** calculate_trends' marks: up, down, unchanged, and "-" for January, which has no month before it. */
export type Trend = "↑" | "↓" | "=" | "-";

/**
 * The arrow the expense grid draws after each month: that month against the
 * one before it (calculate_trends), shown only for months with spend, as
 * _create_monthly_cell does. Null: no arrow.
 */
export function monthTrends(row: GridRow): (Trend | null)[] {
  return row.months.map((cell, i) => {
    if (cell.amountCents <= 0) return null;
    if (i === 0) return "-";
    const previous = row.months[i - 1].amountCents;
    return cell.amountCents > previous ? "↑" : cell.amountCents < previous ? "↓" : "=";
  });
}

export type SpendingKind = "essential" | "discretionary";

export interface PeriodsResponse {
  /** Newest year first; months ascending, 1–12. */
  years: { year: number; months: number[] }[];
  sources: string[];
}

export interface CategoryItem {
  category: string;
  /** Expenses: essential, else discretionary (as get_category_spending_type). Income: null. */
  spendingType: SpendingKind | null;
  amountCents: number;
}

export interface MerchantItem {
  merchant: string;
  category: string;
  spendingType: SpendingKind | null;
  amountCents: number;
  txnCount: number;
}

export interface MonthTotals {
  month: number;
  incomeCents: number;
  expensesCents: number;
}

export interface SummaryResponse {
  year: number;
  month: number | null;
  cashFlow: { incomeCents: number; expensesCents: number };
  spendingType: {
    essentialCents: number;
    discretionaryCents: number;
    /** Annual; the client divides by 12 in a month view, as the TUI does. */
    essentialBudgetCents: number | null;
    discretionaryBudgetCents: number | null;
  };
  /** Descending by amount. */
  expenseCategories: CategoryItem[];
  incomeCategories: CategoryItem[];
  /** Every merchant, descending by amount. */
  topMerchants: MerchantItem[];
  topIncome: MerchantItem[];
  /** Year view only: twelve entries, January first. */
  monthlyTotals: MonthTotals[] | null;
  /** Year view only. */
  monthly: { expense: Grid; income: Grid } | null;
  /**
   * Month view only: the per-month average over the up-to-12 months before the
   * selected one that have rows in scope. Null in a year view, or with none.
   */
  monthAverage: { incomeCents: number; expensesCents: number; months: number } | null;
  /** Expense total the tag exclusion hides in this period and these sources. */
  hiddenCents: number;
  excludedPatterns: string[];
}

/** POST /api/summary/hidden-tags, both ways: the whole pattern list. */
export interface HiddenTagsBody {
  patterns: string[];
}
