/** The import page and its routes. Shared with the frontend. */

import type { DateOrder } from "../domain/importDates";
import type { TransactionType } from "./transactions";

/** Which columns hold what, by header name. Remembered per source. */
export interface ImportMapping {
  date: string;
  merchant: string;
  /** Signed amounts, or money in when `amountOut` is set. */
  amount: string;
  /** Money out, for exports with separate in/out columns. */
  amountOut?: string;
  /** Ignored when `amountOut` is set, as in the TUI. */
  typeMode: "auto" | "expense" | "income";
  dateOrder: DateOrder;
  /** Pinned header row, 0-based. Absent: found from the column names. */
  headerRow?: number;
  /** Only rows whose `column` equals `value`, ignoring case and spaces. */
  filter?: { column: string; value: string };
}

export interface ImportRequestRow {
  /** YYYY-MM-DD. */
  date: string;
  merchant: string;
  /** Positive; the sign is `type`. */
  amountCents: number;
  type: TransactionType;
}

/** `dryRun`: answer with the counts the import would give, writing nothing. */
export interface ImportRequest { source: string; filename?: string; mapping: ImportMapping; rows: ImportRequestRow[]; dryRun?: boolean }
/** `batchId` is null for a dry run. */
export interface ImportResponse { batchId: number | null; inserted: number; duplicates: number; suppressedDeleted: number; newMerchants: string[] }
export interface ImportMappingsResponse { mappings: Record<string, ImportMapping> }

/** A source the import page offers: its saved mapping, and where its rows stop. */
export interface ImportSource {
  name: string;
  /** YYYY-MM-DD of its latest live transaction; null when it has none. */
  lastDate: string | null;
  mapping: ImportMapping | null;
}
export interface ImportSourcesResponse { sources: ImportSource[] }

/** D1 takes the rows as one JSON value, capped near 2 MB; 5,000 rows is about 600 KB. */
export const MAX_IMPORT_ROWS = 5_000;
