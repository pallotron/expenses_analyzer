/**
 * Writing transactions: data_handler.py's append_transactions, the soft
 * delete/restore pair, tagging and editing.
 *
 * Import semantics are the Python's, and tools/crosscheck/vectors.py holds the
 * Python's answers for the tests to replay:
 *
 * - A row's identity is (date, canonical merchant, amount). Type and source do
 *   not count: the same purchase seen by two feeds is one purchase.
 * - Identical rows are counted, not collapsed. Two coffees on one day are two
 *   transactions; importing the same file twice adds nothing; a third copy in
 *   a later file is a third coffee.
 * - A soft-deleted row absorbs exactly one re-imported copy, so deleting a
 *   transaction sticks, while deleting one of two twins leaves the other
 *   importable.
 *
 * Unlike the Python, delete, restore and edit act on ids. The Python matched on
 * (date, merchant, amount) and so hit every identical twin at once.
 *
 * `occurrence` exists for the unique index over live rows; its value only has
 * to be free. Which copies are duplicates is decided by counting, as above.
 *
 * Every write goes through atomic(): an import, delete or edit lands whole or
 * not at all. Row sets travel as one JSON parameter unpacked with json_each,
 * so an import is a handful of statements however many rows it has. D1 caps
 * both parameters per statement and statements per request.
 */

import {
  and, asc, eq, gte, isNotNull, isNull, lte, sql, type SQL,
} from "drizzle-orm";
import { atomic } from "../db/atomic";
import {
  importBatches, merchantAliases, merchants, transactions,
} from "../db/schema";
import type { Db } from "../db/types";
import {
  compileAliases, resolveMerchantName, type AliasRule, type CompiledAlias,
} from "../domain/merchants";
import { epochDay } from "../domain/money";
import { normalizeTags } from "../domain/tags";
import { validateImportRows, ValidationError, type ValidationLimits } from "../domain/validation";

export type TransactionType = "expense" | "income";

export interface ImportRow {
  /** YYYY-MM-DD. */
  date: string;
  /** As it appears on the statement. */
  merchant: string;
  amountCents: number;
  type?: TransactionType;
  tags?: string[];
}

export interface ImportOptions {
  source: string;
  userId: number;
  filename?: string;
  /** Override the date limits; tests pin them. */
  limits?: ValidationLimits;
}

export interface ImportResult {
  batchId: number;
  inserted: number;
  /** Already present: the same purchase imported before. */
  duplicates: number;
  /** Re-imports of rows someone deleted. */
  suppressedDeleted: number;
  /** Canonical names that had no merchant yet, so have no category. */
  newMerchants: string[];
}

/** Keeps a key readable in errors and cheap as a Map key. */
const keyOf = (date: number, merchant: string, cents: number) =>
  JSON.stringify([date, merchant, cents]);

const json = (value: unknown) => JSON.stringify(value);
const now = sql`unixepoch()`;

/** Alias rules in priority order: the order they are tried in. */
export async function loadAliasRules(db: Db): Promise<AliasRule[]> {
  return db
    .select({ pattern: merchantAliases.pattern, canonicalName: merchants.canonicalName })
    .from(merchantAliases)
    .innerJoin(merchants, eq(merchants.id, merchantAliases.merchantId))
    .orderBy(asc(merchantAliases.priority), asc(merchantAliases.id));
}

/** Aliases in priority order, compiled. First match wins. */
export async function loadAliases(db: Db): Promise<CompiledAlias[]> {
  const rules = await loadAliasRules(db);
  return compileAliases(rules, (pattern, error) =>
    console.warn(`skipping merchant alias ${JSON.stringify(pattern)}: ${String(error)}`));
}

interface KeyState {
  live: number;
  deleted: number;
  maxOccurrence: number;
}

/** Live/deleted counts and the highest live occurrence for every key in range. */
async function keyStates(db: Db, from: number, to: number): Promise<Map<string, KeyState>> {
  const rows = await db
    .select({
      date: transactions.date,
      merchant: merchants.canonicalName,
      cents: transactions.amountCents,
      occurrence: transactions.occurrence,
      deleted: sql<number>`${transactions.deletedAt} IS NOT NULL`.mapWith(Boolean),
    })
    .from(transactions)
    .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(and(gte(transactions.date, from), lte(transactions.date, to)));

  const states = new Map<string, KeyState>();
  for (const row of rows) {
    const key = keyOf(row.date, row.merchant, row.cents);
    const state = states.get(key) ?? { live: 0, deleted: 0, maxOccurrence: -1 };
    if (row.deleted) {
      state.deleted += 1;
    } else {
      state.live += 1;
      state.maxOccurrence = Math.max(state.maxOccurrence, row.occurrence);
    }
    states.set(key, state);
  }
  return states;
}

