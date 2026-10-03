/**
 * atomic() and the write services through drizzle's D1 driver, over a fake D1.
 * The other tests use the sync SQLite driver, which takes a different branch.
 */

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { atomic } from "../../db/atomic";
import { createDb } from "../../db/client";
import { listTransactions } from "../../queries/transactions";
import { deleteMerchantRule, saveMerchantDecision, setMerchantCategory } from "../../services/merchants";
import {
  importTransactions, restoreTransactions, softDeleteTransactions, tagTransactions, updateTransactions,
} from "../../services/transactions";
import { fakeD1 } from "../helpers/fakeD1";
import { USER, categorise, seed, store } from "../helpers/store";

function d1Store() {
  const { sqlite } = store([]);
  return { sqlite, db: createDb(fakeD1(sqlite)) };
}

const tagsOf = (sqlite: ReturnType<typeof store>["sqlite"], id: number) =>
  (sqlite.prepare(`
    SELECT g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
    WHERE tt.transaction_id = ? ORDER BY g.name
  `).all(id) as { name: string }[]).map((r) => r.name);

const SHOP = { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false };

describe("atomic on the D1 driver", () => {
  it("applies two parameterised inserts", async () => {
    const { sqlite, db } = d1Store();
    await atomic(db, [
      sql`INSERT INTO merchants (canonical_name) VALUES (${"First"})`,
      sql`INSERT INTO merchants (canonical_name) VALUES (${"Second"})`,
    ]);
    expect(sqlite.prepare(`SELECT canonical_name AS n FROM merchants ORDER BY id`).all())
      .toEqual([{ n: "First" }, { n: "Second" }]);
    sqlite.close();
  });

  it("rolls back the first insert when the second fails", async () => {
    const { sqlite, db } = d1Store();
    await expect(atomic(db, [
      sql`INSERT INTO merchants (canonical_name) VALUES (${"kept only if all succeed"})`,
      sql`INSERT INTO merchants (canonical_name) VALUES (NULL)`,
    ])).rejects.toThrow();
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM merchants`).get()).toEqual({ n: 0 });
    sqlite.close();
  });
});

describe("write services on the D1 driver", () => {
  it("tags and untags", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [SHOP], []);
    await tagTransactions(db, [1], ["trip", "food"], "add", USER);
    expect(tagsOf(sqlite, 1)).toEqual(["food", "trip"]);
    await tagTransactions(db, [1], ["trip"], "remove", USER);
    expect(tagsOf(sqlite, 1)).toEqual(["food"]);
    sqlite.close();
  });

  it("soft-deletes and restores", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [SHOP], []);
    const deletedAt = () => (sqlite.prepare(`SELECT deleted_at AS d FROM transactions WHERE id = 1`).get() as { d: number | null }).d;
    expect(await softDeleteTransactions(db, [1], USER)).toEqual([1]);
    expect(deletedAt()).not.toBeNull();
    expect(await restoreTransactions(db, [1], USER)).toBe(1);
    expect(deletedAt()).toBeNull();
    sqlite.close();
  });

  it("moves a row onto an occurrence another moving row still holds", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [
      { ...SHOP, merchant: "Cafe" }, { ...SHOP, merchant: "Kiosk" }, { ...SHOP, merchant: "Cafe" },
    ], []);
    expect(await updateTransactions(db, [2, 3], { merchant: "Cafe" }, USER, { liveOnly: true })).toBe(2);
    expect(sqlite.prepare(`SELECT occurrence AS o FROM transactions ORDER BY id`).all().map((r) => (r as { o: number }).o))
      .toEqual([0, 1, 2]);
    sqlite.close();
  });

  it("deletes and restores thousands of rows in linear time", async () => {
    const { sqlite, db } = d1Store();
    const n = 2000;
    seed(sqlite, Array.from({ length: n }, () => SHOP), []);
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const started = performance.now();
    expect(await softDeleteTransactions(db, ids, USER)).toEqual(ids);
    expect(await restoreTransactions(db, ids, USER)).toBe(n);
    const elapsedMs = performance.now() - started;
    expect(sqlite.prepare(`SELECT COUNT(*) AS c, COUNT(DISTINCT occurrence) AS d FROM transactions WHERE deleted_at IS NULL`).get())
      .toEqual({ c: n, d: n });
    expect(elapsedMs).toBeLessThan(3000);
    sqlite.close();
  });

  it("moves rows to a merchant with distinct occurrences and overrides the category", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [
      { ...SHOP, merchant: "Cafe" },
      { ...SHOP, merchant: "Kiosk" },
    ], []);
    categorise(sqlite, { Cafe: "Eating out", Other: "Groceries" });

    await updateTransactions(db, [2], { merchant: "Cafe", category: "Groceries" }, USER);

    expect(sqlite.prepare(`
      SELECT t.id, m.canonical_name AS merchant, t.occurrence AS occ,
             t.category_override_id IS NOT NULL AS overridden
      FROM transactions t JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
    `).all()).toEqual([
      { id: 1, merchant: "Cafe", occ: 0, overridden: 0 },
      { id: 2, merchant: "Cafe", occ: 1, overridden: 1 },
    ]);
    sqlite.close();
  });

  it("lists rows through the D1 read path", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [SHOP, { ...SHOP, merchant: "Cafe", amount: 4 }], []);
    const list = await listTransactions(db);
    expect(list.rows.map((r) => r.merchant).sort()).toEqual(["Cafe", "Shop"]);
    expect(list.rows).toHaveLength(2);
    sqlite.close();
  });

  it("saves a merchant decision: rule, category, re-point and tags", async () => {
    const { sqlite, db } = d1Store();
    seed(sqlite, [
      { date: "2026-03-01", merchant: "CAFE ONE", amount: 4, deleted: false },
      { date: "2026-03-01", merchant: "CAFE TWO", amount: 4, deleted: false },
    ], []);
    const result = await saveMerchantDecision(db, { pattern: "^CAFE", alias: "Cafe", category: "Eating out", tags: ["coffee"] }, USER);
    expect(result).toEqual({ repointed: 2, tagged: 2 });
    expect(sqlite.prepare(`
      SELECT m.canonical_name AS m, t.occurrence AS o FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
    `).all()).toEqual([{ m: "Cafe", o: 0 }, { m: "Cafe", o: 1 }]);
    expect(tagsOf(sqlite, 1)).toEqual(["coffee"]);
    sqlite.close();
  });

  it("deletes a rule and sets a category", async () => {
    const { sqlite, db } = d1Store();
    sqlite.exec(`INSERT INTO merchants (canonical_name) VALUES ('Cafe')`);
    sqlite.exec(`INSERT INTO merchant_aliases (pattern, priority, merchant_id) VALUES ('^CAFE', 0, 1)`);
    seed(sqlite, [{ date: "2026-03-01", merchant: "CAFE ONE", amount: 4, deleted: false }], [["^CAFE", "Cafe"]]);
    expect(await deleteMerchantRule(db, 1, USER)).toEqual({ repointed: 1 });
    const id = (sqlite.prepare(`SELECT merchant_id AS m FROM transactions WHERE id = 1`).get() as { m: number }).m;
    expect(await setMerchantCategory(db, [id], "Eating out", USER)).toEqual({ updated: 1 });
    expect(sqlite.prepare(`SELECT category FROM v_live WHERE id = 1`).get()).toEqual({ category: "Eating out" });
    sqlite.close();
  });

  it("imports, deduplicating against what is stored", async () => {
    const { sqlite, db } = d1Store();
    const rows = [{ date: "2026-03-01", merchant: "CAFE ONE", amountCents: 400 }];
    expect(await importTransactions(db, rows, { source: "Test", userId: USER })).toMatchObject({ inserted: 1 });
    expect(await importTransactions(db, rows, { source: "Test", userId: USER })).toMatchObject({ inserted: 0, duplicates: 1 });
    sqlite.close();
  });
});
