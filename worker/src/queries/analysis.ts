/**
 * The Summary screen's numbers: expenses/analysis.py as queries over the views.
 *
 * Each function mirrors one file in tools/crosscheck/queries/, which is the SQL
 * proved equal to the Python on real data. src/__tests__/queries/analysis.test.ts
 * proves these equal to those files, so the chain from the TUI's numbers to
 * these is unbroken. Change the SQL file and rerun the cross-check first.
 *
 * All amounts are integer cents. Rates and percentages are the caller's job,
 * so every consumer divides the same way.
 */

import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/types";
import { vExcludedIds, vLive, vSummary } from "../db/schema";

export type Period = "month" | "year";
export type TransactionType = "expense" | "income";
export type SpendingType = "essential" | "discretionary";

export interface Scope {
  /**
   * Count rows carrying an excluded tag. Off by default, matching the
   * Summary screen, which hides them until toggled.
   */
  includeHidden?: boolean;
  /** Only rows from these import sources. Undefined is every source; [] is none. */
  sources?: string[];
  /** "YYYY": only rows in this year. */
  year?: string;
  /** "YYYY-MM": only rows in this month. */
  month?: string;
}

/** The WHERE terms a scope adds. None when the scope is empty. */
function scopeTerms(v: typeof vSummary, scope: Scope = {}): SQL[] {
  const terms: SQL[] = [];
  if (scope.sources) terms.push(scope.sources.length ? inArray(v.source, scope.sources) : sql`0`);
  if (scope.year) terms.push(eq(v.year, scope.year));
  if (scope.month) terms.push(eq(v.month, scope.month));
  return terms;
}

/*
 * Both views have identical columns; v_summary is v_live minus the excluded
 * tags. Typed as one so a query is written once for either.
 */
function source(scope: Scope = {}): typeof vSummary {
  return scope.includeHidden ? (vLive as unknown as typeof vSummary) : vSummary;
}

function periodColumn(view: typeof vSummary, period: Period) {
  return period === "month" ? view.month : view.year;
}

function sumWhereType(view: typeof vSummary, type: TransactionType) {
  return sql<number>`COALESCE(SUM(CASE WHEN ${view.type} = ${type} THEN ${view.amountCents} END), 0)`
    .mapWith(Number);
}

const sumCents = (view: typeof vSummary) =>
  sql<number>`SUM(${view.amountCents})`.mapWith(Number);

export interface CashFlowTotals {
  incomeCents: number;
  expensesCents: number;
}

/** cash_flow_totals.sql: all-time income and expenses. */
export async function cashFlowTotals(db: Db, scope?: Scope): Promise<CashFlowTotals> {
  const v = source(scope);
  const [row] = await db
    .select({
      incomeCents: sumWhereType(v, "income"),
      expensesCents: sumWhereType(v, "expense"),
    })
    .from(v)
    .where(and(...scopeTerms(v, scope)));
  return row;
}

export interface CashFlowRow extends CashFlowTotals {
  period: string;
}

/**
 * net_cash_flow_by_{month,year}.sql. A period with only one side still
 * appears, with zero on the other.
 */
export async function netCashFlow(
  db: Db,
  period: Period,
  scope?: Scope,
): Promise<CashFlowRow[]> {
  const v = source(scope);
  const p = periodColumn(v, period);
  return db
    .select({
      period: p,
      incomeCents: sumWhereType(v, "income"),
      expensesCents: sumWhereType(v, "expense"),
    })
    .from(v)
    .where(and(...scopeTerms(v, scope)))
    .groupBy(p)
    .orderBy(p);
}

export interface CategoryRow {
  period: string;
  category: string;
  amountCents: number;
}

/** category_breakdown_by_{month,year}.sql. */
export async function categoryBreakdown(
  db: Db,
  period: Period,
  type: TransactionType,
  scope?: Scope,
): Promise<CategoryRow[]> {
  const v = source(scope);
  const p = periodColumn(v, period);
  return db
    .select({ period: p, category: v.category, amountCents: sumCents(v) })
    .from(v)
    .where(and(eq(v.type, type), ...scopeTerms(v, scope)))
    .groupBy(p, v.category)
    .orderBy(p, v.category);
}

export interface MerchantRow {
  period: string;
  /** Null for a transaction whose merchant was never resolved. */
  merchant: string | null;
  amountCents: number;
  txnCount: number;
}

