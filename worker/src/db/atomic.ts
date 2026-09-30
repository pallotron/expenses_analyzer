import type { SQL } from "drizzle-orm";
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
 */
export async function atomic(db: Db, statements: SQL[]): Promise<void> {
  if (statements.length === 0) return;

  const batching = db as unknown as {
    batch?: (items: unknown[]) => Promise<unknown>;
  };
  if (typeof batching.batch === "function") {
    await batching.batch(statements.map((s) => db.run(s)));
    return;
  }

  // Local SQLite: synchronous, so the callback runs every statement inside
  // BEGIN/COMMIT and rolls back if any throws.
  db.transaction((tx) => {
    for (const statement of statements) tx.run(statement);
  });
}