async function existingMerchantNames(db: Db, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const rows = await db
    .select({ name: merchants.canonicalName })
    .from(merchants)
    .where(sql`${merchants.canonicalName} IN (SELECT value FROM json_each(${json(names)}))`);
  return new Set(rows.map((r) => r.name));
}

/** INSERT OR IGNORE the named merchants, uncategorised. */
function createMerchants(names: string[]): SQL[] {
  if (names.length === 0) return [];
  return [sql`
    INSERT OR IGNORE INTO merchants (canonical_name)
    SELECT value FROM json_each(${json(names)})
  `];
}

/** Attach tags to rows found by their live identity (date, merchant, cents, occurrence). */
function attachTags(
  links: { date: number; merchant: string; cents: number; occurrence: number; tag: string }[],
  userId: number,
): SQL[] {
  if (links.length === 0) return [];
  const payload = json(links);
  return [
    sql`
      INSERT OR IGNORE INTO tags (name)
      SELECT DISTINCT json_extract(value, '$.tag') FROM json_each(${payload})
    `,
    sql`
      INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, tagged_by)
      SELECT t.id, g.id, ${userId}
      FROM json_each(${payload}) j
      JOIN merchants m ON m.canonical_name = json_extract(j.value, '$.merchant')
      JOIN transactions t
        ON t.merchant_id = m.id
       AND t.date = json_extract(j.value, '$.date')
       AND t.amount_cents = json_extract(j.value, '$.cents')
       AND t.occurrence = json_extract(j.value, '$.occurrence')
       AND t.deleted_at IS NULL
      JOIN tags g ON g.name = json_extract(j.value, '$.tag')
    `,
  ];
}


/**
 * append_transactions. Throws ValidationError, writing nothing, if any row
 * fails validate_transaction_dataframe's checks.
 */
export async function importTransactions(
  db: Db,
  rows: ImportRow[],
  options: ImportOptions,
): Promise<ImportResult> {
  const errors = validateImportRows(rows, options.limits);
  if (errors.length) throw new ValidationError(errors);

  const aliases = await loadAliases(db);
  const resolved = rows.map((row) => ({
    ...row,
    epoch: epochDay(row.date),
    canonical: resolveMerchantName(row.merchant, aliases),
    type: (row.type?.toLowerCase() ?? "expense") as TransactionType,
    tags: normalizeTags(row.tags ?? []),
  }));

  const epochs = resolved.map((r) => r.epoch);
  const states = resolved.length
    ? await keyStates(db, Math.min(...epochs), Math.max(...epochs))
    : new Map<string, KeyState>();

  // Walk the incoming rows in order, as the Python's cumcount did: per key the
  // first `deleted` copies are absorbed by deletions, the next `live` copies
  // are rows already present, and anything beyond is new.
  const seen = new Map<string, number>();
  const toInsert: (typeof resolved[number] & { occurrence: number })[] = [];
  let duplicates = 0;
  let suppressedDeleted = 0;
  for (const row of resolved) {
    const key = keyOf(row.epoch, row.canonical, row.amountCents);
    const state = states.get(key) ?? { live: 0, deleted: 0, maxOccurrence: -1 };
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);

    if (index < state.deleted) {
      suppressedDeleted += 1;
    } else if (index - state.deleted < state.live) {
      duplicates += 1;
    } else {
      const extra = index - state.deleted - state.live;
      toInsert.push({ ...row, occurrence: state.maxOccurrence + 1 + extra });
    }
  }

  const names = [...new Set(toInsert.map((r) => r.canonical))];
  const known = await existingMerchantNames(db, names);
  const newMerchants = names.filter((n) => !known.has(n)).sort();

  // Created outside the atomic write because the rows reference its id. If that
  // write fails, what remains is an empty batch recording zero rows.
  const [batch] = await db
    .insert(importBatches)
    .values({ source: options.source, filename: options.filename, importedBy: options.userId })
    .returning({ id: importBatches.id });

  const payload = json(toInsert.map((r) => ({
    date: r.epoch, raw: r.merchant, merchant: r.canonical,
    cents: r.amountCents, type: r.type, occurrence: r.occurrence,
  })));

  await atomic(db, [
    ...createMerchants(newMerchants),
    ...(toInsert.length ? [sql`
      INSERT INTO transactions
        (date, merchant_raw, merchant_id, amount_cents, type, source, occurrence,
         import_batch_id, created_by, updated_by)
      SELECT
        json_extract(j.value, '$.date'),
        json_extract(j.value, '$.raw'),
        m.id,
        json_extract(j.value, '$.cents'),
        json_extract(j.value, '$.type'),
        ${options.source},
        json_extract(j.value, '$.occurrence'),
        ${batch.id}, ${options.userId}, ${options.userId}
      FROM json_each(${payload}) j
      JOIN merchants m ON m.canonical_name = json_extract(j.value, '$.merchant')
    `] : []),
    ...attachTags(
      toInsert.flatMap((r) => r.tags.map((tag) => ({
        date: r.epoch, merchant: r.canonical, cents: r.amountCents, occurrence: r.occurrence, tag,
      }))),
      options.userId,
    ),
    sql`
      UPDATE import_batches
      SET rows_inserted = ${toInsert.length}, rows_skipped = ${duplicates + suppressedDeleted}
      WHERE id = ${batch.id}
    `,
  ]);

  return {
    batchId: batch.id,
    inserted: toInsert.length,
    duplicates,
    suppressedDeleted,
    newMerchants,
  };
}

