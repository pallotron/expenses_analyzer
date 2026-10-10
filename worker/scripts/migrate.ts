import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";

const MIGRATIONS = resolve(import.meta.dirname, "../drizzle");

/** Apply every generated migration in order, as D1 and the migration tool do. */
export function migrate(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(resolve(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
}
