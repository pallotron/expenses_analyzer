/**
 * The merchant editor, the transaction list, and validation guarding imports.
 *
 * Alias previews replay merchant_editor.preview_alias_change's own answers
 * (tools/crosscheck/vectors.py). Saving is new: the Python re-derived names on
 * every load, so these tests pin down the re-pointing that replaces that.
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { ValidationError } from "../../domain/validation";
import { listTransactions } from "../../queries/transactions";
import { previewAliasChange, saveMerchantDecision } from "../../services/merchants";
import {
  importTransactions, loadAliasRules, tagTransactions,
} from "../../services/transactions";
import vectors from "../fixtures/python_vectors.json";
import { inMemoryCopy } from "../helpers/db";
import { USER, categorise, count, seed, store } from "../helpers/store";

const editor = vectors.merchantEditor as unknown as {
  rows: [string, number][];
  aliases: string[][];
  categories: Record<string, string>;
  previews: {
    pattern: string;
    alias: string;
    expected: {
      matched: number; totalCents: number; error: boolean;
      currentCategories: Record<string, number>; merchants: Record<string, number>;
    };
  }[];
};

/** The editor vectors' store: each row a live transaction on one day. */
function editorStore() {
  const s = store(editor.aliases);
  seed(s.sqlite, editor.rows.map(([merchant, amount]) => (
    { date: "2026-04-12", merchant, amount, deleted: false })), editor.aliases);
  categorise(s.sqlite, editor.categories);
  return s;
}

const merchantOf = (sqlite: Database.Database, id: number) =>
  (sqlite.prepare(`
    SELECT m.canonical_name AS name FROM transactions t JOIN merchants m ON m.id = t.merchant_id
    WHERE t.id = ?
  `).get(id) as { name: string }).name;

describe("alias previews match merchant_editor.py", () => {
  it.each(editor.previews.map((p) => [`${JSON.stringify(p.pattern)} -> ${JSON.stringify(p.alias)}`, p] as const))(
    "%s",
    async (_label, { pattern, alias, expected }) => {
      const { sqlite, db } = editorStore();
      const preview = await previewAliasChange(db, pattern, alias);
      const { error, ...rest } = preview;
      expect(rest).toEqual({
        matched: expected.matched,
        totalCents: expected.totalCents,
        currentCategories: expected.currentCategories,
        merchants: expected.merchants,
      });
      expect(error !== undefined).toBe(expected.error);
      sqlite.close();
    },
  );
});

describe("saving an alias re-points the rows it claims", () => {
  it("moves matching rows, sets the category, and appends the rule last", async () => {
    const { sqlite, db } = editorStore();
    const expressId = 5; // "TESCO EXPRESS 12/04 1"
    expect(merchantOf(sqlite, expressId)).toBe("TESCO EXPRESS");

    const result = await saveMerchantDecision(db, { pattern: "TESCO", alias: "Tesco", category: "Supermarket" }, USER);

    expect(result).toEqual({ repointed: 1 });
    expect(merchantOf(sqlite, expressId)).toBe("Tesco");
    expect(merchantOf(sqlite, 4)).toBe("Tesco");
    expect((await loadAliasRules(db)).map((r) => r.pattern)).toEqual([
      "STARBUCKS.*", "TESCO\\s+STORES\\s+\\d+", "^AMZN|AMAZON", "TESCO",
    ]);
    expect(sqlite.prepare(`
      SELECT c.name, m.category_set_by FROM merchants m JOIN categories c ON c.id = m.category_id
      WHERE m.canonical_name = 'Tesco'
    `).get()).toEqual({ name: "Supermarket", category_set_by: USER });
    // The old merchant stays, with its category, as the Python left the old key.
    expect(sqlite.prepare(`
      SELECT c.name FROM merchants m JOIN categories c ON c.id = m.category_id
      WHERE m.canonical_name = 'TESCO EXPRESS'
    `).get()).toEqual({ name: "Groceries" });
    sqlite.close();
  });

  it("editing an existing rule keeps its priority and renames every row it decides", async () => {
    const { sqlite, db } = editorStore();
    const result = await saveMerchantDecision(db, { pattern: "STARBUCKS.*", alias: "Starbucks Coffee Co" }, USER);
    expect(result).toEqual({ repointed: 3 });
    expect((await loadAliasRules(db))[0]).toEqual({ pattern: "STARBUCKS.*", canonicalName: "Starbucks Coffee Co" });
    expect([1, 2, 3].map((id) => merchantOf(sqlite, id))).toEqual(Array(3).fill("Starbucks Coffee Co"));
    sqlite.close();
  });

  it("saving what is already in force moves nothing", async () => {
    const { sqlite, db } = editorStore();
    expect(await saveMerchantDecision(db, { pattern: "^AMZN|AMAZON", alias: "Amazon" }, USER))
      .toEqual({ repointed: 0 });
    sqlite.close();
  });

  it("gives rows arriving at an occupied identity free occurrences", async () => {
    const rules = [["STARBUCKS.*", "Starbucks"]];
    const { sqlite, db } = store(rules);
    // The same coffee, same day and price, under two names that become one merchant.
    seed(sqlite, [
      { date: "2026-04-12", merchant: "STARBUCKS #1", amount: 4.5, deleted: false },
      { date: "2026-04-12", merchant: "SBUX DUBLIN", amount: 4.5, deleted: false },
      { date: "2026-04-12", merchant: "SBUX DUBLIN", amount: 4.5, deleted: false },
      { date: "2026-04-12", merchant: "SBUX DUBLIN", amount: 4.5, deleted: true },
    ], rules);

    expect(await saveMerchantDecision(db, { pattern: "SBUX", alias: "Starbucks" }, USER))
      .toEqual({ repointed: 3 });
    const live = sqlite.prepare(`
      SELECT m.canonical_name AS m, t.occurrence AS o FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id WHERE t.deleted_at IS NULL ORDER BY t.occurrence
    `).all();
    expect(live).toEqual([{ m: "Starbucks", o: 0 }, { m: "Starbucks", o: 1 }, { m: "Starbucks", o: 2 }]);

    // And the next import of that day's statement now recognises all three.
    const again = await importTransactions(db, [
      { date: "2026-04-12", merchant: "SBUX DUBLIN", amountCents: 450 },
      { date: "2026-04-12", merchant: "SBUX DUBLIN", amountCents: 450 },
      { date: "2026-04-12", merchant: "STARBUCKS #1", amountCents: 450 },
      { date: "2026-04-12", merchant: "SBUX DUBLIN", amountCents: 450 },
    ], { source: "Test", userId: USER });
    expect(again).toMatchObject({ inserted: 0, suppressedDeleted: 1, duplicates: 3 });
    sqlite.close();
  });

  it("refuses a pattern JavaScript cannot compile, or a blank alias, and changes nothing", async () => {
    const { sqlite, db } = editorStore();
    await expect(saveMerchantDecision(db, { pattern: "[bad", alias: "X" }, USER)).rejects.toThrow();
    await expect(saveMerchantDecision(db, { pattern: "TESCO", alias: "  " }, USER)).rejects.toThrow();
    expect(await loadAliasRules(db)).toHaveLength(3);
    sqlite.close();
  });
});

