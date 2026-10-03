/**
 * The Transactions API's JSON and the URL form of its filters, shared with the
 * frontend, which imports this file directly. Keep it free of imports.
 *
 * drillDown is the one place a Summary number becomes a Transactions filter,
 * so the Summary's links and the test that holds their totals to the Summary
 * cannot drift apart.
 */

export type TransactionType = "expense" | "income";
export type BudgetKind = "essential" | "discretionary";

export interface TransactionRow {
  id: number;
  /** YYYY-MM-DD. */
  date: string;
  merchant: string;
  merchantRaw: string;
  amountCents: number;
  type: TransactionType;
  category: string;
  /** Anything not essential is discretionary, as get_category_spending_type. */
  budget: BudgetKind;
  /** Sorted, comma-separated. */
  tags: string;
  source: string;
}

export interface TransactionsResponse {
  /** Newest first. */
  rows: TransactionRow[];
  count: number;
  incomeCents: number;
  expensesCents: number;
}

export interface LookupsResponse {
  categories: string[];
  tags: string[];
  sources: string[];
}

/** The filters as they travel in a URL. Text exactly as typed; "quoted" is exact. */
export interface TransactionsQuery {
  from?: string;
  to?: string;
  merchant?: string;
  category?: string;
  tags?: string;
  /** Euros as typed, e.g. "12.5". */
  min?: string;
  max?: string;
  type?: TransactionType;
  budget?: BudgetKind;
  /** Undefined: every source. []: none. */
  sources?: string[];
  /** Hide the rows the Summary hides (tag exclusion patterns). */
  excludeHidden?: boolean;
}

/** An exact-match filter value: the filter compares the whole field. */
export function quote(value: string): string {
  return `"${value}"`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthRange(year: number, month: number | null): { from: string; to: string } {
  if (month === null) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/** A Summary number someone clicked. Category or merchant unset: every row of the type. */
export interface DrillTarget {
  year: number;
  month: number | null;
  type: TransactionType;
  category?: string;
  merchant?: string;
  /** Expense categories only; merchants leave it unset (see the spec). */
  budget?: BudgetKind | null;
  sources?: string[];
  excludeHidden: boolean;
}

export function drillDown(t: DrillTarget): TransactionsQuery {
  const q: TransactionsQuery = { ...monthRange(t.year, t.month), type: t.type };
  if (t.category !== undefined) q.category = quote(t.category);
  if (t.merchant !== undefined) q.merchant = quote(t.merchant);
  if (t.budget) q.budget = t.budget;
  if (t.sources !== undefined) q.sources = t.sources;
  if (t.excludeHidden) q.excludeHidden = true;
  return q;
}

const TEXT_KEYS = ["from", "to", "merchant", "category", "tags", "min", "max", "type", "budget"] as const;

/** `sources` repeats, so a name may contain commas; one empty value means none. */
export function toTransactionsSearch(q: TransactionsQuery): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of TEXT_KEYS) {
    const value = q[key];
    if (value !== undefined && value !== "") sp.set(key, value);
  }
  if (q.sources !== undefined) {
    if (q.sources.length === 0) sp.append("sources", "");
    for (const s of q.sources) sp.append("sources", s);
  }
  if (q.excludeHidden) sp.set("excludeHidden", "1");
  return sp;
}

export interface TransactionEdit {
  /** YYYY-MM-DD. */
  date?: string;
  /** Raw statement text; the merchant is re-resolved through the aliases. */
  merchant?: string;
  /** Positive; the sign is `type`. */
  amountCents?: number;
  type?: TransactionType;
  source?: string;
  /** A category name sets the override, null clears it, absent leaves it. */
  category?: string | null;
}
export type BulkEdit = Pick<TransactionEdit, "merchant" | "type" | "source" | "category">;
export interface BulkEditRequest { ids: number[]; edit: BulkEdit }
export interface IdsRequest { ids: number[] }
export interface TagRequest { ids: number[]; tags: string[]; mode: "add" | "remove" }
export interface UpdatedResponse { updated: number }
export interface DeletedResponse { deleted: number }
export interface RestoredResponse { restored: number }
export interface TaggedResponse { tagged: number }
