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

/** A fresh in-memory database with the current schema. */
export function emptyDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  migrate(sqlite);
  return sqlite;
}
