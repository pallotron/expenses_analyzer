import { sql } from "drizzle-orm";
import {
  sqliteTable, text, integer, primaryKey, index, uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Expense Analyzer — SQLite schema (Drizzle).
 *
 * Money is stored as INTEGER cents everywhere. The Python app used float64
 * rounded to 2dp and then compared amounts for equality during dedup; that is
 * a latent correctness bug that integer cents removes outright.
 *
 * Timestamps are stored as unix epoch seconds (integer) for cheap comparison.
 */

const now = sql`(unixepoch())`;

/* ------------------------------------------------------------------ users */

/**
 * Exactly two rows in practice. `email` is matched against the verified
 * Cloudflare Access JWT claim, never against a request header.
 *
 * `ownerKey` is the value that used to live in payslips.parquet's Owner
 * column ("self" for pre-multi-owner rows), so existing payslip data lines
 * up with a login without rewriting it.
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  ownerKey: text("owner_key").notNull().unique(),
  createdAt: integer("created_at").notNull().default(now),
});

/* ------------------------------------------------------------- categories */

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** categories.json had no type; category_types.json split them. Merged here. */
  spendingType: text("spending_type", { enum: ["essential", "discretionary"] }),
  /** From category_types.json — per-type annual budget, hoisted onto the type. */
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
});

/** category_types.json's `annual_budget`, which is per-type not per-category. */
export const spendingTypeBudgets = sqliteTable("spending_type_budgets", {
  spendingType: text("spending_type", { enum: ["essential", "discretionary"] })
    .primaryKey(),
  annualBudgetCents: integer("annual_budget_cents"),
});

/* -------------------------------------------------------------- merchants */

/**
 * The canonical merchant. `categories.json` was merchant -> category, so the
 * category assignment belongs here, not on the transaction. This is what makes
 * categorising one merchant apply to every transaction of theirs, past and
 * future — preserve it.
 */
export const merchants = sqliteTable("merchants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Normalised canonical name (normalize_merchant_name equivalent). */
  canonicalName: text("canonical_name").notNull().unique(),
  categoryId: integer("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  /** Set when Gemini proposed the category and nobody has confirmed it. */
  categorySuggested: integer("category_suggested", { mode: "boolean" })
    .notNull().default(false),
  categorySetBy: integer("category_set_by").references(() => users.id),
  categorySetAt: integer("category_set_at"),
});

/**
 * merchant_aliases.json. A pattern seen on a statement mapping to a canonical
 * merchant, e.g. "STARBUCKS #1234" -> "Starbucks".
 */
export const merchantAliases = sqliteTable("merchant_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** A regex, matched case-insensitively against the raw merchant string. */
  pattern: text("pattern").notNull().unique(),
  /**
   * Evaluation order. apply_merchant_alias() walked the JSON dict and took the
   * FIRST pattern that matched, so insertion order was load-bearing; a plain
   * table has no order and would silently change which alias wins.
   */
  priority: integer("priority").notNull().default(0),
  merchantId: integer("merchant_id").notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => [index("merchant_aliases_merchant_idx").on(t.merchantId)]);

/* ----------------------------------------------------------- transactions */

export const transactions = sqliteTable("transactions", {
  /**
   * A real surrogate key. The Python app used the DataFrame's positional index
   * as TransactionID, which shifted whenever rows were dropped — the root of
   * the soft-delete alias collision. This fixes it structurally.
   */
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Date only, stored as unix epoch seconds at UTC midnight. */
  date: integer("date").notNull(),

  /** Exactly as it appeared on the statement. Never overwritten by aliasing. */
  merchantRaw: text("merchant_raw").notNull(),
  /** Resolved through merchant_aliases at import; nullable until resolved. */
  merchantId: integer("merchant_id").references(() => merchants.id),

  amountCents: integer("amount_cents").notNull(),
  type: text("type", { enum: ["expense", "income"] }).notNull().default("expense"),
  source: text("source").notNull().default("Manual"),

  /**
   * Per-transaction category override. Null means "inherit from the merchant",
   * which is the old behaviour and the common case. The override exists so one
   * Amazon order can be Groceries while the rest stay Shopping — impossible in
   * the parquet model.
   */
  categoryOverrideId: integer("category_override_id").references(() => categories.id),

  /**
   * Provider's own transaction id (TrueLayer). When present this is an exact
   * dedup key and the (date, merchant, amount, occurrence) heuristic below is
   * not consulted at all.
   */
  externalId: text("external_id"),

  /**
   * Nth identical (date, merchant, amount) tuple, for CSV imports with no
   * external id. Two coffees on the same day get occurrence 0 and 1 and both
   * survive; a re-import of the same file collides and is rejected.
   */
  occurrence: integer("occurrence").notNull().default(0),

  importBatchId: integer("import_batch_id").references(() => importBatches.id),

  /** Soft delete: timestamp + actor, replacing the bare Deleted boolean. */
  deletedAt: integer("deleted_at"),
  deletedBy: integer("deleted_by").references(() => users.id),

  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at").notNull().default(now),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull().default(now),
}, (t) => [
  /* Exact dedup for provider-sourced rows. */
  uniqueIndex("transactions_external_id_idx").on(t.externalId)
    .where(sql`${t.externalId} IS NOT NULL`),

  /* Heuristic dedup for CSV rows, keyed on the resolved merchant. */
  uniqueIndex("transactions_dedupe_idx")
    .on(t.date, t.merchantId, t.amountCents, t.occurrence)
    .where(sql`${t.externalId} IS NULL AND ${t.deletedAt} IS NULL`),

  index("transactions_date_idx").on(t.date),
  index("transactions_merchant_idx").on(t.merchantId),
  index("transactions_live_idx").on(t.deletedAt, t.date),
]);

