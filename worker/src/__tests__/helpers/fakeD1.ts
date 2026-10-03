/**
 * A stand-in for Cloudflare's D1Database, backed by better-sqlite3.
 *
 * The unit tests run on better-sqlite3 through drizzle's sync driver, which has
 * no `batch`, so they never reach the D1 branch of atomic(). Wrapping the same
 * SQLite file in D1's prepare/bind/batch shape lets drizzle's real D1 driver run
 * against it. It implements only what that driver and atomic() call.
 */

import type Database from "better-sqlite3";

type Param = string | number | bigint | Buffer | null;

function meta(changes: number, lastRowId: number) {
  return { changes, last_row_id: lastRowId, rows_read: 0, rows_written: changes, duration: 0 };
}

class FakeBound {
  private sqlite: Database.Database;
  private sql: string;
  private params: Param[];

  constructor(sqlite: Database.Database, sql: string, params: Param[]) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  /** Runs on the current connection; batch() wraps these in one transaction. */
  runSync() {
    const stmt = this.sqlite.prepare(this.sql);
    if (stmt.reader) return { success: true, meta: meta(0, 0), results: stmt.all(...this.params) };
    const info = stmt.run(...this.params);
    return { success: true, meta: meta(info.changes, Number(info.lastInsertRowid)), results: [] };
  }

  async run() {
    return this.runSync();
  }

  async all() {
    const stmt = this.sqlite.prepare(this.sql);
    const results = stmt.reader ? stmt.all(...this.params) : (stmt.run(...this.params), []);
    return { success: true, meta: meta(0, 0), results };
  }

  async raw() {
    return this.sqlite.prepare(this.sql).raw().all(...this.params);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.params) ?? null;
  }
}

class FakeStatement {
  private sqlite: Database.Database;
  private sql: string;

  constructor(sqlite: Database.Database, sql: string) {
    this.sqlite = sqlite;
    this.sql = sql;
  }

  bind(...params: Param[]) {
    // D1 refuses a statement with more than 100 bound parameters.
    if (params.length > 100) throw new Error("D1_ERROR: too many SQL variables");
    return new FakeBound(this.sqlite, this.sql, params);
  }
}

export function fakeD1(sqlite: Database.Database): D1Database {
  return {
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    // D1 rolls the whole batch back if one statement fails; so does a
    // better-sqlite3 transaction.
    batch: async (statements: FakeBound[]) =>
      sqlite.transaction(() => statements.map((s) => s.runSync()))(),
  } as unknown as D1Database;
}
