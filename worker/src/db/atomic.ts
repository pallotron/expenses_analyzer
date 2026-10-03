import type { SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { Db } from "./types";

/**
 * Run statements all-or-nothing, on whichever driver `db` is.
 *
 * D1 has no interactive transactions; a batch is its unit of atomicity. A local
 * SQLite file (tests, a desktop build) has transactions but no batch. This is
 * the only code that knows the difference, which keeps driver-specific calls
 * out of the query modules.
 *
 * Statements cannot see each other's results from JavaScript, so write them to
 * find what earlier ones inserted in SQL (by natural key, not returned ids).
 *
 * On D1 this builds the prepared statements itself instead of calling drizzle's
 * `batch`. In drizzle 0.44 that method binds parameters through the prepared
 * query's `.stmt`, which `db.run(sql)` items do not have, so any statement with
 * parameters fails with "Cannot read properties of undefined (reading 'bind')".
 * Do not simplify this back to `db.batch(statements.map(db.run))`.
 */
export async function atomic(db: Db, statements: SQL[]): Promise<void> {
  if (statements.length === 0) return;

  const batching = db as unknown as {
    batch?: (items: unknown[]) => Promise<unknown>;
  };
  if (typeof batching.batch === "function") {
    // drizzle's D1 driver keeps the D1Database on $client, and its dialect
    // turns each SQL into the text and params D1 wants. D1's own batch is
    // atomic: if one statement fails, none of them apply.
    const client = (db as unknown as { $client: D1Database }).$client;
    const dialect = new SQLiteAsyncDialect();
    await client.batch(
      statements.map((s) => {
        const { sql, params } = dialect.sqlToQuery(s);
        return client.prepare(sql).bind(...params);
      }),
    );
    return;
  }

  // Local SQLite: synchronous, so the callback runs every statement inside
  // BEGIN/COMMIT and rolls back if any throws.
  db.transaction((tx) => {
    for (const statement of statements) tx.run(statement);
  });
}
