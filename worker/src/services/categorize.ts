/**
 * Gemini auto-categorize (the TUI's "Auto-Categorize Uncategorized"), and
 * Gemini's second opinion on merchants the user picks. Every call is made
 * before anything is written, and each write is one batch, so a failure
 * leaves the store as it was. Suggestions are saved flagged as suggested; a
 * second opinion is only returned, and the user applies what they choose.
 */

import { sql } from "drizzle-orm";
import type {
  AskResponse, CategoryChange, CategoryChangesResponse, ConfirmResponse, MerchantRow, SuggestResponse,
} from "../api/merchants";
import type { TransactionType } from "../api/transactions";
import { atomic } from "../db/atomic";
import { categories, merchants } from "../db/schema";
import type { Db } from "../db/types";
import { categoryGuidance, geminiPrompt, parseGeminiResponse } from "../domain/gemini";
import { listMerchants } from "../queries/merchants";
import type { GenerateText } from "./gemini";

/** Names per Gemini call, so a large backlog never makes one huge prompt. */
export const SUGGEST_CHUNK = 100;

interface GeminiAnswer { id: number; name: string; category: string; isNew: boolean }

/**
 * Ask Gemini about `todo` (a subset of the page's `rows`), blind: names only,
 * per type, guided by the categories that type already uses. Answers come
 * back in an existing category's spelling when one matches, ignoring case.
 */
async function askGemini(db: Db, generate: GenerateText, rows: MerchantRow[], todo: MerchantRow[]): Promise<GeminiAnswer[]> {
  const stored = await db.select({ name: categories.name, archived: categories.isArchived }).from(categories);
  const active = stored.filter((c) => !c.archived).map((c) => c.name).sort();
  const activeSet = new Set(active);
  // Lower-case name -> the spelling to save, so "groceries" lands on "Groceries".
  const spelling = new Map(stored.map((c) => [c.name.toLowerCase(), c.name]));
  const existing = new Set(spelling.keys());
  const idByName = new Map(todo.map((m) => [m.name, m.id]));
  const answers: GeminiAnswer[] = [];

  for (const type of ["expense", "income"] as TransactionType[]) {
    const names = todo.filter((m) => m.type === type).map((m) => m.name).sort();
    if (names.length === 0) continue;
    const used = [...new Set(rows
      .filter((m) => m.type === type && m.category !== null && activeSet.has(m.category))
      .map((m) => m.category as string))].sort();
    const guidance = categoryGuidance(used.length > 0 ? used : active, type);
    for (let i = 0; i < names.length; i += SUGGEST_CHUNK) {
      const chunk = names.slice(i, i + SUGGEST_CHUNK);
      const parsed = parseGeminiResponse(await generate(geminiPrompt(chunk, guidance, type)), chunk);
      for (const [name, answer] of Object.entries(parsed)) {
        let category = spelling.get(answer.toLowerCase());
        if (category === undefined) {
          category = answer;
          spelling.set(answer.toLowerCase(), answer);
        }
        answers.push({ id: idByName.get(name) as number, name, category, isNew: !existing.has(answer.toLowerCase()) });
      }
    }
  }
  return answers;
}

