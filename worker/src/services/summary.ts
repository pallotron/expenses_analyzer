/**
 * The Summary screen's data for one view, assembled from the analysis queries.
 * Route handlers only parse and serialise; everything with a rule lives here
 * or below.
 */

import { asc } from "drizzle-orm";
import type {
  CategoryItem, MerchantItem, MonthTotals, PeriodsResponse, SpendingKind, SummaryResponse,
} from "../api/summary";
import { categories, spendingTypeBudgets, tagExclusionPatterns, vLive } from "../db/schema";
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
    hiddenCents,
    excludedPatterns: patternRows.map((p) => p.pattern),
  };
}
