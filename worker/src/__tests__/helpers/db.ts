import { resolve } from "node:path";
import Database from "better-sqlite3";

import { migrate } from "../../../scripts/migrate";

export const WORKER = resolve(import.meta.dirname, "../../..");
export { migrate };

/** A fresh in-memory database with the current schema. */
export function emptyDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  migrate(sqlite);
  return sqlite;
}