const idsIn = (ids: number[]) =>
  sql`${transactions.id} IN (SELECT value FROM json_each(${json(ids)}))`;

/** Soft-delete by id. Returns how many were live and are now deleted. */
export async function softDeleteTransactions(
  db: Db, ids: number[], userId: number,
): Promise<number> {
  if (ids.length === 0) return 0;
  const live = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(idsIn(ids), isNull(transactions.deletedAt)));
  if (live.length === 0) return 0;

  await atomic(db, [sql`
    UPDATE transactions
    SET deleted_at = ${now}, deleted_by = ${userId}, updated_at = ${now}, updated_by = ${userId}
    WHERE id IN (SELECT value FROM json_each(${json(live.map((r) => r.id))}))
      AND deleted_at IS NULL
  `]);
  return live.length;
}

/**
 * Give each (key -> rows) placement an occurrence free among live rows,
 * counting the ones already placed in this call.
 */
async function freeOccurrences(
  db: Db,
  placements: { id: number; date: number; merchantId: number; cents: number }[],
): Promise<Map<number, number>> {
  const assigned = new Map<number, number>();
  if (placements.length === 0) return assigned;

  const keys = placements.map((p) => ({ date: p.date, merchant: p.merchantId, cents: p.cents }));
  const taken = await db
    .select({
      date: transactions.date,
      merchantId: transactions.merchantId,
      cents: transactions.amountCents,
      max: sql<number>`MAX(${transactions.occurrence})`.mapWith(Number),
    })
    .from(transactions)
    .where(and(
      isNull(transactions.deletedAt),
      sql`(${transactions.date}, ${transactions.merchantId}, ${transactions.amountCents}) IN (
        SELECT json_extract(value, '$.date'), json_extract(value, '$.merchant'),
               json_extract(value, '$.cents')
        FROM json_each(${json(keys)})
      )`,
      sql`${transactions.id} NOT IN (SELECT value FROM json_each(${json(placements.map((p) => p.id))}))`,
    ))
    .groupBy(transactions.date, transactions.merchantId, transactions.amountCents);

  const next = new Map<string, number>();
  for (const t of taken) next.set(JSON.stringify([t.date, t.merchantId, t.cents]), t.max + 1);
  for (const p of placements) {
    const key = JSON.stringify([p.date, p.merchantId, p.cents]);
    const occurrence = next.get(key) ?? 0;
    assigned.set(p.id, occurrence);
    next.set(key, occurrence + 1);
  }
  return assigned;
}

/**
 * Undo a soft delete by id. A restored row may meet a live twin that took its
 * occurrence in the meantime, so each gets a free one.
 */
export async function restoreTransactions(
  db: Db, ids: number[], userId: number,
): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      merchantId: transactions.merchantId,
      cents: transactions.amountCents,
    })
    .from(transactions)
    .where(and(idsIn(ids), isNotNull(transactions.deletedAt)));
  if (deleted.length === 0) return 0;

  const occurrences = await freeOccurrences(db, deleted.map((r) => ({
    id: r.id, date: r.date, merchantId: r.merchantId ?? -1, cents: r.cents,
  })));
  const payload = json([...occurrences].map(([id, occurrence]) => ({ id, occurrence })));

  await atomic(db, [sql`
    UPDATE transactions
    SET deleted_at = NULL, deleted_by = NULL,
        occurrence = (
          SELECT json_extract(value, '$.occurrence') FROM json_each(${payload})
          WHERE json_extract(value, '$.id') = transactions.id
        ),
        updated_at = ${now}, updated_by = ${userId}
    WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${payload}))
  `]);
  return deleted.length;
}

