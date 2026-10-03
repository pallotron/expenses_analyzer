/**
 * Editing merchant aliases: merchant_editor.py, and what saving one now has
 * to do that the Python never did.
 *
 * Aliases are regexes applied first-match-wins, so a pattern's effect depends
 * on every rule around it. The preview does not reason about that: it applies
 * the candidate table and compares names before and after, as the Python did.
 * It does so only for rows the edited pattern matches. Every other row skips
 * that rule under both tables, so its name cannot change. That keeps a save to
 * a few milliseconds of CPU, where resolving every row against every rule
 * took over a hundred.
 *
 * Saving differs because of where names live. The Python re-derived every
 * display name from the alias table on each load, so a new alias applied to
 * old rows at once. Here each row stores its merchant, so saving must re-point
 * every row whose name the new table changes. Otherwise old rows keep the old
 * merchant, and imports would no longer see them as duplicates of new ones.
 */

import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { atomic } from "../db/atomic";
import { categories, merchantAliases, merchants, transactions } from "../db/schema";
import type { Db } from "../db/types";
import {
  compileAliases, resolveMerchantName, type AliasRule,
} from "../domain/merchants";
import { normalizeTags } from "../domain/tags";
import { loadAliasRules } from "./transactions";

/** Stands in for an alias not typed yet, so the preview works mid-edit. */
const PENDING_ALIAS = "\u0000pending-alias";

/**
 * The table with `pattern` pointing at `alias`. An existing pattern keeps its
 * place, so editing one can outrank later rules; a new one is tried last.
 */
function withRule(rules: AliasRule[], pattern: string, alias: string): AliasRule[] {
  const existing = rules.findIndex((r) => r.pattern === pattern);
  if (existing === -1) return [...rules, { pattern, canonicalName: alias }];
  return rules.map((r, i) => (i === existing ? { pattern, canonicalName: alias } : r));
}

/** Throws the SyntaxError a pattern that JavaScript cannot compile raises. */
function checkPattern(pattern: string): void {
  new RegExp(pattern, "i");
}

export interface AliasPreview {
  /** Live transactions that would display as the alias. */
  matched: number;
  totalCents: number;
  /** The categories those rows resolve to today, with counts. */
  currentCategories: Record<string, number>;
  /**
   * The merchants being swept together, by today's name. An over-broad
   * pattern gives itself away here.
   */
  merchants: Record<string, number>;
  /** Set when the pattern does not compile. */
  error?: string;
}

const EMPTY: AliasPreview = { matched: 0, totalCents: 0, currentCategories: {}, merchants: {} };

/** preview_alias_change: what saving `pattern` -> `alias` would do. */
export async function previewAliasChange(db: Db, pattern: string, alias: string): Promise<AliasPreview> {
  if (!pattern) return EMPTY;
  try {
    checkPattern(pattern);
  } catch (error) {
    return { ...EMPTY, error: error instanceof Error ? error.message : String(error) };
  }

  const rows = await db
    .select({
      raw: transactions.merchantRaw,
      stored: merchants.canonicalName,
      count: sql<number>`COUNT(*)`.mapWith(Number),
      cents: sql<number>`SUM(${transactions.amountCents})`.mapWith(Number),
    })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(isNull(transactions.deletedAt))
    .groupBy(transactions.merchantRaw, merchants.canonicalName);
  if (rows.length === 0) return EMPTY;

  const rules = await loadAliasRules(db);
  const target = alias || PENDING_ALIAS;
  const before = compileAliases(rules);
  const after = compileAliases(withRule(rules, pattern, target));
  const edited = new RegExp(pattern, "i");

  const categoryOf = new Map(
    (await db
      .select({ merchant: merchants.canonicalName, category: categories.name })
      .from(merchants)
      .innerJoin(categories, eq(categories.id, merchants.categoryId)))
      .map((r) => [r.merchant, r.category]),
  );

  const preview: AliasPreview = { matched: 0, totalCents: 0, currentCategories: {}, merchants: {} };
  for (const row of rows) {
    // A row the pattern does not match skips that rule under either table,
    // so its name is its stored one both before and after. Only matches pay
    // for a full resolution: a Worker has milliseconds of CPU per request.
    const matches = edited.test(row.raw);
    const renamed = matches ? resolveMerchantName(row.raw, after) : row.stored;
    if (renamed !== target) continue;
    const today = (matches ? resolveMerchantName(row.raw, before) : row.stored) ?? row.raw;
    const category = categoryOf.get(today) ?? "Other";
    preview.matched += row.count;
    preview.totalCents += row.cents;
    preview.currentCategories[category] = (preview.currentCategories[category] ?? 0) + row.count;
    preview.merchants[today] = (preview.merchants[today] ?? 0) + row.count;
  }
  return preview;
}

