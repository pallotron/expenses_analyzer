/**
 * Import, delete, restore, tag and edit.
 *
 * The import scenarios are the Python's own answers (tools/crosscheck/
 * vectors.py ran append_transactions on each): the store is seeded the way
 * tools/migrate_to_sqlite.py seeds it, the same rows are imported, and the
 * surviving live rows must be exactly the ones the Python kept.
 *
 * Set CROSSCHECK_DB to a migrated real database to also check that every
 * stored transaction resolves to the merchant the migration gave it, and that
 * re-importing all of it adds nothing.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { atomic } from "../../db/atomic";
import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { resolveMerchantName } from "../../domain/merchants";
import {
  importTransactions, loadAliases, restoreTransactions, softDeleteTransactions,
  tagTransactions, updateTransaction, type ImportRow,
} from "../../services/transactions";
import vectors from "../fixtures/python_vectors.json";
import { inMemoryCopy } from "../helpers/db";
import {
  USER, cents, count, liveRows, seed, store as makeStore, type Spec,
} from "../helpers/store";

/** The vectors' aliases, which every scenario here is seeded with. */
const ALIASES = vectors.imports.aliases;
const store = (rules: string[][] = ALIASES) => makeStore(rules);

const importRows = (specs: Spec[]): ImportRow[] =>
  specs.map((s) => ({ date: s.date, merchant: s.merchant, amountCents: cents(s.amount) }));

describe("import keeps exactly what the Python kept", () => {
  it.each(vectors.imports.scenarios.map((s) => [s.name, s] as const))("%s", async (_name, scenario) => {
    const { sqlite, db } = store();
    seed(sqlite, scenario.existing, vectors.imports.aliases);

    const result = await importTransactions(db, importRows(scenario.new), { source: "Test", userId: USER });

    expect(liveRows(sqlite)).toEqual(scenario.expected.live);
    expect(count(sqlite, "deleted_at IS NOT NULL")).toBe(scenario.expected.deleted);
    expect(result.inserted + result.duplicates + result.suppressedDeleted).toBe(scenario.new.length);
    sqlite.close();
  });
});

describe("import bookkeeping", () => {
  it("records the batch, creates unknown merchants uncategorised, and tags new rows", async () => {
    const { sqlite, db } = store();
    const result = await importTransactions(db, [
      { date: "2026-02-01", merchant: "NEW SHOP 01/02 1", amountCents: 1_000, tags: ["Trip Paris", "gift"] },
      { date: "2026-02-01", merchant: "STARBUCKS #9", amountCents: 450, type: "income" },
    ], { source: "CSV Import", userId: USER, filename: "feb.csv" });

    expect(result).toMatchObject({ inserted: 2, duplicates: 0, suppressedDeleted: 0, newMerchants: ["NEW SHOP"] });
    expect(sqlite.prepare(`SELECT source, filename, rows_inserted, rows_skipped, imported_by FROM import_batches`).get())
      .toEqual({ source: "CSV Import", filename: "feb.csv", rows_inserted: 2, rows_skipped: 0, imported_by: USER });
    expect(sqlite.prepare(`SELECT category_id FROM merchants WHERE canonical_name = 'NEW SHOP'`).get())
      .toEqual({ category_id: null });
    expect(sqlite.prepare(`
      SELECT t.merchant_raw, t.type, t.source, t.import_batch_id, t.created_by
      FROM transactions t ORDER BY t.id
    `).all()).toEqual([
      { merchant_raw: "NEW SHOP 01/02 1", type: "expense", source: "CSV Import", import_batch_id: result.batchId, created_by: USER },
      { merchant_raw: "STARBUCKS #9", type: "income", source: "CSV Import", import_batch_id: result.batchId, created_by: USER },
    ]);
    expect(sqlite.prepare(`
      SELECT g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id ORDER BY g.name
    `).raw().all()).toEqual([["gift"], ["trip-paris"]]);

    const again = await importTransactions(db, [
      { date: "2026-02-01", merchant: "NEW SHOP 01/02 7", amountCents: 1_000 },
    ], { source: "CSV Import", userId: USER });
    expect(again).toMatchObject({ inserted: 0, duplicates: 1, newMerchants: [] });
    sqlite.close();
  });

  it("does nothing with no rows but still records the attempt", async () => {
    const { sqlite, db } = store();
    expect(await importTransactions(db, [], { source: "CSV Import", userId: USER }))
      .toMatchObject({ inserted: 0, duplicates: 0, suppressedDeleted: 0 });
    expect(count(sqlite, "1")).toBe(0);
    sqlite.close();
  });
});