/**
 * tag_transactions: add or remove tags on transactions by id, live or deleted.
 * Returns how many of the ids exist. Tags that normalise to nothing are
 * ignored, and nothing at all happens if none are left.
 */
export async function tagTransactions(
  db: Db, ids: number[], tags: string[], mode: "add" | "remove", userId: number,
): Promise<number> {
  const clean = normalizeTags(tags);
  if (clean.length === 0 || ids.length === 0) return 0;

  const found = await db.select({ id: transactions.id }).from(transactions).where(idsIn(ids));
  if (found.length === 0) return 0;
  const idList = json(found.map((r) => r.id));
  const tagList = json(clean);

  if (mode === "add") {
    await atomic(db, [
      sql`INSERT OR IGNORE INTO tags (name) SELECT value FROM json_each(${tagList})`,
      sql`
        INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, tagged_by)
        SELECT i.value, g.id, ${userId}
        FROM json_each(${idList}) i
        JOIN tags g ON g.name IN (SELECT value FROM json_each(${tagList}))
      `,
    ]);
  } else {
    await atomic(db, [sql`
      DELETE FROM transaction_tags
      WHERE transaction_id IN (SELECT value FROM json_each(${idList}))
        AND tag_id IN (SELECT id FROM tags WHERE name IN (SELECT value FROM json_each(${tagList})))
    `]);
  }
  return found.length;
}

export interface TransactionEdit {
  date?: string;
  /** Raw statement text; the merchant is re-resolved through the aliases. */
  merchant?: string;
  amountCents?: number;
  type?: TransactionType;
  source?: string;
}

/**
 * update_single_transaction, by id. Changing date, merchant or amount moves
 * the row to another identity, so a live row gets an occurrence free there.
 * Returns false if there is no such transaction.
 */
export async function updateTransaction(
  db: Db, id: number, edit: TransactionEdit, userId: number,
): Promise<boolean> {
  const [current] = await db
    .select({
      date: transactions.date,
      merchantRaw: transactions.merchantRaw,
      merchantId: transactions.merchantId,
      cents: transactions.amountCents,
      type: transactions.type,
      source: transactions.source,
      deleted: sql<number>`${transactions.deletedAt} IS NOT NULL`.mapWith(Boolean),
    })
    .from(transactions)
    .where(eq(transactions.id, id));
  if (!current) return false;

  const date = edit.date !== undefined ? epochDay(edit.date) : current.date;
  const merchantRaw = edit.merchant ?? current.merchantRaw;
  const cents = edit.amountCents ?? current.cents;
  const type = edit.type ?? current.type;
  const source = edit.source ?? current.source;

  let canonical: string | null = null;
  const statements: SQL[] = [];
  if (edit.merchant !== undefined) {
    canonical = resolveMerchantName(merchantRaw, await loadAliases(db));
    statements.push(...createMerchants([canonical]));
  }

  const merchantSql = canonical !== null
    ? sql`(SELECT id FROM merchants WHERE canonical_name = ${canonical})`
    : sql`${current.merchantId}`;

  // The occurrence has to be free at the row's new identity. The merchant may
  // not exist yet, so look it up by name: a new merchant has no rows to clash.
  let occurrence: SQL = sql`occurrence`;
  const moved = date !== current.date || cents !== current.cents || canonical !== null;
  if (moved && !current.deleted) {
    const [target] = canonical !== null
      ? await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.canonicalName, canonical))
      : [{ id: current.merchantId ?? -1 }];
    const free = target
      ? (await freeOccurrences(db, [{ id, date, merchantId: target.id, cents }])).get(id) ?? 0
      : 0;
    occurrence = sql`${free}`;
  }

  statements.push(sql`
    UPDATE transactions
    SET date = ${date}, merchant_raw = ${merchantRaw}, merchant_id = ${merchantSql},
        amount_cents = ${cents}, type = ${type}, source = ${source},
        occurrence = ${occurrence}, updated_at = ${now}, updated_by = ${userId}
    WHERE id = ${id}
  `);
  await atomic(db, statements);
  return true;
}
