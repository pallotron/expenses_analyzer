/**
 * Gemini auto-categorize (the TUI's "Auto-Categorize Uncategorized"). Every
 * call is made before anything is written, and the write is one batch, so a
 * failure leaves the store as it was. Answers are saved flagged as
 * suggested; the Merchants page confirms them.
 */

import { sql } from "drizzle-orm";
import type { ConfirmResponse, SuggestResponse } from "../api/merchants";
import type { TransactionType } from "../api/transactions";
import { atomic } from "../db/atomic";
import { categories, merchants } from "../db/schema";
import type { Db } from "../db/types";
import { categoryGuidance, geminiPrompt, parseGeminiResponse } from "../domain/gemini";
import { listMerchants } from "../queries/merchants";
import type { GenerateText } from "./gemini";

/** Names per Gemini call, so a large backlog never makes one huge prompt. */
export const SUGGEST_CHUNK = 100;

export async function suggestCategories(db: Db, generate: GenerateText, userId: number): Promise<SuggestResponse> {
  const rows = await listMerchants(db);
  // Every uncategorized merchant the Merchants page lists: live rows or a rule.
  const todo = rows.filter((m) => m.category === null);
  if (todo.length === 0) return { asked: 0, suggested: 0, newCategories: [], unanswered: 0 };

  const stored = await db.select({ name: categories.name, archived: categories.isArchived }).from(categories);
  const active = stored.filter((c) => !c.archived).map((c) => c.name).sort();
  const activeSet = new Set(active);
  // Lower-case name -> the spelling to save, so "groceries" lands on "Groceries".
  const spelling = new Map(stored.map((c) => [c.name.toLowerCase(), c.name]));
  const newCategories: string[] = [];
  const idByName = new Map(todo.map((m) => [m.name, m.id]));
  const answers: { id: number; category: string }[] = [];

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
          newCategories.push(answer);
        }
        answers.push({ id: idByName.get(name) as number, category });
      }
    }
  }
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