describe("delete and restore by id", () => {
  const MUSEUM = { date: "2026-08-12", merchant: "CNC AG CIA Erfgo 10/08 0", amount: 12, deleted: false };

  it("deletes only the chosen twin, not every identical row", async () => {
    const { sqlite, db } = store();
    seed(sqlite, [MUSEUM, MUSEUM], vectors.imports.aliases);

    expect(await softDeleteTransactions(db, [1], USER)).toEqual([1]);
    expect(count(sqlite, "deleted_at IS NULL")).toBe(1);
    expect(sqlite.prepare(`SELECT deleted_by FROM transactions WHERE id = 1`).get()).toEqual({ deleted_by: USER });
    expect(await softDeleteTransactions(db, [1], USER)).toEqual([]);
    sqlite.close();
  });

  it("restores a row whose occurrence a new twin took, without breaking the unique index", async () => {
    const { sqlite, db } = store();
    seed(sqlite, [MUSEUM], vectors.imports.aliases);
    await softDeleteTransactions(db, [1], USER);
    // Two copies arrive: one is absorbed by the deletion, one is new and takes occurrence 0.
    expect(await importTransactions(db, importRows([MUSEUM, MUSEUM]), { source: "Test", userId: USER }))
      .toMatchObject({ inserted: 1, duplicates: 0, suppressedDeleted: 1 });
    expect(sqlite.prepare(`SELECT id, occurrence FROM transactions WHERE deleted_at IS NULL`).all())
      .toEqual([{ id: 2, occurrence: 0 }]);

    expect(await restoreTransactions(db, [1, 2, 99], USER)).toBe(1);
    expect(sqlite.prepare(`SELECT id, occurrence FROM transactions WHERE deleted_at IS NULL ORDER BY id`).all())
      .toEqual([{ id: 1, occurrence: 1 }, { id: 2, occurrence: 0 }]);
    sqlite.close();
  });

  it("restores several deleted twins at once into distinct occurrences", async () => {
    const { sqlite, db } = store();
    seed(sqlite, [MUSEUM, MUSEUM, MUSEUM], vectors.imports.aliases);
    await softDeleteTransactions(db, [1, 2], USER);
    expect(await restoreTransactions(db, [1, 2], USER)).toBe(2);
    // Occurrences only have to be free; the unique index would have thrown otherwise.
    const occurrences = sqlite.prepare(`SELECT occurrence FROM transactions WHERE deleted_at IS NULL`)
      .raw().all().flat();
    expect(occurrences).toHaveLength(3);
    expect(new Set(occurrences).size).toBe(3);
    sqlite.close();
  });
});

describe("tagging", () => {
  it("adds and removes normalised tags on live rows, skipping deleted ones", async () => {
    const { sqlite, db } = store();
    seed(sqlite, [
      { date: "2026-01-01", merchant: "TESCO STORES 1", amount: 5, deleted: false },
      { date: "2026-01-02", merchant: "TESCO STORES 1", amount: 6, deleted: true },
    ], vectors.imports.aliases);
    const tagsOf = () => sqlite.prepare(`
      SELECT tt.transaction_id, g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id ORDER BY 1, 2
    `).raw().all();

    expect(await tagTransactions(db, [1, 2, 99], ["Emergency", "trip:Paris"], "add", USER)).toBe(1);
    expect(await tagTransactions(db, [1], ["emergency"], "add", USER)).toBe(1);
    expect(tagsOf()).toEqual([[1, "emergency"], [1, "trip:paris"]]);

    expect(await tagTransactions(db, [1], ["EMERGENCY"], "remove", USER)).toBe(1);
    expect(tagsOf()).toEqual([[1, "trip:paris"]]);

    expect(await tagTransactions(db, [1], ["!!!"], "add", USER)).toBe(0);
    sqlite.close();
  });
});

