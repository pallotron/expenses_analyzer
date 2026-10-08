import type { TransactionRow } from "../lib/types";

export interface MerchantTotal {
  merchant: string;
  /** The category most of the money went to; a merchant can span several. */
  category: string;
  budget: TransactionRow["budget"];
  amountCents: number;
  count: number;
}

/**
 * The Summary's "Top expense merchants", over the rows the page already has:
 * one entry per merchant of `type`, largest first.
 */
export function merchantTotals(rows: readonly TransactionRow[], type: TransactionRow["type"]): MerchantTotal[] {
  const by = new Map<string, { amountCents: number; count: number; categories: Map<string, { cents: number; budget: TransactionRow["budget"] }> }>();
  for (const r of rows) {
    if (r.type !== type) continue;
    let m = by.get(r.merchant);
    if (!m) by.set(r.merchant, m = { amountCents: 0, count: 0, categories: new Map() });
    m.amountCents += r.amountCents;
    m.count += 1;
    const c = m.categories.get(r.category) ?? { cents: 0, budget: r.budget };
    c.cents += r.amountCents;
    m.categories.set(r.category, c);
  }
  return [...by].map(([merchant, m]) => {
    const [category, top] = [...m.categories].reduce((a, b) => (b[1].cents > a[1].cents ? b : a));
    return { merchant, category, budget: top.budget, amountCents: m.amountCents, count: m.count };
  }).sort((a, b) => b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant));
}

export interface CategoryTotal {
  category: string;
  budget: TransactionRow["budget"];
  amountCents: number;
}

/** The Summary's "Expense categories", over the rows the page already has: largest first. */
export function categoryTotals(rows: readonly TransactionRow[], type: TransactionRow["type"]): CategoryTotal[] {
  const by = new Map<string, CategoryTotal>();
  for (const r of rows) {
    if (r.type !== type) continue;
    const c = by.get(r.category) ?? { category: r.category, budget: r.budget, amountCents: 0 };
    c.amountCents += r.amountCents;
    by.set(r.category, c);
  }
  return [...by.values()].sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
}