export async function suggestCategories(db: Db, generate: GenerateText, userId: number): Promise<SuggestResponse> {
  const rows = await listMerchants(db);
  // Every uncategorized merchant the Merchants page lists: live rows or a rule.
  const todo = rows.filter((m) => m.category === null);
  if (todo.length === 0) return { asked: 0, suggested: 0, newCategories: [], unanswered: 0 };

  const asked = await askGemini(db, generate, rows, todo);
  const answers = asked.map(({ id, category }) => ({ id, category }));
  const newCategories = [...new Set(asked.filter((a) => a.isNew).map((a) => a.category))];
  if (answers.length === 0) return { asked: todo.length, suggested: 0, newCategories: [], unanswered: todo.length };

  const payload = JSON.stringify(answers);
  await atomic(db, [
    ...(newCategories.length > 0
      ? [sql`INSERT OR IGNORE INTO categories (name) SELECT value FROM json_each(${JSON.stringify(newCategories)})`]
      : []),
    // Only merchants still uncategorized: one set meanwhile wins over Gemini.
    sql`
      UPDATE merchants
      SET category_id = c.id, category_suggested = 1, category_set_by = ${userId}, category_set_at = unixepoch()
      FROM json_each(${payload}) j
      JOIN categories c ON c.name = json_extract(j.value, '$.category')
      WHERE merchants.id = json_extract(j.value, '$.id') AND merchants.category_id IS NULL
    `,
  ]);

  // Count what the update actually changed, not what Gemini answered.
  const changed = await db.select({ category: categories.name }).from(merchants)
    .innerJoin(categories, sql`${categories.id} = ${merchants.categoryId}`).where(sql`
    ${merchants.categorySuggested} = 1 AND EXISTS (
      SELECT 1 FROM json_each(${payload}) j
      WHERE ${merchants.id} = json_extract(j.value, '$.id') AND ${categories.name} = json_extract(j.value, '$.category')
    )
  `);
  const landed = new Set(changed.map((r) => r.category));
  return {
    asked: todo.length,
    suggested: changed.length,
    newCategories: newCategories.filter((c) => landed.has(c)),
    unanswered: todo.length - changed.length,
  };
}

/** Accept suggested categories as they are. Unflagged ids are ignored. */
export async function confirmSuggestions(db: Db, merchantIds: number[], userId: number): Promise<ConfirmResponse> {
  const ids = JSON.stringify([...new Set(merchantIds)]);
  const flagged = sql`${merchants.id} IN (SELECT value FROM json_each(${ids})) AND ${merchants.categorySuggested} = 1`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(merchants).where(flagged);
  if (n === 0) return { confirmed: 0 };
  await atomic(db, [sql`
    UPDATE merchants SET category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
    WHERE id IN (SELECT value FROM json_each(${ids})) AND category_suggested = 1
  `]);
  return { confirmed: n };
}

/** Gemini's opinion on the chosen merchants the page lists. Writes nothing. */
export async function askCategories(db: Db, generate: GenerateText, merchantIds: number[]): Promise<AskResponse> {
  const rows = await listMerchants(db);
  const chosen = new Set(merchantIds);
  const todo = rows.filter((m) => chosen.has(m.id));
  if (todo.length === 0) return { answers: [], unanswered: 0 };
  const current = new Map(todo.map((m) => [m.id, m.category]));
  const answers = (await askGemini(db, generate, rows, todo))
    .map((a) => ({ id: a.id, name: a.name, current: current.get(a.id) ?? null, suggested: a.category, isNew: a.isNew }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { answers, unanswered: todo.length - answers.length };
}

/**
 * Give each merchant its own category in one batch, creating missing ones.
 * A choice the user made, so it is not flagged as suggested. Unknown ids are
 * ignored; for a repeated id the last change wins.
 */
export async function applyCategories(db: Db, changes: CategoryChange[], userId: number): Promise<CategoryChangesResponse> {
  const byId = new Map(changes.map((c) => [c.id, c.category.trim()]));
  if (byId.size === 0) return { updated: 0 };
  const payload = JSON.stringify([...byId].map(([id, category]) => ({ id, category })));
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(merchants)
    .where(sql`${merchants.id} IN (SELECT json_extract(value, '$.id') FROM json_each(${payload}))`);
  if (n === 0) return { updated: 0 };
  await atomic(db, [
    // Only for merchants that exist, so an unknown id leaves no stray category.
    sql`
      INSERT OR IGNORE INTO categories (name)
      SELECT DISTINCT json_extract(j.value, '$.category') FROM json_each(${payload}) j
      JOIN merchants m ON m.id = json_extract(j.value, '$.id')
    `,
    sql`
      UPDATE merchants
      SET category_id = c.id, category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
      FROM json_each(${payload}) j
      JOIN categories c ON c.name = json_extract(j.value, '$.category')
      WHERE merchants.id = json_extract(j.value, '$.id')
    `,
  ]);
  return { updated: n };
}