export interface MerchantDecision {
  pattern: string;
  /** The canonical name matching rows will display as. */
  alias: string;
  /** Set on the alias's merchant. Omit to leave its category alone. */
  category?: string;
  /** Added to the live rows that display as the alias once saved. */
  tags?: string[];
}

export interface MerchantDecisionResult {
  /** Rows, live or deleted, now pointing at a different merchant. */
  repointed: number;
  /** Live rows under the alias the tags were added to; 0 with no tags. */
  tagged: number;
}

/**
 * Move every row `pattern` matches whose name `rulesAfter` changes, in one
 * atomic batch with `steps.before` ahead of the move and `steps.after` behind.
 *
 * Only rows the pattern matches can change name (see previewAliasChange). A
 * live row moving to another merchant needs an occurrence free at its new
 * identity, above every live row that stays put there; deleted rows keep
 * theirs. Returns how many rows moved.
 */
export async function repointRows(
  db: Db, rulesAfter: AliasRule[], pattern: string, steps: { before: SQL[]; after: SQL[] }, userId: number,
): Promise<number> {
  const table = compileAliases(rulesAfter);
  const rows = await db
    .select({
      id: transactions.id,
      raw: transactions.merchantRaw,
      merchant: merchants.canonicalName,
      date: transactions.date,
      cents: transactions.amountCents,
      occurrence: transactions.occurrence,
      deleted: sql<number>`${transactions.deletedAt} IS NOT NULL`.mapWith(Boolean),
    })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .orderBy(asc(transactions.id));

  const edited = new RegExp(pattern, "i");
  const moves = rows
    .filter((row) => edited.test(row.raw))
    .map((row) => ({ ...row, to: resolveMerchantName(row.raw, table) }))
    .filter((row) => row.to !== row.merchant);
  const movingIds = new Set(moves.map((m) => m.id));

  const keyOf = (date: number, merchant: string | null, cents: number) =>
    JSON.stringify([date, merchant, cents]);
  const next = new Map<string, number>();
  for (const row of rows) {
    if (row.deleted || movingIds.has(row.id)) continue;
    const key = keyOf(row.date, row.merchant, row.cents);
    next.set(key, Math.max(next.get(key) ?? 0, row.occurrence + 1));
  }
  const payload = JSON.stringify(moves.map((move) => {
    let occurrence = move.occurrence;
    if (!move.deleted) {
      const key = keyOf(move.date, move.to, move.cents);
      occurrence = next.get(key) ?? 0;
      next.set(key, occurrence + 1);
    }
    return { id: move.id, merchant: move.to, occurrence };
  }));
  const names = JSON.stringify([...new Set(moves.map((m) => m.to))]);

  await atomic(db, [
    ...steps.before,
    ...(moves.length ? [
      sql`INSERT OR IGNORE INTO merchants (canonical_name) SELECT value FROM json_each(${names})`,
      // Park the moving rows first. The unique index is checked row by row, so
      // a row arriving at an identity could otherwise meet one not yet gone.
      sql`
        UPDATE transactions SET occurrence = -id
        WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${payload}))
      `,
      // One join, not a subquery per row: correlated json_each is quadratic.
      sql`
        UPDATE transactions
        SET merchant_id = j.merchant_id, occurrence = j.occurrence,
            updated_at = unixepoch(), updated_by = ${userId}
        FROM (
          SELECT json_extract(e.value, '$.id') AS id, m.id AS merchant_id,
                 json_extract(e.value, '$.occurrence') AS occurrence
          FROM json_each(${payload}) e
          JOIN merchants m ON m.canonical_name = json_extract(e.value, '$.merchant')
        ) AS j
        WHERE transactions.id = j.id
      `,
    ] : []),
    ...steps.after,
  ]);
  return moves.length;
}

/**
 * apply_merchant_decision, saved: the rule, the alias's category, every
 * transaction whose name the new table changes, and the tags.
 *
 * The old merchant is left in place with its category, as the Python left the
 * old category key: another rule may still resolve to it.
 */
