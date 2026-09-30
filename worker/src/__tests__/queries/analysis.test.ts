/**
 * The query modules must return exactly what the cross-check SQL returns.
 *
 * tools/crosscheck/ proves those SQL files equal to the Python on real data;
 * this proves the Drizzle modules equal to the SQL files. Together they carry
 * the TUI's numbers through to the Worker unchanged.
 *
 * Runs on a synthetic fixture by default. Set CROSSCHECK_DB to a database built
 * by tools/migrate_to_sqlite.py to run the same comparison on real data too.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import type { Db } from "../../db/types";
import * as schema from "../../db/schema";
import { WORKER, emptyDatabase, inMemoryCopy } from "../helpers/db";
import {
  cashFlowTotals,
  categoryBreakdown,
  hiddenTagTotal,
  merchantsByYear,
  netCashFlow,
  spendingTypeByYear,
  type Scope,
} from "../../queries/analysis";

const QUERIES = resolve(WORKER, "../tools/crosscheck/queries");

/* ------------------------------------------------------------- fixture */

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

/**
 * Small, but it exercises every rule the views encode: soft deletes, the
 * category override, uncategorised and unresolved merchants, a period with only
 * income, prefix and exact tag exclusion, and the LIKE-underscore trap.
 */
function seed(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO users (id, email, display_name, owner_key)
      VALUES (1, 'a@example.com', 'A', 'self');

    INSERT INTO categories (id, name, spending_type) VALUES
      (1, 'Groceries', 'essential'),
      (2, 'Dining',    'discretionary'),
      (3, 'Rent',      'essential'),
      (4, 'Salary',    NULL),
      (5, 'Books',     NULL);

    INSERT INTO merchants (id, canonical_name, category_id) VALUES
      (1, 'Tesco',    1),
      (2, 'Cafe',     2),
      (3, 'Landlord', 3),
      (4, 'Employer', 4),
      (5, 'Mystery',  NULL),
      (6, 'Amazon',   5);

    INSERT INTO tags (id, name) VALUES
      (1, 'emergency'), (2, 'trip:paris'), (3, 'trip_a'), (4, 'tripx:rome'), (5, 'gift');

    INSERT INTO tag_exclusion_patterns (pattern) VALUES
      ('emergency'), ('trip:*'), ('trip_*');
  `);

  const txn = sqlite.prepare(`
    INSERT INTO transactions
      (id, date, merchant_raw, merchant_id, amount_cents, type,
       category_override_id, occurrence, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rows: [number, string, string, number | null, number, string, number | null, number, number | null][] = [
    [1, "2025-12-03", "TESCO 1", 1, 4_512, "expense", null, 0, null],
    [2, "2025-12-03", "TESCO 1", 1, 4_512, "expense", null, 1, null], // same-day twin
    [3, "2025-12-15", "CAFE", 2, 1_250, "expense", null, 0, null],
    [4, "2025-12-28", "SALARY", 4, 400_000, "income", null, 0, null],
    [5, "2026-01-01", "RENT", 3, 150_000, "expense", null, 0, null],
    [6, "2026-01-09", "AMZN", 6, 2_999, "expense", 1, 0, null], // override → Groceries
    [7, "2026-01-10", "AMZN", 6, 1_999, "expense", null, 0, null],
    [8, "2026-01-12", "???", 5, 777, "expense", null, 0, null], // uncategorised
    [9, "2026-01-13", "UNKNOWN", null, 333, "expense", null, 0, null], // unresolved
    [10, "2026-01-20", "VET", 5, 80_000, "expense", null, 0, null], // emergency
    [11, "2026-02-02", "HOTEL", 2, 45_000, "expense", null, 0, null], // trip:paris
    [12, "2026-02-03", "CAFE", 2, 900, "expense", null, 0, null], // tripx:rome — not hidden
    [13, "2026-02-04", "CAFE", 2, 650, "expense", null, 0, null], // trip_a
    [14, "2026-02-05", "TESCO 1", 1, 9_999, "expense", null, 0, day("2026-02-06")], // deleted
    [15, "2026-02-10", "REFUND", 4, 5_000, "income", null, 0, null], // hidden income
    [16, "2026-03-28", "SALARY", 4, 410_000, "income", null, 0, null], // income-only month
  ];
  for (const [id, date, raw, merchant, cents, type, override, occurrence, deleted] of rows) {
    txn.run(id, day(date), raw, merchant, cents, type, override, occurrence, deleted);
  }

  sqlite.exec(`
    INSERT INTO transaction_tags (transaction_id, tag_id) VALUES
      (10, 1), (10, 5), (11, 2), (12, 4), (13, 3), (14, 1), (15, 1), (3, 5);
  `);

  // Two sources, so the source filter has something to split.
  sqlite.exec(`UPDATE transactions SET source = 'Card' WHERE id IN (3, 7, 11, 15)`);
}

function fixture(): Database.Database {
  const sqlite = emptyDatabase();
  seed(sqlite);
  return sqlite;
}

/* ------------------------------------------------------------ the cases */

type Row = unknown[];

/** The verified SQL, run exactly as the cross-check runs it. */
function reference(sqlite: Database.Database, file: string, view: string, params?: object): Row[] {
  let text = readFileSync(resolve(QUERIES, file), "utf8").replaceAll("{view}", view);
  // hidden_tag_total.sql names v_live itself rather than taking {view}.
  if (view.startsWith("scoped_")) text = text.replaceAll("FROM v_live", `FROM ${view}`);
  const stmt = sqlite.prepare(text).raw();
  return (params ? stmt.all(params) : stmt.all()) as Row[];
}

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * A temp view holding only the rows a scope keeps. Running a verified SQL file
 * over it answers "the same query, filtered", which is what a scoped query
 * module must return.
 */
function scopedView(sqlite: Database.Database, base: "v_summary" | "v_live", scope: Scope): string {
  const terms: string[] = [];
  if (scope.sources) {
    terms.push(scope.sources.length ? `source IN (${scope.sources.map(lit).join(", ")})` : "0");
  }
  if (scope.year) terms.push(`year = ${lit(scope.year)}`);
  if (scope.month) terms.push(`month = ${lit(scope.month)}`);
  const name = `scoped_${base}`;
  sqlite.exec(`DROP VIEW IF EXISTS temp.${name}`);
  sqlite.exec(`CREATE TEMP VIEW ${name} AS SELECT * FROM ${base} ${terms.length ? `WHERE ${terms.join(" AND ")}` : ""}`);
  return name;
}

/** Scopes worth checking on a database: its own newest year, month and a source. */
function scopesFor(sqlite: Database.Database): Scope[] {
  const [year, month] = sqlite.prepare(`SELECT MAX(year), MAX(month) FROM v_live`).raw().get() as [string, string];
  const sources = (sqlite.prepare(`SELECT DISTINCT source FROM v_live ORDER BY source`).raw().all() as [string][])
    .map(([s]) => s);
  return [
    { year },
    { month },
    { sources: [sources[0]] },
    { sources: [sources[0]], year },
    { sources: [] },
    { sources },
  ];
}

interface Case {
  name: string;
  file: string;
  view: string;
  params?: object;
  scope?: Scope;
  run: (db: Db) => Promise<Row[]>;
  runScoped?: (db: Db, scope: Scope) => Promise<Row[]>;
}

const values = (rows: object[]): Row[] => rows.map((r) => Object.values(r));

function cases(): Case[] {
  const out: Case[] = [];
  for (const includeHidden of [false, true]) {
    const scope: Scope = { includeHidden };
    const view = includeHidden ? "v_live" : "v_summary";
    const tag = includeHidden ? " (hidden included)" : "";

    out.push(
      {
        name: `cash flow totals${tag}`,
        file: "cash_flow_totals.sql",
        view,
        run: async (db) => values([await cashFlowTotals(db, scope)]),
        runScoped: async (db, s) => values([await cashFlowTotals(db, s)]),
      },
      {
        name: `cash flow by month${tag}`,
        file: "net_cash_flow_by_month.sql",
        view,
        run: async (db) => values(await netCashFlow(db, "month", scope)),
        runScoped: async (db, s) => values(await netCashFlow(db, "month", s)),
      },
      {
        name: `cash flow by year${tag}`,
        file: "net_cash_flow_by_year.sql",
        view,
        run: async (db) => values(await netCashFlow(db, "year", scope)),
        runScoped: async (db, s) => values(await netCashFlow(db, "year", s)),
      },
      {
        name: `essential vs discretionary by year${tag}`,
        file: "spending_type_by_year.sql",
        view,
        run: async (db) => values(await spendingTypeByYear(db, scope)),
        runScoped: async (db, s) => values(await spendingTypeByYear(db, s)),
      },
    );

    for (const type of ["expense", "income"] as const) {
      out.push(
        {
          name: `category breakdown by year, ${type}${tag}`,
          file: "category_breakdown_by_year.sql",
          view,
          params: { type },
          run: async (db) => values(await categoryBreakdown(db, "year", type, scope)),
          runScoped: async (db, s) => values(await categoryBreakdown(db, "year", type, s)),
        },
        {
          name: `category breakdown by month, ${type}${tag}`,
          file: "category_breakdown_by_month.sql",
          view,
          params: { type },
          run: async (db) => values(await categoryBreakdown(db, "month", type, scope)),
          runScoped: async (db, s) => values(await categoryBreakdown(db, "month", type, s)),
        },
        {
          name: `merchants by year, ${type}${tag}`,
          file: "top_merchants_by_year.sql",
          view,
          params: { type },
          run: async (db) => values(await merchantsByYear(db, type, scope)),
          runScoped: async (db, s) => values(await merchantsByYear(db, type, s)),
        },
      );
    }
  }

  out.push({
    name: "hidden tag total",
    file: "hidden_tag_total.sql",
    view: "v_live",
    run: async (db) => [[await hiddenTagTotal(db)]],
  });
  return out;
}

/** Every unscoped case again under each scope, compared with the scoped view. */
function scopedCases(scopes: Scope[]): Case[] {
  const out: Case[] = [];
  for (const scope of scopes) {
    const label = JSON.stringify(scope);
    for (const includeHidden of [false, true]) {
      const full: Scope = { ...scope, includeHidden };
      const base = includeHidden ? "v_live" : "v_summary";
      for (const c of cases().filter((c) => c.file !== "hidden_tag_total.sql" && c.view === base)) {
        out.push({ ...c, name: `${c.name} ${label}`, scope: full, run: (db) => c.runScoped!(db, full) });
      }
    }
    out.push({
      name: `hidden tag total ${label}`,
      file: "hidden_tag_total.sql",
      view: "v_live",
      scope,
      run: async (db) => [[await hiddenTagTotal(db, scope)]],
    });
  }
  return out;
}

/* ---------------------------------------------------------------- suites */

const databases: [string, () => Database.Database][] = [["synthetic fixture", fixture]];
if (process.env.CROSSCHECK_DB) {
  const path = process.env.CROSSCHECK_DB;
  databases.push([`CROSSCHECK_DB`, () => inMemoryCopy(path)]);
}

describe.each(databases)("analysis queries match the cross-check SQL: %s", (_label, open) => {
  const sqlite = open();
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  afterAll(() => sqlite.close());

  const all = [...cases(), ...scopedCases(scopesFor(sqlite))];
  it.each(all.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const view = c.scope ? scopedView(sqlite, c.view as "v_summary" | "v_live", c.scope) : c.view;
    const expected = reference(sqlite, c.file, view, c.params);
    expect(await c.run(db)).toEqual(expected);
  });
});

