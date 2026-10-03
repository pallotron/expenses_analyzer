/**
 * The Transactions screen's list: every live row, filtered, newest first.
 *
 * Dates, amounts, type, sources and (with `excludeHidden`) hidden tags narrow
 * the SQL; the text filters run in applyFilters, which is where the Python's
 * matching rules live. Hidden tags are kept by default, as on the Python
 * Transactions screen; the Summary drill-down asks for them to be excluded.
 */

import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import type { LookupsResponse, TransactionRow } from "../api/transactions";
import { alias } from "drizzle-orm/sqlite-core";
import { categories, merchants, tags, transactionTags, transactions, vExcludedIds, vLive, vTransactions } from "../db/schema";
import type { Db } from "../db/types";
import { applyFilters, type TransactionFilter } from "../domain/filters";

export type { TransactionRow };

export interface TransactionList {
  rows: TransactionRow[];
  /** Sum of the listed rows, as the screen's total line showed. */
  totalCents: number;
  incomeCents: number;
  expensesCents: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function listTransactions(db: Db, filter: TransactionFilter = {}): Promise<TransactionList> {
  const v = vTransactions;
  const where: SQL[] = [];
  if (filter.dateFrom && ISO_DATE.test(filter.dateFrom)) where.push(gte(v.date, filter.dateFrom));
  if (filter.dateTo && ISO_DATE.test(filter.dateTo)) where.push(lte(v.date, filter.dateTo));
  if (filter.amountMinCents !== undefined) where.push(gte(v.amountCents, filter.amountMinCents));
  if (filter.amountMaxCents !== undefined) where.push(lte(v.amountCents, filter.amountMaxCents));
  if (filter.type) where.push(eq(v.type, filter.type));
  if (filter.sources) where.push(filter.sources.length ? inArray(v.source, filter.sources) : sql`0`);
  // The same rule as v_summary, so a drill-down lists what the Summary counted.
  if (filter.excludeHidden) where.push(notInArray(v.id, db.select({ id: vExcludedIds.id }).from(vExcludedIds)));

  const own = alias(categories, "own_category");
  const fetched = await db
    .select({
      id: v.id,
      date: v.date,
      merchant: v.merchant,
      merchantRaw: v.merchantRaw,
      amountCents: v.amountCents,
      type: v.type,
      category: v.category,
      spendingType: v.spendingType,
      tags: v.tags,
      source: v.source,
      merchantCategory: sql<string>`COALESCE(${own.name}, 'Other')`,
      categoryOverridden: sql<number>`${transactions.categoryOverrideId} IS NOT NULL`.mapWith(Boolean),
    })
    .from(v)
    .innerJoin(transactions, eq(transactions.id, v.id))
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .leftJoin(own, eq(own.id, merchants.categoryId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(v.date), desc(v.id));

  // No third bucket: anything not essential is discretionary, as in
  // get_category_spending_type().
  const rows: TransactionRow[] = fetched.map(({ spendingType, ...row }) => ({
    ...row,
    budget: spendingType === "essential" ? "essential" : "discretionary",
  }));

  const filtered = applyFilters(rows, filter);
  const sumOf = (type: string) => filtered.reduce((sum, row) => sum + (row.type === type ? row.amountCents : 0), 0);
  const incomeCents = sumOf("income");
  const expensesCents = sumOf("expense");
  return { rows: filtered, totalCents: incomeCents + expensesCents, incomeCents, expensesCents };
}

/** Values the filter boxes suggest: what live (not deleted) rows carry. */
export async function listLookups(db: Db): Promise<LookupsResponse> {
  const live = await db.selectDistinct({ name: vLive.category }).from(vLive);
  const stored = await db.select({ name: categories.name }).from(categories);
  const categoryNames = [...new Set([...live, ...stored].map((r) => r.name))].sort();
  const sources = await db.selectDistinct({ name: vLive.source }).from(vLive).orderBy(asc(vLive.source));
  const tagNames = await db.selectDistinct({ name: tags.name }).from(tags)
    .innerJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .innerJoin(vLive, eq(vLive.id, transactionTags.transactionId))
    .orderBy(asc(tags.name));
  const essential = await db.select({ name: categories.name }).from(categories)
    .where(eq(categories.spendingType, "essential")).orderBy(asc(categories.name));
  return {
    categories: categoryNames,
    tags: tagNames.map((r) => r.name),
    sources: sources.map((r) => r.name),
    essentialCategories: essential.map((r) => r.name),
  };
}
