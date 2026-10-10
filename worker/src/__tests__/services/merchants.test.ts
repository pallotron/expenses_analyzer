/**
 * The merchant editor, the transaction list, and validation guarding imports.
 *
 * Alias previews replay merchant_editor.preview_alias_change's own answers
 * (frozen in python_vectors.json, recorded before the Python app was removed). Saving is new: the Python re-derived names on
 * every load, so these tests pin down the re-pointing that replaces that.
 */

import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { ValidationError } from "../../domain/validation";
import { listTransactions } from "../../queries/transactions";
import {
  deleteMerchantRule, previewAliasChange, saveMerchantDecision, setMerchantCategory, UnknownRuleError,
} from "../../services/merchants";
import {
  importTransactions, loadAliasRules, tagTransactions,
} from "../../services/transactions";
import vectors from "../fixtures/python_vectors.json";
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

    expect(result).toEqual({ repointed: 1, tagged: 0 });
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
    expect(result).toEqual({ repointed: 3, tagged: 0 });
    expect((await loadAliasRules(db))[0]).toEqual({ pattern: "STARBUCKS.*", canonicalName: "Starbucks Coffee Co" });
    expect([1, 2, 3].map((id) => merchantOf(sqlite, id))).toEqual(Array(3).fill("Starbucks Coffee Co"));
    sqlite.close();
  });

  it("saving what is already in force moves nothing", async () => {
    const { sqlite, db } = editorStore();
    expect(await saveMerchantDecision(db, { pattern: "^AMZN|AMAZON", alias: "Amazon" }, USER))
      .toEqual({ repointed: 0, tagged: 0 });
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
      .toEqual({ repointed: 3, tagged: 0 });
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

  it("adds tags to the live rows that display as the alias, not deleted ones", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-04-12", merchant: "CORNER SHOP 1", amount: 3, deleted: false },
      { date: "2026-04-13", merchant: "CORNER SHOP 2", amount: 4, deleted: false },
      { date: "2026-04-14", merchant: "CORNER SHOP 3", amount: 5, deleted: true },
      { date: "2026-04-14", merchant: "OTHER PLACE", amount: 5, deleted: false },
    ], []);
    const result = await saveMerchantDecision(db, { pattern: "CORNER\\s+SHOP", alias: "Corner Shop", tags: ["Local", "local"] }, USER);
    expect(result).toEqual({ repointed: 3, tagged: 2 });
    const tagged = sqlite.prepare(`
      SELECT t.merchant_raw AS raw FROM transaction_tags tt
      JOIN transactions t ON t.id = tt.transaction_id JOIN tags g ON g.id = tt.tag_id
      WHERE g.name = 'local' ORDER BY t.id
    `).all();
    expect(tagged).toEqual([{ raw: "CORNER SHOP 1" }, { raw: "CORNER SHOP 2" }]);
    sqlite.close();
  });

  it("tags rows already under the alias even when nothing moves", async () => {
    const rules = [["CORNER", "Corner Shop"]];
    const { sqlite, db } = store(rules);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CORNER SHOP 1", amount: 3, deleted: false }], rules);
    expect(await saveMerchantDecision(db, { pattern: "CORNER", alias: "Corner Shop", tags: ["local"] }, USER))
      .toEqual({ repointed: 0, tagged: 1 });
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

const ruleId = (sqlite: Database.Database, pattern: string) =>
  (sqlite.prepare(`SELECT id FROM merchant_aliases WHERE pattern = ?`).get(pattern) as { id: number }).id;

describe("deleting a rule", () => {
  const rules = [["^CAFE ONE$", "Cafe One"], ["^CAFE", "Cafe"]];
  function cafes() {
    const s = store(rules);
    seed(s.sqlite, [
      { date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false },
      { date: "2026-04-12", merchant: "CAFE TWO", amount: 4, deleted: false },
      { date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: true },
    ], rules);
    return s;
  }

  it("lets a later rule take over, with a free occurrence", async () => {
    const { sqlite, db } = cafes();
    expect(await deleteMerchantRule(db, ruleId(sqlite, "^CAFE ONE$"), USER)).toEqual({ repointed: 2 });
    expect((await loadAliasRules(db)).map((r) => r.pattern)).toEqual(["^CAFE"]);
    expect(sqlite.prepare(`
      SELECT t.id, m.canonical_name AS m, t.occurrence AS o FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
    `).all()).toEqual([
      { id: 1, m: "Cafe", o: 1 },
      { id: 2, m: "Cafe", o: 0 },
      { id: 3, m: "Cafe", o: 0 }, // deleted rows keep their occurrence
    ]);
    sqlite.close();
  });

  it("deleting the only rule creates the raw-name merchants", async () => {
    const only = [["^CORNER", "Corner Shop"]];
    const { sqlite, db } = store(only);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CORNER SHOP 12/04 7", amount: 3, deleted: false }], only);
    expect(await deleteMerchantRule(db, ruleId(sqlite, "^CORNER"), USER)).toEqual({ repointed: 1 });
    expect(merchantOf(sqlite, 1)).toBe("CORNER SHOP");
    // The merchant the rule pointed at stays, as another rule may still use it.
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM merchants WHERE canonical_name = 'Corner Shop'`).get()).toEqual({ n: 1 });
    sqlite.close();
  });

  it("refuses an id that is not a rule, changing nothing", async () => {
    const { sqlite, db } = cafes();
    await expect(deleteMerchantRule(db, 999, USER)).rejects.toBeInstanceOf(UnknownRuleError);
    expect(await loadAliasRules(db)).toHaveLength(2);
    sqlite.close();
  });

  it("deletes a stored pattern JavaScript cannot compile, moving nothing", async () => {
    const { sqlite, db } = store([]);
    sqlite.exec(`INSERT INTO merchants (canonical_name) VALUES ('Odd')`);
    sqlite.exec(`INSERT INTO merchant_aliases (pattern, priority, merchant_id) VALUES ('(?P<x>a)', 0, 1)`);
    expect(await deleteMerchantRule(db, 1, USER)).toEqual({ repointed: 0 });
    expect(await loadAliasRules(db)).toHaveLength(0);
    sqlite.close();
  });
});

describe("setting merchant categories", () => {
  it("sets, creating the category, and clears the suggestion flag", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false },
      { date: "2026-04-12", merchant: "CAFE TWO", amount: 4, deleted: false },
    ], []);
    sqlite.exec(`UPDATE merchants SET category_suggested = 1`);
    expect(await setMerchantCategory(db, [1, 2, 99], "Eating out", USER)).toEqual({ updated: 2 });
    expect(sqlite.prepare(`
      SELECT m.canonical_name AS m, c.name AS c, m.category_suggested AS s, m.category_set_by AS by
      FROM merchants m JOIN categories c ON c.id = m.category_id ORDER BY m.id
    `).all()).toEqual([
      { m: "CAFE ONE", c: "Eating out", s: 0, by: USER },
      { m: "CAFE TWO", c: "Eating out", s: 0, by: USER },
    ]);
    sqlite.close();
  });

  it("trims the category name and reuses an existing one", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false }], []);
    categorise(sqlite, { "CAFE ONE": "Eating out" });
    await setMerchantCategory(db, [1], "  Eating out ", USER);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM categories`).get()).toEqual({ n: 1 });
    sqlite.close();
  });

  it("clears with null", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [{ date: "2026-04-12", merchant: "CAFE ONE", amount: 4, deleted: false }], []);
    categorise(sqlite, { "CAFE ONE": "Eating out" });
    expect(await setMerchantCategory(db, [1], null, USER)).toEqual({ updated: 1 });
    expect(sqlite.prepare(`SELECT category_id AS c FROM merchants WHERE id = 1`).get()).toEqual({ c: null });
    sqlite.close();
  });
});
