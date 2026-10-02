/**
 * The Transactions screen's list: every live row, filtered, newest first.
 *
 * Dates, amounts and type narrow the SQL; the text filters run in
 * applyFilters, which is where the Python's matching rules live. Hidden tags
 * are not excluded here: the Python's Transactions screen showed everything
 * live and left exclusion to the Summary.
 */

import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { TransactionRow } from "../api/transactions";
import { vTransactions } from "../db/schema";
import type { Db } from "../db/types";
import { applyFilters, type TransactionFilter } from "../domain/filters";

export type { TransactionRow };

export interface TransactionList {
  rows: TransactionRow[];
  /** Sum of the listed rows, as the screen's total line showed. */
  totalCents: number;
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
    })
    .from(v)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(v.date), desc(v.id));

  // No third bucket: anything not essential is discretionary, as in
  // get_category_spending_type().
  const rows: TransactionRow[] = fetched.map(({ spendingType, ...row }) => ({
    ...row,
    budget: spendingType === "essential" ? "essential" : "discretionary",
  }));

  const filtered = applyFilters(rows, filter);
  return {
    rows: filtered,
    totalCents: filtered.reduce((sum, row) => sum + row.amountCents, 0),
  };
}