export async function saveMerchantDecision(
  db: Db, decision: MerchantDecision, userId: number,
): Promise<MerchantDecisionResult> {
  const { pattern, alias, category } = decision;
  if (!pattern.trim()) throw new Error("a merchant rule needs a pattern");
  if (!alias.trim()) throw new Error("a merchant rule needs an alias");
  checkPattern(pattern);
  const tags = normalizeTags(decision.tags ?? []);

  const rules = await loadAliasRules(db);
  const aliasId = sql`(SELECT id FROM merchants WHERE canonical_name = ${alias})`;
  const isNew = !rules.some((r) => r.pattern === pattern);
  const tagList = JSON.stringify(tags);

  const before: SQL[] = [
    sql`INSERT OR IGNORE INTO merchants (canonical_name) VALUES (${alias})`,
    ...(category ? [
      sql`INSERT OR IGNORE INTO categories (name) VALUES (${category})`,
      sql`
        UPDATE merchants
        SET category_id = (SELECT id FROM categories WHERE name = ${category}),
            category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
        WHERE canonical_name = ${alias}
      `,
    ] : []),
    isNew
      ? sql`
        INSERT INTO merchant_aliases (pattern, priority, merchant_id, created_by)
        VALUES (${pattern}, (SELECT COALESCE(MAX(priority), -1) + 1 FROM merchant_aliases), ${aliasId}, ${userId})
      `
      : sql`UPDATE merchant_aliases SET merchant_id = ${aliasId} WHERE pattern = ${pattern}`,
  ];
  // Runs after the move, so it sees the rows that just arrived at the alias.
  const after: SQL[] = tags.length ? [
    sql`INSERT OR IGNORE INTO tags (name) SELECT value FROM json_each(${tagList})`,
    sql`
      INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, tagged_by)
      SELECT t.id, g.id, ${userId}
      FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id AND m.canonical_name = ${alias}
      JOIN tags g ON g.name IN (SELECT value FROM json_each(${tagList}))
      WHERE t.deleted_at IS NULL
    `,
  ] : [];

  const repointed = await repointRows(db, withRule(rules, pattern, alias), pattern, { before, after }, userId);
  let tagged = 0;
  if (tags.length) {
    const [row] = await db
      .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(transactions)
      .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(and(eq(merchants.canonicalName, alias), isNull(transactions.deletedAt)));
    tagged = row.n;
  }
  return { repointed, tagged };
}

export class UnknownRuleError extends Error {
  constructor(id: number) {
    super(`There is no merchant rule ${id}`);
    this.name = "UnknownRuleError";
  }
}

/**
 * Drop one rule and re-point the rows it decided: to the next rule that
 * matches, or to their own normalised names. The merchant it pointed at stays,
 * with its category, since another rule may still resolve to it.
 */
export async function deleteMerchantRule(db: Db, ruleId: number, userId: number): Promise<{ repointed: number }> {
  const [rule] = await db.select({ pattern: merchantAliases.pattern })
    .from(merchantAliases).where(eq(merchantAliases.id, ruleId));
  if (!rule) throw new UnknownRuleError(ruleId);
  const drop = sql`DELETE FROM merchant_aliases WHERE id = ${ruleId}`;
  try {
    checkPattern(rule.pattern);
  } catch {
    // Stored patterns came from Python and may not compile here. Such a rule
    // never matched a row in JavaScript, so it decided none of them.
    await atomic(db, [drop]);
    return { repointed: 0 };
  }
  const rules = (await loadAliasRules(db)).filter((r) => r.pattern !== rule.pattern);
  const repointed = await repointRows(db, rules, rule.pattern, { before: [drop], after: [] }, userId);
  return { repointed };
}

/** The Merchants page's bulk assign. Null clears; a new name is created. */
export async function setMerchantCategory(
  db: Db, merchantIds: number[], category: string | null, userId: number,
): Promise<{ updated: number }> {
  const ids = [...new Set(merchantIds)];
  if (ids.length === 0) return { updated: 0 };
  const found = await db.select({ id: merchants.id }).from(merchants).where(inArray(merchants.id, ids));
  if (found.length === 0) return { updated: 0 };
  const name = category?.trim() || null;
  const idList = JSON.stringify(found.map((r) => r.id));
  await atomic(db, [
    ...(name ? [sql`INSERT OR IGNORE INTO categories (name) VALUES (${name})`] : []),
    sql`
      UPDATE merchants
      SET category_id = ${name ? sql`(SELECT id FROM categories WHERE name = ${name})` : sql`NULL`},
          category_suggested = 0, category_set_by = ${userId}, category_set_at = unixepoch()
      WHERE id IN (SELECT value FROM json_each(${idList}))
    `,
  ]);
  return { updated: found.length };
}
