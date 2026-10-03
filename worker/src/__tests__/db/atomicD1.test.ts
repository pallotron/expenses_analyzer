/**
 * atomic() and the write services through drizzle's D1 driver, over a fake D1.
 * The other tests use the sync SQLite driver, which takes a different branch.
 */

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { atomic } from "../../db/atomic";
import { createDb } from "../../db/client";
import { listTransactions } from "../../queries/transactions";
import {
  restoreTransactions, softDeleteTransactions, tagTransactions, updateTransactions,
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
    expect(await softDeleteTransactions(db, [1], USER)).toBe(1);
    expect(deletedAt()).not.toBeNull();
    expect(await restoreTransactions(db, [1], USER)).toBe(1);
    expect(deletedAt()).toBeNull();
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
});