/** top_merchants_by_year.sql: spend and count per canonical merchant per year. */
export async function merchantsByYear(
  db: Db,
  type: TransactionType,
  scope?: Scope,
): Promise<MerchantRow[]> {
  const v = source(scope);
  return db
    .select({
      period: v.year,
      merchant: v.merchant,
      amountCents: sumCents(v),
      txnCount: count(),
    })
    .from(v)
    .where(and(eq(v.type, type), ...scopeTerms(v, scope)))
    .groupBy(v.year, v.merchant)
    .orderBy(v.year, v.merchant);
}

export interface SpendingTypeRow {
  period: string;
  spendingType: SpendingType;
  amountCents: number;
}

/**
 * spending_type_by_year.sql. There is no third bucket: anything not marked
 * essential — including an uncategorised row — is discretionary, as in
 * get_category_spending_type().
 */
export async function spendingTypeByYear(db: Db, scope?: Scope): Promise<SpendingTypeRow[]> {
  const v = source(scope);
  const bucket = sql<SpendingType>`CASE WHEN ${v.spendingType} = 'essential' THEN 'essential' ELSE 'discretionary' END`;
  return db
    .select({ period: v.year, spendingType: bucket, amountCents: sumCents(v) })
    .from(v)
    .where(and(eq(v.type, "expense"), ...scopeTerms(v, scope)))
    .groupBy(v.year, bucket)
    .orderBy(v.year, bucket);
}

/**
 * hidden_tag_total.sql: expense total of the rows the Summary hides, within
 * the scope's period and sources, as _compute_hidden_tag_total narrows it.
 */
export async function hiddenTagTotal(db: Db, scope: Omit<Scope, "includeHidden"> = {}): Promise<number> {
  const v = vLive as unknown as typeof vSummary;
  const [row] = await db
    .select({ hiddenCents: sql<number>`COALESCE(SUM(${v.amountCents}), 0)`.mapWith(Number) })
    .from(v)
    .where(
      and(
        eq(v.type, "expense"),
        inArray(v.id, db.select({ id: vExcludedIds.id }).from(vExcludedIds)),
        ...scopeTerms(v, scope),
      ),
    );
  return row.hiddenCents;
}

/**
 * Category totals per month over every year and both types: the frame
 * _calculate_historical_stats pivots. Income is included because the Python
 * pivots the whole filtered frame, so a category with both kinds (e.g. "Other")
 * mixes them in its history. The period in the scope is ignored, since the
 * rolling window reaches back across years.
 */
export async function categoryMonthTotalsAllTypes(db: Db, scope: Scope = {}): Promise<CategoryRow[]> {
  const v = source(scope);
  return db
    .select({ period: v.month, category: v.category, amountCents: sumCents(v) })
    .from(v)
    .where(and(...scopeTerms(v, { sources: scope.sources })))
    .groupBy(v.month, v.category)
    .orderBy(v.month, v.category);
}

export interface ScopedMerchantRow {
  /** Canonical name, or the statement's text when it never resolved (as v_transactions). */
  merchant: string;
  /** Most frequent category among the rows in scope; ties go alphabetically first. */
  category: string;
  amountCents: number;
  txnCount: number;
}

/**
 * The Summary's merchant tables (update_top_merchants_view and
 * update_top_income_view) for one scope. Descending by amount, then name.
 */
export async function merchantsInScope(
  db: Db,
  type: TransactionType,
  scope: Scope = {},
): Promise<ScopedMerchantRow[]> {
  const v = source(scope);
  const name = sql<string>`COALESCE(${v.merchant}, ${v.merchantRaw})`;
  const parts = await db
    .select({ merchant: name, category: v.category, amountCents: sumCents(v), txnCount: count() })
    .from(v)
    .where(and(eq(v.type, type), ...scopeTerms(v, scope)))
    .groupBy(name, v.category);

  const merged = new Map<string, ScopedMerchantRow & { modeCount: number }>();
  for (const p of parts) {
    const m = merged.get(p.merchant);
    if (!m) {
      merged.set(p.merchant, { ...p, modeCount: p.txnCount });
      continue;
    }
    m.amountCents += p.amountCents;
    m.txnCount += p.txnCount;
    if (p.txnCount > m.modeCount || (p.txnCount === m.modeCount && p.category < m.category)) {
      m.category = p.category;
      m.modeCount = p.txnCount;
    }
  }
  return [...merged.values()]
    .map(({ modeCount: _modeCount, ...row }) => row)
    .sort((a, b) => b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant));
}
