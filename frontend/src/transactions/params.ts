/**
 * The Transactions screen's state lives in the URL, so a Summary link, reload
 * and back/forward all show the same list. A hand-edited value that makes no
 * sense is dropped rather than failing, as on the Summary.
 */
import { monthRange, toTransactionsSearch, type TransactionsQuery } from "../lib/types";

export const SORT_KEYS = ["date", "merchant", "amount", "source", "category", "budget", "tags"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface TxParams extends TransactionsQuery {
  sort: SortKey;
  dir: "asc" | "desc";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export function parseTxParams(sp: URLSearchParams): TxParams {
  const p: TxParams = { excludeHidden: sp.get("excludeHidden") === "1", sort: "date", dir: "desc" };
  const text = (k: "merchant" | "category" | "tags") => { const v = sp.get(k); if (v) p[k] = v; };
  for (const k of ["from", "to"] as const) { const v = sp.get(k); if (v && ISO_DATE.test(v)) p[k] = v; }
  for (const k of ["min", "max"] as const) { const v = sp.get(k); if (v && NUMBER.test(v)) p[k] = v; }
  text("merchant"); text("category"); text("tags");
  const type = sp.get("type");
  if (type === "expense" || type === "income") p.type = type;
  const budget = sp.get("budget");
  if (budget === "essential" || budget === "discretionary") p.budget = budget;
  const raw = sp.getAll("sources");
  if (raw.length) p.sources = raw.filter((s) => s !== "");
  const sort = sp.get("sort");
  if ((SORT_KEYS as readonly string[]).includes(sort ?? "")) p.sort = sort as SortKey;
  if (sp.get("dir") === "asc") p.dir = "asc";
  return p;
}

export function toTxSearch(p: TxParams): URLSearchParams {
  const sp = toTransactionsSearch(p);
  if (p.sort !== "date") sp.set("sort", p.sort);
  if (p.dir !== "desc") sp.set("dir", p.dir);
  return sp;
}

/** The API ignores sorting: rows always come newest first. */
export function transactionsApiPath(p: TransactionsQuery): string {
  const { sort: _s, dir: _d, ...query } = p as TxParams;
  return `/api/transactions?${toTransactionsSearch(query)}`;
}

export function wholeMonth(p: TransactionsQuery): { year: number; month: number } | null {
  const m = p.from?.match(/^(\d{4})-(\d{2})-01$/);
  if (!m || !p.to) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return monthRange(year, month).to === p.to ? { year, month } : null;
}

export function shiftMonth(p: TxParams, delta: number): TxParams {
  const at = wholeMonth(p);
  if (!at) return p;
  const index = at.year * 12 + (at.month - 1) + delta;
  return { ...p, ...monthRange(Math.floor(index / 12), (index % 12) + 1) };
}

/** Filters other than the date range: what the phone's "Filters (n)" counts. */
export function activeFilterCount(p: TransactionsQuery): number {
  return (["merchant", "category", "tags", "min", "max", "type", "budget"] as const).filter((k) => p[k] !== undefined).length
    + (p.sources !== undefined ? 1 : 0)
    + (p.excludeHidden ? 1 : 0);
}

/** The filters in one line, for the printed report. The date range is named apart. */
export function describeFilters(p: TransactionsQuery): string {
  const parts: string[] = [];
  if (p.merchant) parts.push(`Merchant: ${p.merchant}`);
  if (p.category) parts.push(`Category: ${p.category}`);
  if (p.tags) parts.push(`Tags: ${p.tags}`);
  if (p.min && p.max) parts.push(`Amount: €${p.min} to €${p.max}`);
  else if (p.min) parts.push(`Amount: from €${p.min}`);
  else if (p.max) parts.push(`Amount: up to €${p.max}`);
  if (p.type) parts.push(p.type === "income" ? "Income" : "Expense");
  if (p.budget) parts.push(p.budget === "essential" ? "Essential" : "Discretionary");
  if (p.sources) parts.push(`Sources: ${p.sources.length ? p.sources.join(", ") : "none"}`);
  if (p.excludeHidden) parts.push("Hidden tags excluded");
  return parts.join(" · ");
}