/*
 * Equality with the SQL proves nothing if both are wrong the same way on a
 * fixture that never exercises a rule. These pin the fixture's own answers.
 */
describe("the fixture exercises each rule", () => {
  const sqlite = fixture();
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  afterAll(() => sqlite.close());

  it("hides exact, prefix and underscore-prefix tags, but not look-alikes", async () => {
    // 10 (emergency) + 11 (trip:paris) + 13 (trip_a); 12 (tripx:rome) stays.
    expect(await hiddenTagTotal(db)).toBe(80_000 + 45_000 + 650);
  });

  it("drops soft-deleted rows and keeps same-day twins", async () => {
    const feb = (await categoryBreakdown(db, "month", "expense", { includeHidden: true }))
      .filter((r) => r.period === "2026-02");
    expect(feb).toEqual([{ period: "2026-02", category: "Dining", amountCents: 45_000 + 900 + 650 }]);

    const dec = (await categoryBreakdown(db, "month", "expense"))
      .find((r) => r.period === "2025-12" && r.category === "Groceries");
    expect(dec?.amountCents).toBe(2 * 4_512);
  });

  it("resolves the override first, then the merchant, then Other", async () => {
    const jan = (await categoryBreakdown(db, "month", "expense"))
      .filter((r) => r.period === "2026-01");
    expect(jan).toEqual([
      { period: "2026-01", category: "Books", amountCents: 1_999 },
      { period: "2026-01", category: "Groceries", amountCents: 2_999 },
      { period: "2026-01", category: "Other", amountCents: 777 + 333 },
      { period: "2026-01", category: "Rent", amountCents: 150_000 },
    ]);
  });

  it("reports an income-only month with zero expenses", async () => {
    const march = (await netCashFlow(db, "month")).find((r) => r.period === "2026-03");
    expect(march).toEqual({ period: "2026-03", incomeCents: 410_000, expensesCents: 0 });
  });

  it("buckets untyped and uncategorised spend as discretionary", async () => {
    expect(await spendingTypeByYear(db)).toEqual([
      { period: "2025", spendingType: "discretionary", amountCents: 1_250 },
      { period: "2025", spendingType: "essential", amountCents: 2 * 4_512 },
      { period: "2026", spendingType: "discretionary", amountCents: 1_999 + 777 + 333 + 900 },
      { period: "2026", spendingType: "essential", amountCents: 150_000 + 2_999 },
    ]);
  });

  it("keeps an unresolved merchant as its own null row", async () => {
    const rows = await merchantsByYear(db, "expense");
    expect(rows.find((r) => r.period === "2026" && r.merchant === null))
      .toEqual({ period: "2026", merchant: null, amountCents: 333, txnCount: 1 });
  });
});
