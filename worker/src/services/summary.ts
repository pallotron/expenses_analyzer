/**
 * The Summary screen's data for one view, assembled from the analysis queries.
 * Route handlers only parse and serialise; everything with a rule lives here
 * or below.
 */

import { asc, sql } from "drizzle-orm";
import type {
  CategoryItem, MerchantItem, MonthTotals, PeriodsResponse, SpendingKind, SummaryResponse,
} from "../api/summary";
import { categories, spendingTypeBudgets, tagExclusionPatterns, vLive } from "../db/schema";
import { atomic } from "../db/atomic";
import type { Db } from "../db/types";
import { historicalStats, isAnomaly } from "../domain/anomalies";
import { buildGrid } from "../domain/grid";
import {
  cashFlowTotals, categoryBreakdown, categoryMonthTotalsAllTypes, hiddenTagTotal,
  merchantsInScope, netCashFlow, spendingTypeByYear, type Scope, type TransactionType,
} from "../queries/analysis";

export interface SummaryQuery {
  year: number;
  /** 1–12, or null for the whole year. */
  month: number | null;
  /** Undefined is every source; [] is none. */
  sources?: string[];
  includeHidden: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

export async function summaryPeriods(db: Db): Promise<PeriodsResponse> {
  const months = await db.selectDistinct({ month: vLive.month }).from(vLive).orderBy(asc(vLive.month));
  const sources = await db.selectDistinct({ source: vLive.source }).from(vLive).orderBy(asc(vLive.source));

  const byYear = new Map<number, number[]>();
  for (const { month } of months) {
    const year = Number(month.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), Number(month.slice(5, 7))]);
  }
  return {
    years: [...byYear].sort(([a], [b]) => b - a).map(([year, ms]) => ({ year, months: ms })),
    sources: sources.map((s) => s.source),
  };
}

/** get_category_spending_type: anything not essential is discretionary. Income has none. */
function kindOf(types: Map<string, SpendingKind | null>, category: string, type: TransactionType): SpendingKind | null {
  if (type === "income") return null;
  return types.get(category) === "essential" ? "essential" : "discretionary";
}

/** Average month before `month` ("YYYY-MM"), over the last twelve calendar months that have rows. */
async function averageBefore(db: Db, month: string, scope: Scope): Promise<SummaryResponse["monthAverage"]> {
  const index = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  const flows = await netCashFlow(db, "month", { ...scope, year: undefined, month: undefined });
  const prior = flows.filter((f) => index(month) - index(f.period) >= 1 && index(month) - index(f.period) <= 12);
  if (prior.length === 0) return null;
  const mean = (pick: (f: (typeof prior)[number]) => number) =>
    Math.round(prior.reduce((a, f) => a + pick(f), 0) / prior.length);
  return { incomeCents: mean((f) => f.incomeCents), expensesCents: mean((f) => f.expensesCents), months: prior.length };
}

export async function buildSummary(db: Db, q: SummaryQuery): Promise<SummaryResponse> {
  const scope: Scope = {
    includeHidden: q.includeHidden,
    sources: q.sources,
    year: String(q.year),
    month: q.month === null ? undefined : `${q.year}-${pad(q.month)}`,
  };
  const yearView = q.month === null;

  const [
    cashFlow, splitRows, budgetRows, typeRows, expenseCats, incomeCats,
    expenseMerchants, incomeMerchants, hiddenCents, patternRows,
  ] = await Promise.all([
    cashFlowTotals(db, scope),
    spendingTypeByYear(db, scope),
    db.select().from(spendingTypeBudgets),
    db.select({ name: categories.name, spendingType: categories.spendingType }).from(categories),
    categoryBreakdown(db, "year", "expense", scope),
    categoryBreakdown(db, "year", "income", scope),
    merchantsInScope(db, "expense", scope),
    merchantsInScope(db, "income", scope),
    hiddenTagTotal(db, { sources: scope.sources, year: scope.year, month: scope.month }),
    db.select({ pattern: tagExclusionPatterns.pattern }).from(tagExclusionPatterns).orderBy(asc(tagExclusionPatterns.id)),
  ]);

  const types = new Map(typeRows.map((t) => [t.name, t.spendingType]));
  const budget = (kind: SpendingKind) =>
    budgetRows.find((b) => b.spendingType === kind)?.annualBudgetCents ?? null;
  const split = (kind: SpendingKind) =>
    splitRows.filter((r) => r.spendingType === kind).reduce((a, r) => a + r.amountCents, 0);

  const categoryItems = (rows: typeof expenseCats, type: TransactionType): CategoryItem[] =>
    rows
      .map((r) => ({ category: r.category, spendingType: kindOf(types, r.category, type), amountCents: r.amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
  const merchantItems = (rows: typeof expenseMerchants, type: TransactionType): MerchantItem[] =>
    rows.map((r) => ({ ...r, spendingType: kindOf(types, r.category, type) }));

  let monthlyTotals: MonthTotals[] | null = null;
  let monthly: SummaryResponse["monthly"] = null;
  if (yearView) {
    const [flows, expenseCells, incomeCells, history] = await Promise.all([
      netCashFlow(db, "month", scope),
      categoryBreakdown(db, "month", "expense", scope),
      categoryBreakdown(db, "month", "income", scope),
      categoryMonthTotalsAllTypes(db, scope),
    ]);
    const byMonth = new Map(flows.map((f) => [Number(f.period.slice(5, 7)), f]));
    monthlyTotals = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      incomeCents: byMonth.get(i + 1)?.incomeCents ?? 0,
      expensesCents: byMonth.get(i + 1)?.expensesCents ?? 0,
    }));
    const stats = historicalStats(history);
    monthly = {
      expense: buildGrid(expenseCells, (c, m, a) => isAnomaly(stats, c, m, a)),
      income: buildGrid(incomeCells, () => false),
    };
  }

  const monthAverage = scope.month === undefined ? null : await averageBefore(db, scope.month, scope);

  return {
    year: q.year,
    month: q.month,
    cashFlow,
    spendingType: {
      essentialCents: split("essential"),
      discretionaryCents: split("discretionary"),
      essentialBudgetCents: budget("essential"),
      discretionaryBudgetCents: budget("discretionary"),
    },
    expenseCategories: categoryItems(expenseCats, "expense"),
    incomeCategories: categoryItems(incomeCats, "income"),
    topMerchants: merchantItems(expenseMerchants, "expense"),
    topIncome: merchantItems(incomeMerchants, "income"),
    monthlyTotals,
    monthly,
    monthAverage,
    hiddenCents,
    excludedPatterns: patternRows.map((p) => p.pattern),
  };
}

/**
 * Replace the hidden-tag patterns (tag_settings.json's exclude_from_summary)
 * with `patterns`, in that order: the Summary lists them by id. The list goes
 * in as one JSON parameter, so its length never meets D1's bound-parameter cap.
 */
export async function setHiddenTagPatterns(db: Db, patterns: string[]): Promise<string[]> {
  await atomic(db, [
    sql`DELETE FROM tag_exclusion_patterns`,
    sql`INSERT INTO tag_exclusion_patterns (pattern)
        SELECT value FROM json_each(${JSON.stringify(patterns)}) ORDER BY key`,
  ]);
  return patterns;
}
