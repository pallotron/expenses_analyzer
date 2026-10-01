/**
 * A store holding tools/crosscheck/vectors.py's summary rows, so the Summary
 * numbers can be computed through the real views and compared with the Python.
 */

import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { epochDay } from "../../domain/money";
import rawVectors from "../fixtures/python_vectors.json";
import { emptyDatabase } from "./db";

export type SummaryRow = [
  date: string, merchant: string, cents: number, type: "expense" | "income", category: string, source: string,
];

export interface ExpectedGrid {
  total: { totalCents: number; months: number[] };
  rows: { category: string; totalCents: number; averageCents: number; months: number[]; anomalies: boolean[]; trends: (string | null)[] }[];
}

/** The "summary" section of python_vectors.json (tools/crosscheck/vectors.py). */
export const summaryVectors = (rawVectors as unknown as {
  summary: {
    categoryTypes: { essential: { categories: string[] }; discretionary: { categories: string[] } };
    rows: SummaryRow[];
    grids: { year: number; sources: string[] | null; type: "expense" | "income"; expected: ExpectedGrid | null }[];
    merchants: {
      year: number; month: number | null; sources: string[] | null; type: "expense" | "income";
      expected: [string, string, number][];
    }[];
  };
}).summary;

/**
 * Each merchant takes the category of its first row; a row with a different
 * category gets it as an override. "Other" is never stored: v_live resolves a
 * missing category to it, as the Python's fillna("Other") did. A category in
 * neither list gets no spending type, like one missing from category_types.json.
 */
export function summaryStore(
  rows: SummaryRow[], essential: string[], discretionary: string[] = [],
): { sqlite: Database.Database; db: Db } {
  const sqlite = emptyDatabase();
  sqlite.exec(`INSERT INTO users (id, email, display_name, owner_key) VALUES (1, 'a@example.com', 'A', 'self')`);

  const categoryId = (name: string): number | null => {
    if (name === "Other") return null;
    const kind = essential.includes(name) ? "essential" : discretionary.includes(name) ? "discretionary" : null;
    sqlite.prepare(`INSERT OR IGNORE INTO categories (name, spending_type) VALUES (?, ?)`).run(name, kind);
    return (sqlite.prepare(`SELECT id FROM categories WHERE name = ?`).raw().get(name) as [number])[0];
  };

  const merchantCategory = new Map<string, number | null>();
  const occurrences = new Map<string, number>();
  for (const [date, merchant, cents, type, category, source] of rows) {
    const catId = categoryId(category);
    if (!merchantCategory.has(merchant)) {
      merchantCategory.set(merchant, catId);
      sqlite.prepare(`INSERT INTO merchants (canonical_name, category_id) VALUES (?, ?)`).run(merchant, catId);
    }
    const override = merchantCategory.get(merchant) === catId ? null : catId;
    const key = JSON.stringify([date, merchant, cents]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    sqlite.prepare(`
      INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source, category_override_id, occurrence)
      SELECT ?, ?, id, ?, ?, ?, ?, ? FROM merchants WHERE canonical_name = ?
    `).run(epochDay(date), merchant, cents, type, source, override, occurrence, merchant);
  }
  return { sqlite, db: drizzle(sqlite, { schema }) as unknown as Db };
}

/** A store holding the vector rows, typed as the Python's category_types. */
export function vectorStore(): { sqlite: Database.Database; db: Db } {
  const t = summaryVectors.categoryTypes;
  return summaryStore(summaryVectors.rows, t.essential.categories, t.discretionary.categories);
}
