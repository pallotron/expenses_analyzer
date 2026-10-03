/**
 * The Merchants page: one row per merchant that has live transactions or a
 * rule, with its own category (not per-row overrides) and its rules in the
 * order they are tried. And the rule deciding a raw name, for the editor.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { MerchantRow, RuleLookupResponse } from "../api/merchants";
import { categories, merchantAliases, merchants, transactions } from "../db/schema";
import type { Db } from "../db/types";
import { compileAliases, resolveMerchantName } from "../domain/merchants";
import { loadAliasRules } from "../services/transactions";

export async function listMerchants(db: Db): Promise<MerchantRow[]> {
  const totals = await db
    .select({
      id: merchants.id,
      name: merchants.canonicalName,
      category: categories.name,
      spendingType: categories.spendingType,
      suggested: merchants.categorySuggested,
      count: sql<number>`COUNT(${transactions.id})`.mapWith(Number),
      totalCents: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income'
        THEN ${transactions.amountCents} ELSE -${transactions.amountCents} END), 0)`.mapWith(Number),
      income: sql<number>`COALESCE(SUM(${transactions.type} = 'income'), 0)`.mapWith(Number),
      lastDate: sql<string | null>`date(MAX(${transactions.date}), 'unixepoch')`,
    })
    .from(merchants)
    .leftJoin(categories, eq(categories.id, merchants.categoryId))
    .leftJoin(transactions, and(eq(transactions.merchantId, merchants.id), isNull(transactions.deletedAt)))
    .groupBy(merchants.id);

  const rules = await db
    .select({ id: merchantAliases.id, pattern: merchantAliases.pattern, merchantId: merchantAliases.merchantId })
    .from(merchantAliases)
    .orderBy(asc(merchantAliases.priority), asc(merchantAliases.id));
  const byMerchant = new Map<number, { id: number; pattern: string }[]>();
  for (const r of rules) {
    const list = byMerchant.get(r.merchantId) ?? [];
    list.push({ id: r.id, pattern: r.pattern });
    byMerchant.set(r.merchantId, list);
  }

  return totals
    .filter((m) => m.count > 0 || byMerchant.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      budget: m.spendingType === "essential" ? "essential" : "discretionary",
      suggested: m.suggested,
      count: m.count,
      totalCents: m.totalCents,
      lastDate: m.lastDate,
      type: m.income * 2 > m.count ? "income" : "expense",
      rules: byMerchant.get(m.id) ?? [],
    }));
}

export async function ruleFor(db: Db, raw: string): Promise<RuleLookupResponse> {
  const rules = await loadAliasRules(db);
  const compiled = compileAliases(rules);
  const hit = compiled.find((r) => r.regex.test(raw));
  const merchant = resolveMerchantName(raw, compiled);
  let rule = null;
  if (hit) {
    const [row] = await db.select({ id: merchantAliases.id }).from(merchantAliases)
      .where(eq(merchantAliases.pattern, hit.pattern));
    rule = { id: row.id, pattern: hit.pattern };
  }
  const [cat] = await db.select({ name: categories.name }).from(merchants)
    .innerJoin(categories, eq(categories.id, merchants.categoryId))
    .where(eq(merchants.canonicalName, merchant));
  return { rule, merchant, category: cat?.name ?? null };
}
