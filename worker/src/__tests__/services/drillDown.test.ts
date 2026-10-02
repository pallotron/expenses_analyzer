// worker/src/__tests__/services/drillDown.test.ts
/**
 * The promise behind every Summary link: the list it opens totals the number
 * that was clicked. Each number goes the whole way a click goes — drillDown,
 * the URL, the route's parser, listTransactions.
 *
 * Runs on the vector rows; with CROSSCHECK_DB, also on real data.
 */

import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drillDown, toTransactionsSearch, type DrillTarget } from "../../api/transactions";
import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { listTransactions } from "../../queries/transactions";
import { parseTransactionsQuery } from "../../routes/transactions";
import { buildSummary, summaryPeriods } from "../../services/summary";
import { inMemoryCopy } from "../helpers/db";
import { vectorStore } from "../helpers/summaryStore";

async function listedCents(db: Db, target: DrillTarget): Promise<number> {
  const url = new URL(`http://x/api/transactions?${toTransactionsSearch(drillDown(target))}`);
  const parsed = parseTransactionsQuery(url);
  if (!parsed.ok) throw new Error(parsed.error);
  const list = await listTransactions(db, parsed.filter);
  return target.type === "income" ? list.incomeCents : list.expensesCents;
}

/** Every clickable number in one Summary view, as [label, target, expected cents]. */
async function clickable(db: Db, year: number, month: number | null, sources: string[] | undefined, includeHidden: boolean) {
  const s = await buildSummary(db, { year, month, sources, includeHidden });
  const base = { year, month, sources, excludeHidden: !includeHidden };
  const out: [string, DrillTarget, number][] = [];
  for (const c of s.expenseCategories) out.push([`expense category ${c.category}`, { ...base, type: "expense", category: c.category, budget: c.spendingType }, c.amountCents]);
  for (const c of s.incomeCategories) out.push([`income category ${c.category}`, { ...base, type: "income", category: c.category }, c.amountCents]);
  for (const m of s.topMerchants) out.push([`expense merchant ${m.merchant}`, { ...base, type: "expense", merchant: m.merchant }, m.amountCents]);
  for (const m of s.topIncome) out.push([`income merchant ${m.merchant}`, { ...base, type: "income", merchant: m.merchant }, m.amountCents]);
  if (s.monthly) {
    for (const type of ["expense", "income"] as const) {
      const grid = s.monthly[type];
      const budgetOf = (cat: string) => type === "expense" ? s.expenseCategories.find((c) => c.category === cat)?.spendingType ?? null : null;
      grid.total.months.forEach((cell, i) =>
        out.push([`${type} total ${i + 1}`, { ...base, month: i + 1, type }, cell.amountCents]));
      for (const row of grid.rows) {
        out.push([`${type} ${row.category} year`, { ...base, month: null, type, category: row.category, budget: budgetOf(row.category) }, row.totalCents]);
        row.months.forEach((cell, i) =>
          out.push([`${type} ${row.category} ${i + 1}`, { ...base, month: i + 1, type, category: row.category, budget: budgetOf(row.category) }, cell.amountCents]));
      }
    }
  }
  return out;
}

async function expectAllEqual(db: Db, year: number, month: number | null, sources: string[] | undefined, includeHidden: boolean) {
  const targets = await clickable(db, year, month, sources, includeHidden);
  const mismatches: string[] = [];
  for (const [label, target, expected] of targets) {
    const got = await listedCents(db, target);
    if (got !== expected) mismatches.push(`${label}: summary ${expected}, list ${got}`);
  }
  expect(mismatches).toEqual([]);
  return targets.length;
}

describe("drill-down totals equal the Summary (vector rows)", () => {
  const { db, sqlite } = vectorStore();
  sqlite.exec(`
    INSERT INTO tags (id, name) VALUES (1, 'emergency'), (2, 'trip:rome');
    INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency'), ('trip:*');
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 1 FROM transactions WHERE merchant_raw = 'Bookshop';
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 2 FROM transactions WHERE id = (SELECT MIN(id) FROM transactions WHERE type = 'income');
    INSERT INTO merchants (canonical_name) VALUES ('Café "Bar" & Co, #1');
    INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source, occurrence)
      SELECT unixepoch('2026-02-14'), 'CAFE BAR', id, 1234, 'expense', 'Card', 0 FROM merchants WHERE canonical_name = 'Café "Bar" & Co, #1';

    -- Names that contain another name ("Cafe", "Dining"): an unquoted filter would match both.
    INSERT INTO categories (name, spending_type) VALUES ('Dining Out', 'discretionary');
    INSERT INTO merchants (canonical_name, category_id)
      SELECT 'Cafe Nero', id FROM categories WHERE name = 'Dining Out';
    INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source, occurrence)
      SELECT unixepoch('2026-02-20'), 'CAFE NERO', id, 777, 'expense', 'Card', 0 FROM merchants WHERE canonical_name = 'Cafe Nero';
  `);

  for (const includeHidden of [false, true]) {
    for (const sources of [undefined, ["Card"], []] as (string[] | undefined)[]) {
      it(`year views, includeHidden=${includeHidden}, sources=${JSON.stringify(sources)}`, async () => {
        let checked = 0;
        for (const { year } of (await summaryPeriods(db)).years) checked += await expectAllEqual(db, year, null, sources, includeHidden);
        if (sources?.length !== 0) expect(checked).toBeGreaterThan(0);
      });
      it(`month views, includeHidden=${includeHidden}, sources=${JSON.stringify(sources)}`, async () => {
        let checked = 0;
        for (const { year, months } of (await summaryPeriods(db)).years) {
          for (const month of months) checked += await expectAllEqual(db, year, month, sources, includeHidden);
        }
        // A month may hold no rows of a source; some month must.
        if (sources?.length !== 0) expect(checked).toBeGreaterThan(0);
      });
    }
  }
});

describe.runIf(process.env.CROSSCHECK_DB)("drill-down totals equal the Summary (CROSSCHECK_DB)", () => {
  let sqlite: Database.Database;
  let db: Db;
  beforeAll(() => {
    sqlite = inMemoryCopy(process.env.CROSSCHECK_DB!);
    db = drizzle(sqlite, { schema }) as unknown as Db;
  });
  afterAll(() => sqlite.close());

  it("every year view, both hidden modes", async () => {
    for (const { year } of (await summaryPeriods(db)).years) {
      await expectAllEqual(db, year, null, undefined, false);
      await expectAllEqual(db, year, null, undefined, true);
    }
  }, 600_000);

  it("every month view of the newest year", async () => {
    const [newest] = (await summaryPeriods(db)).years;
    for (const month of newest.months) await expectAllEqual(db, newest.year, month, undefined, false);
  }, 600_000);
});