describe("listing transactions", () => {
  it("filters through the views, newest first, with categories, budget and tags", async () => {
    const { sqlite, db } = editorStore();
    await tagTransactions(db, [6, 7], ["Online"], "add", USER);

    const all = await listTransactions(db);
    expect(all.rows.map((r) => r.id)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(all.totalCents).toBe(Math.round(editor.rows.reduce((s, [, a]) => s + a, 0) * 100));

    const shopping = await listTransactions(db, { category: '"shopping"', tags: "online" });
    expect(shopping.rows.map((r) => [r.merchant, r.category, r.budget, r.tags])).toEqual([
      ["Amazon", "Shopping", "discretionary", "online"],
      ["Amazon", "Shopping", "discretionary", "online"],
    ]);

    expect((await listTransactions(db, { dateFrom: "2026-04-13" })).rows).toEqual([]);
    expect((await listTransactions(db, { amountMinCents: 1000, merchant: "tesco" })).rows.map((r) => r.id))
      .toEqual([5, 4]);
    sqlite.close();
  });

  it("leaves deleted rows out", async () => {
    const { sqlite, db } = editorStore();
    sqlite.exec(`UPDATE transactions SET deleted_at = 1 WHERE id = 1`);
    expect((await listTransactions(db)).rows).toHaveLength(editor.rows.length - 1);
    sqlite.close();
  });
});

describe("imports are validated first", () => {
  it("writes nothing when any row fails", async () => {
    const { sqlite, db } = store([]);
    const attempt = importTransactions(db, [
      { date: "2026-01-05", merchant: "Fine", amountCents: 100 },
      { date: "2026-02-30", merchant: "", amountCents: 100 },
    ], { source: "Test", userId: USER });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({
      errors: [
        "Found 1 row(s) with invalid dates that cannot be parsed",
        "Found 1 row(s) with empty or missing merchant names",
        "Date column cannot be converted to datetime type",
      ],
    });
    expect(count(sqlite, "1")).toBe(0);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM import_batches`).get()).toEqual({ n: 0 });
    sqlite.close();
  });
});

const REAL_DB = process.env.CROSSCHECK_DB;

describe.runIf(REAL_DB)("on real data (CROSSCHECK_DB)", () => {
  let sqlite: Database.Database;
  let db: Db;
  beforeAll(() => {
    sqlite = inMemoryCopy(REAL_DB!);
    db = drizzle(sqlite, { schema }) as unknown as Db;
  });
  afterAll(() => sqlite.close());

  it("re-saving every existing rule as it stands moves nothing", async () => {
    for (const rule of await loadAliasRules(db)) {
      const result = await saveMerchantDecision(db, { pattern: rule.pattern, alias: rule.canonicalName }, USER);
      expect(result, rule.pattern).toEqual({ repointed: 0 });
    }
  });

  it("lists every live row, totalling what v_live totals", async () => {
    const list = await listTransactions(db);
    const live = sqlite.prepare(`SELECT COUNT(*) AS n, SUM(amount_cents) AS total FROM v_live`).get() as
      { n: number; total: number };
    expect(list.rows).toHaveLength(live.n);
    expect(list.totalCents).toBe(live.total);
  });
});
