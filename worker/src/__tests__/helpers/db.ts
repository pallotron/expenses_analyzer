import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

export const WORKER = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = resolve(WORKER, "drizzle");

/** Apply every generated migration in order, as D1 and the migration tool do. */
export function migrate(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(resolve(MIGRATIONS, file), "utf8")
      .split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
}

/**
 * A private in-memory copy of a database file, for tests that write to real
 * data. The file is only read.
 *
 * migrate_to_sqlite.py writes in WAL mode, and an in-memory database cannot be
 * WAL, so the copy's header is switched to the rollback journal (bytes 18 and
 * 19, the file format read/write versions) before loading. serialize() reads
 * through the connection, so changes still in the -wal file are included.
 */
export function inMemoryCopy(path: string): Database.Database {
  const source = new Database(path, { readonly: true, fileMustExist: true });
  const bytes = source.serialize();
  source.close();
  bytes[18] = 1;
  bytes[19] = 1;
  return new Database(bytes);
}

/** A fresh in-memory database with the current schema. */
export function emptyDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  migrate(sqlite);
  return sqlite;
}