describe("editing", () => {
  it("re-resolves the merchant and finds a free occurrence at the new identity", async () => {
    const { sqlite, db } = store();
    seed(sqlite, [
      { date: "2026-03-01", merchant: "STARBUCKS #1", amount: 4.5, deleted: false },
      { date: "2026-03-01", merchant: "SOMEWHERE ELSE", amount: 4.5, deleted: false },
    ], vectors.imports.aliases);

    // Row 2 becomes a second Starbucks coffee on the same day: it must not collide with row 1.
    expect(await updateTransaction(db, 2, { merchant: "Starbucks Coffee" }, USER)).toBe(true);
    expect(sqlite.prepare(`
      SELECT t.id, m.canonical_name, t.merchant_raw, t.occurrence
      FROM transactions t JOIN merchants m ON m.id = t.merchant_id ORDER BY t.id
    `).all()).toEqual([
      { id: 1, canonical_name: "Starbucks", merchant_raw: "STARBUCKS #1", occurrence: 0 },
      { id: 2, canonical_name: "Starbucks", merchant_raw: "Starbucks Coffee", occurrence: 1 },
    ]);

    expect(await updateTransaction(db, 2, { merchant: "BRAND NEW PLACE 03/03 1", amountCents: 999, date: "2026-03-03" }, USER))
      .toBe(true);
    expect(sqlite.prepare(`
      SELECT date(t.date, 'unixepoch') AS d, m.canonical_name AS m, t.amount_cents AS c, t.occurrence AS o
      FROM transactions t JOIN merchants m ON m.id = t.merchant_id WHERE t.id = 2
    `).get()).toEqual({ d: "2026-03-03", m: "BRAND NEW PLACE", c: 999, o: 0 });

    expect(await updateTransaction(db, 2, { type: "income", source: "Manual" }, USER)).toBe(true);
    expect(sqlite.prepare(`SELECT type, source, occurrence FROM transactions WHERE id = 2`).get())
      .toEqual({ type: "income", source: "Manual", occurrence: 0 });

    expect(await updateTransaction(db, 99, { type: "income" }, USER)).toBe(false);
    sqlite.close();
  });
});

describe("atomic", () => {
  it("rolls back every statement when one fails", async () => {
    const { sqlite, db } = store([]);
    await expect(atomic(db, [
      sql`INSERT INTO merchants (canonical_name) VALUES ('kept only if all succeed')`,
      sql`INSERT INTO merchants (canonical_name) VALUES (NULL)`,
    ])).rejects.toThrow();
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM merchants`).get()).toEqual({ n: 0 });
    sqlite.close();
  });
});

const REAL_DB = process.env.CROSSCHECK_DB;

describe.runIf(REAL_DB)("on real data (CROSSCHECK_DB)", () => {
  // Vitest runs this body even when the block is skipped, so the database is
  // opened in beforeAll. The tests use a private in-memory copy: nothing here
  // writes to the real file.
  let sqlite: Database.Database;
  let db: Db;
  beforeAll(() => {
    sqlite = inMemoryCopy(REAL_DB!);
    db = drizzle(sqlite, { schema }) as unknown as Db;
  });
  afterAll(() => sqlite.close());

  it("resolves every stored transaction to the merchant the migration gave it", async () => {
    const aliases = await loadAliases(db);
    const rows = sqlite.prepare(`
      SELECT t.merchant_raw AS raw, m.canonical_name AS canonical
      FROM transactions t JOIN merchants m ON m.id = t.merchant_id
    `).all() as { raw: string; canonical: string }[];
    const wrong = rows.filter((r) => resolveMerchantName(r.raw, aliases) !== r.canonical);
    expect(rows.length).toBeGreaterThan(0);
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("re-importing everything, deleted rows included, adds nothing", async () => {
    const all = sqlite.prepare(`
      SELECT date(date, 'unixepoch') AS date, merchant_raw AS merchant, amount_cents AS amountCents, type
      FROM transactions ORDER BY id
    `).all() as ImportRow[];
    const before = count(sqlite, "1");

    const result = await importTransactions(db, all, { source: "Re-import", userId: 1 });

    expect(result.inserted).toBe(0);
    expect(result.suppressedDeleted).toBe(count(sqlite, "deleted_at IS NOT NULL"));
    expect(count(sqlite, "1")).toBe(before);
  });
});