/**
 * One row per import run, so an import can be reviewed or undone wholesale.
 * The Python app had no equivalent — it relied on file backups.
 */
export const importBatches = sqliteTable("import_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  filename: text("filename"),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  importedBy: integer("imported_by").notNull().references(() => users.id),
  importedAt: integer("imported_at").notNull().default(now),
});

/* ------------------------------------------------------------------- tags */

/** Was a comma-separated lowercase string in a parquet column. */
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const transactionTags = sqliteTable("transaction_tags", {
  transactionId: integer("transaction_id").notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  taggedBy: integer("tagged_by").references(() => users.id),
  taggedAt: integer("tagged_at").notNull().default(now),
}, (t) => [
  primaryKey({ columns: [t.transactionId, t.tagId] }),
  index("transaction_tags_tag_idx").on(t.tagId),
]);

/**
 * tag_settings.json's exclude_from_summary. Stays a pattern list rather than a
 * boolean on `tags` because entries may end in `*` for prefix matching
 * (e.g. "travel:*"), which must keep matching tags created later.
 */
export const tagExclusionPatterns = sqliteTable("tag_exclusion_patterns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pattern: text("pattern").notNull().unique(),
});

/* --------------------------------------------------------------- payslips */

/** Keyed on (user, month) — the old (Owner, Month) pair. */
export const payslips = sqliteTable("payslips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  /** "YYYY-MM". */
  month: text("month").notNull(),

  grossCents: integer("gross_cents").notNull(),
  netCents: integer("net_cents").notNull(),
  taxTotalCents: integer("tax_total_cents").notNull(),
  pensionEeCents: integer("pension_ee_cents").notNull().default(0),
  avcCents: integer("avc_cents").notNull().default(0),
  pensionErCents: integer("pension_er_cents").notNull().default(0),
  bonusCents: integer("bonus_cents").notNull().default(0),
  onCallCents: integer("on_call_cents").notNull().default(0),

  /** JSON array of the source PDF filenames this month was aggregated from. */
  sourceFiles: text("source_files", { mode: "json" }).$type<string[]>()
    // Single quotes deliberately: inside SQL, "[]" is a double-quoted
    // identifier that only means the string "[]" via SQLite's legacy fallback.
    .notNull().default(sql`'[]'`),
  ytdReconciled: integer("ytd_reconciled", { mode: "boolean" }),
  netReconciled: integer("net_reconciled", { mode: "boolean" }),

  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
}, (t) => [uniqueIndex("payslips_owner_month_idx").on(t.userId, t.month)]);

/*
 * NOTE: there is deliberately no payslip_folders table.
 *
 * payslip_settings.json stored host paths for the scanner to walk. A Worker
 * has no filesystem, so a stored path would point at nothing. Payslips arrive
 * through the browser instead, and the Dropbox folder stays the place the PDFs
 * live rather than something the server reads.
 *
 * payslips.source_files still records which PDF each month came from, so
 * re-adding a file is recognised as the same month.
 */

/* ------------------------------------------------------- bank connections */

/**
 * truelayer_connections.json. Tokens were in a 0600 file; in a served app they
 * want encrypting at rest with a key held outside the database.
 */
export const bankConnections = sqliteTable("bank_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: text("connection_id").notNull().unique(),
  provider: text("provider").notNull().default("truelayer"),
  providerName: text("provider_name").notNull(),

  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  tokenExpiresAt: integer("token_expires_at"),

  /** Who linked it — both of you may link your own accounts. */
  linkedBy: integer("linked_by").notNull().references(() => users.id),
  lastSync: integer("last_sync"),
  createdAt: integer("created_at").notNull().default(now),
});

/* --------------------------------------------------------------- settings */

/** Small key/value bag for the leftovers that don't deserve a table. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull().default(now),
});
