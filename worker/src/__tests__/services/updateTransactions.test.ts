import { describe, expect, it } from "vitest";

import { buildSummary } from "../../services/summary";
import {
  UnknownCategoryError, updateTransaction, updateTransactions,
} from "../../services/transactions";
import { USER, categorise, seed, store } from "../helpers/store";

const rowsOf = (sqlite: ReturnType<typeof store>["sqlite"]) => sqlite.prepare(`
  SELECT t.id, m.canonical_name AS merchant, t.merchant_raw AS raw, date(t.date, 'unixepoch') AS date,
         t.amount_cents AS cents, t.occurrence AS occ, t.type, t.source,
         t.category_override_id IS NOT NULL AS overridden, t.deleted_at IS NOT NULL AS deleted
  FROM transactions t JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
`).all() as { id: number; merchant: string; raw: string; date: string; cents: number; occ: number; type: string; source: string; overridden: number; deleted: number }[];

describe("updateTransactions", () => {
  it("with liveOnly, skips and does not count a deleted id", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
      { date: "2026-03-02", merchant: "Cafe", amount: 4, deleted: true },
    ], []);
    expect(await updateTransactions(db, [1, 2], { source: "Card" }, USER, { liveOnly: true })).toBe(1);
    expect(rowsOf(sqlite).map((r) => [r.id, r.source])).toEqual([[1, "Card"], [2, expect.not.stringMatching(/^Card$/)]]);
    sqlite.close();
  });

  it("moves many rows onto one merchant with distinct occurrences, above a live twin", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Cafe", amount: 3, deleted: false },     // 1: the live twin
      { date: "2026-03-01", merchant: "Kiosk", amount: 3, deleted: false },    // 2
      { date: "2026-03-01", merchant: "Bakery", amount: 3, deleted: false },   // 3
      { date: "2026-03-01", merchant: "Stall", amount: 3, deleted: true },     // 4: deleted
    ], []);

    expect(await updateTransactions(db, [2, 3, 4], { merchant: "Cafe" }, USER)).toBe(3);

    const rows = rowsOf(sqlite);
    expect(rows.map((r) => [r.id, r.merchant, r.raw, r.occ])).toEqual([
      [1, "Cafe", "Cafe", 0],
      [2, "Cafe", "Cafe", 1],
      [3, "Cafe", "Cafe", 2],
      [4, "Cafe", "Cafe", 0], // a deleted row keeps its occurrence
    ]);
    sqlite.close();
  });

  it("moves a row onto an occurrence another moving row still holds", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Cafe", amount: 3, deleted: false },   // 1: occurrence 0
      { date: "2026-03-01", merchant: "Kiosk", amount: 3, deleted: false },  // 2
      { date: "2026-03-01", merchant: "Cafe", amount: 3, deleted: false },   // 3: occurrence 1
    ], []);
    expect(await updateTransactions(db, [2, 3], { merchant: "Cafe" }, USER, { liveOnly: true })).toBe(2);
    expect(rowsOf(sqlite).map((r) => [r.id, r.merchant, r.occ]).sort()).toEqual([
      [1, "Cafe", 0], [2, "Cafe", 1], [3, "Cafe", 2],
    ]);
    sqlite.close();
  });

  it("gives rows moving to a brand-new merchant distinct occurrences too", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Kiosk", amount: 3, deleted: false },
      { date: "2026-03-01", merchant: "Bakery", amount: 3, deleted: false },
    ], []);
    await updateTransactions(db, [1, 2], { merchant: "New Place" }, USER);
    expect(rowsOf(sqlite).map((r) => [r.merchant, r.occ])).toEqual([["New Place", 0], ["New Place", 1]]);
    sqlite.close();
  });

  it("sets, keeps and clears the category override", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false }], []);
    categorise(sqlite, { Shop: "Shopping", Other: "Groceries" });

    await updateTransactions(db, [1], { category: "Groceries" }, USER);
    const category = () => (sqlite.prepare(`SELECT category FROM v_live WHERE id = 1`).get() as { category: string }).category;
    expect(category()).toBe("Groceries");

    await updateTransactions(db, [1], { source: "Card" }, USER); // category absent: unchanged
    expect(category()).toBe("Groceries");

    await updateTransactions(db, [1], { category: null }, USER);
    expect(category()).toBe("Shopping");
    sqlite.close();
  });

  it("refuses an unknown category and writes nothing", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false }], []);
    await expect(updateTransactions(db, [1], { category: "Nope", source: "Card" }, USER))
      .rejects.toBeInstanceOf(UnknownCategoryError);
    expect(rowsOf(sqlite)[0].source).toBe("Manual");
    sqlite.close();
  });

  it("counts only ids that exist, once each", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false }], []);
    expect(await updateTransactions(db, [1, 1, 99], { type: "income" }, USER)).toBe(1);
    expect(await updateTransactions(db, [], { type: "income" }, USER)).toBe(0);
    expect(await updateTransaction(db, 99, { type: "income" }, USER)).toBe(false);
    sqlite.close();
  });

  it("moves an overridden row to its override category in the Summary", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
      { date: "2026-03-02", merchant: "Shop", amount: 5, deleted: false },
    ], []);
    categorise(sqlite, { Shop: "Shopping", Other: "Groceries" });

    await updateTransactions(db, [1], { category: "Groceries" }, USER);

    const s = await buildSummary(db, { year: 2026, month: null, includeHidden: false });
    const byName = Object.fromEntries(s.expenseCategories.map((c) => [c.category, c.amountCents]));
    expect(byName).toMatchObject({ Groceries: 1000, Shopping: 500 });
    sqlite.close();
  });

  it("changes date and amount for every row given", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
      { date: "2026-03-02", merchant: "Shop", amount: 10, deleted: false },
    ], []);
    await updateTransactions(db, [1, 2], { date: "2026-04-01", amountCents: 700 }, USER);
    expect(rowsOf(sqlite).map((r) => [r.date, r.cents, r.occ])).toEqual([["2026-04-01", 700, 0], ["2026-04-01", 700, 1]]);
    sqlite.close();
  });
});
