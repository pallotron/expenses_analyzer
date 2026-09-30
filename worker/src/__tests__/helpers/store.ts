/**
 * Small stores for service tests, seeded the way tools/migrate_to_sqlite.py
 * seeds the real one, so a test starts from the state an import would meet.
 */

import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { compileAliases, resolveMerchantName } from "../../domain/merchants";
import { epochDay } from "../../domain/money";
import { emptyDatabase } from "./db";

export const USER = 1;
export const cents = (euros: number) => Math.round(euros * 100);

export interface Spec { date: string; merchant: string; amount: number; deleted: boolean }

/** An empty store with one user and the given aliases, in priority order. */
export function store(aliasRules: string[][]) {
  const sqlite = emptyDatabase();
  sqlite.exec(`INSERT INTO users (id, email, display_name, owner_key) VALUES (1, 'a@example.com', 'A', 'self')`);
  aliasRules.forEach(([pattern, canonical], priority) => {
    sqlite.prepare(`INSERT OR IGNORE INTO merchants (canonical_name) VALUES (?)`).run(canonical);
    sqlite.prepare(`
      INSERT INTO merchant_aliases (pattern, priority, merchant_id)
      SELECT ?, ?, id FROM merchants WHERE canonical_name = ?
    `).run(pattern, priority, canonical);
  });
  return { sqlite, db: drizzle(sqlite, { schema }) as unknown as Db };
}

/** Seed rows as the migration does: occurrence counted over live rows only. */
export function seed(sqlite: Database.Database, specs: Spec[], aliasRules: string[][]) {
  const aliases = compileAliases(aliasRules.map(([pattern, canonicalName]) => ({ pattern, canonicalName })));
  const counts = new Map<string, number>();
  for (const s of specs) {
    const canonical = resolveMerchantName(s.merchant, aliases);
    sqlite.prepare(`INSERT OR IGNORE INTO merchants (canonical_name) VALUES (?)`).run(canonical);
    const key = JSON.stringify([s.date, canonical, cents(s.amount)]);
    const occurrence = s.deleted ? 0 : (counts.get(key) ?? 0);
    if (!s.deleted) counts.set(key, occurrence + 1);
    sqlite.prepare(`
      INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, occurrence, deleted_at)
      SELECT ?, ?, id, ?, ?, ? FROM merchants WHERE canonical_name = ?
    `).run(epochDay(s.date), s.merchant, cents(s.amount), occurrence, s.deleted ? 1 : null, canonical);
  }
}

/** Give named merchants a category, creating both as needed. */
export function categorise(sqlite: Database.Database, byMerchant: Record<string, string>) {
  for (const [merchant, category] of Object.entries(byMerchant)) {
    sqlite.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`).run(category);
    sqlite.prepare(`INSERT OR IGNORE INTO merchants (canonical_name) VALUES (?)`).run(merchant);
    sqlite.prepare(`
      UPDATE merchants SET category_id = (SELECT id FROM categories WHERE name = ?)
      WHERE canonical_name = ?
    `).run(category, merchant);
  }
}

export function liveRows(sqlite: Database.Database): [string, string, number][] {
  return sqlite.prepare(`
    SELECT date(t.date, 'unixepoch'), m.canonical_name, t.amount_cents
    FROM transactions t JOIN merchants m ON m.id = t.merchant_id
    WHERE t.deleted_at IS NULL
    ORDER BY 1, 2, 3
  `).raw().all() as [string, string, number][];
}

export const count = (sqlite: Database.Database, where: string) =>
  (sqlite.prepare(`SELECT COUNT(*) FROM transactions WHERE ${where}`).raw().get() as [number])[0];
