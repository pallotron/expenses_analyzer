/**
 * The Budget types screen: each category's essential/discretionary type and
 * the annual budget for each type (the TUI's `u`).
 */

import { and, asc, eq, sql } from "drizzle-orm";

import type { BudgetTypesResponse, SpendingKind } from "../api/budgetTypes";
import { categories, spendingTypeBudgets, vLive } from "../db/schema";
import type { Db } from "../db/types";

/**
 * Every unarchived category, except untyped ones that only income rows use: a
 * type means nothing to income, and the TUI left income categories out too. A
 * typed category stays, so a refund-only year never hides it.
 */
export async function listBudgetTypes(db: Db): Promise<BudgetTypesResponse> {
  // Counted in one pass over v_live, then joined. Joining v_live directly on its
  // computed category re-ran the view once per category: ~195k D1 rows read a call.
  const counts = db
    .select({
      category: vLive.category,
      expenseCount: sql<number>`COUNT(CASE WHEN ${vLive.type} = 'expense' THEN 1 END)`.as("expense_count"),
      incomeCount: sql<number>`COUNT(CASE WHEN ${vLive.type} = 'income' THEN 1 END)`.as("income_count"),
    })
    .from(vLive)
    .groupBy(vLive.category)
    .as("counts");
  const rows = await db
    .select({
      name: categories.name,
      spendingType: categories.spendingType,
      expenseCount: sql<number>`COALESCE(${counts.expenseCount}, 0)`,
      incomeCount: sql<number>`COALESCE(${counts.incomeCount}, 0)`,
    })
    .from(categories)
    .leftJoin(counts, eq(counts.category, categories.name))
    .where(eq(categories.isArchived, false))
    .orderBy(asc(categories.name));
  const budgets = await db.select().from(spendingTypeBudgets);
  const budget = (kind: SpendingKind) => budgets.find((b) => b.spendingType === kind)?.annualBudgetCents ?? null;
  return {
    categories: rows
      .filter((r) => r.spendingType !== null || !(r.incomeCount > 0 && r.expenseCount === 0))
      .map((r) => ({
        name: r.name,
        spendingType: r.spendingType === "essential" ? "essential" : "discretionary",
        expenseCount: r.expenseCount,
      })),
    essentialBudgetCents: budget("essential"),
    discretionaryBudgetCents: budget("discretionary"),
  };
}

/** False when no unarchived category has that name. */
export async function setCategoryType(db: Db, name: string, spendingType: SpendingKind): Promise<boolean> {
  const updated = await db.update(categories).set({ spendingType })
    .where(and(eq(categories.name, name), eq(categories.isArchived, false)))
    .returning({ id: categories.id });
  return updated.length > 0;
}

/** Null clears the budget, so the Summary shows no target for that type. */
export async function setBudget(db: Db, spendingType: SpendingKind, annualBudgetCents: number | null): Promise<void> {
  await db.insert(spendingTypeBudgets).values({ spendingType, annualBudgetCents })
    .onConflictDoUpdate({ target: spendingTypeBudgets.spendingType, set: { annualBudgetCents } });
}
