/**
 * import_screen.py's row handling on a grid of text cells: find the header
 * below any summary rows, apply the column mapping, and parse or skip each
 * row with a reason, in _process_row's order. Held to the Python by
 * python_vectors.json ("import.scenarios"). Pure: the browser builds the
 * grid from a CSV or spreadsheet and shows the result before anything is
 * sent.
 */

import type { ImportMapping, ImportRequestRow } from "../api/import";
import { parseDate } from "./importDates";
import { parseAmountCents } from "./money";

export type SkipReason = "invalidDate" | "emptyMerchant" | "zeroAmount" | "notDebit" | "filtered";
export const SKIP_REASONS: SkipReason[] = ["invalidDate", "emptyMerchant", "zeroAmount", "notDebit", "filtered"];

export interface ParsedRow extends ImportRequestRow {
  /** 1-based, as a spreadsheet numbers rows. */
  line: number;
}

export interface ParsedImport {
  /** The header's names, spacer columns dropped. */
  header: string[];
  /** 0-based; -1 when no header was found. */
  headerRow: number;
  rows: ParsedRow[];
  /** Line numbers per reason. */
  skipped: Record<SkipReason, number[]>;
}

const PAYPAL_COLUMN = "Balance Impact";

const filled = (row: string[]) => row.filter((c) => c.trim() !== "").length;

/** Per cell: its trimmed name, null for a blank spacer; repeats get " (2)", " (3)". */
export function columnNames(row: string[]): (string | null)[] {
  const seen = new Map<string, number>();
  return row.map((cell) => {
    const name = cell.trim();
    if (name === "") return null;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

/** Every column name a mapping refers to. */
export function mappedColumns(mapping: Partial<ImportMapping>): string[] {
  return [mapping.date, mapping.merchant, mapping.amount, mapping.amountOut, mapping.filter?.column]
    .filter((c): c is string => typeof c === "string" && c !== "");
}

export function missingColumns(header: string[], mapping: Partial<ImportMapping>): string[] {
  const names = new Set(header);
  return mappedColumns(mapping).filter((c) => !names.has(c));
}

/**
 * The header row: pinned (when that row holds every mapped column, so a pin
 * the bank's layout has moved past is not trusted), else the first row holding
 * every mapped column, else the first with three or more filled cells (summary
 * rows above a bank's table have at most two). -1 when none.
 */
export function findHeaderRow(grid: string[][], mapping: Partial<ImportMapping> = {}): number {
  const wanted = mappedColumns(mapping);
  const hasAll = (row: string[]) => {
    const names = new Set(columnNames(row));
    return wanted.every((c) => names.has(c));
  };
  const pin = mapping.headerRow;
  if (pin !== undefined && pin < grid.length && hasAll(grid[pin])) return pin;
  if (wanted.length > 0) {
    const i = grid.findIndex(hasAll);
    if (i >= 0) return i;
  }
  return grid.findIndex((row) => filled(row) >= 3);
}

const emptySkips = (): Record<SkipReason, number[]> =>
  ({ invalidDate: [], emptyMerchant: [], zeroAmount: [], notDebit: [], filtered: [] });

type Amount = { amountCents: number; type: ImportRequestRow["type"] } | null;

/** _process_row's amount rules; null is a zero amount. */
function amountOf(cell: (name: string) => string, mapping: ImportMapping): Amount {
  if (mapping.amountOut) {
    const moneyIn = parseAmountCents(cell(mapping.amount));
    const moneyOut = parseAmountCents(cell(mapping.amountOut));
    if (moneyIn !== 0 && moneyOut !== 0) {
      return Math.abs(moneyIn) >= Math.abs(moneyOut)
        ? { amountCents: Math.abs(moneyIn), type: "income" }
        : { amountCents: Math.abs(moneyOut), type: "expense" };
    }
    if (moneyIn !== 0) return { amountCents: Math.abs(moneyIn), type: "income" };
    if (moneyOut !== 0) return { amountCents: Math.abs(moneyOut), type: "expense" };
    return null;
  }
  const cents = parseAmountCents(cell(mapping.amount));
  if (cents === 0) return null;
  const type = mapping.typeMode === "auto" ? (cents < 0 ? "expense" : "income") : mapping.typeMode;
  return { amountCents: Math.abs(cents), type };
}

export function processRows(grid: string[][], mapping: ImportMapping): ParsedImport {
  const skipped = emptySkips();
  const headerRow = findHeaderRow(grid, mapping);
  if (headerRow < 0) return { header: [], headerRow, rows: [], skipped };

  const names = columnNames(grid[headerRow]);
  const header = names.filter((n): n is string => n !== null);
  if (missingColumns(header, mapping).length > 0) return { header, headerRow, rows: [], skipped };

  const index = new Map(names.flatMap((n, i) => (n === null ? [] : [[n, i] as const])));
  const paypal = index.has(PAYPAL_COLUMN);
  const rows: ParsedRow[] = [];

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i];
    if (filled(row) === 0) continue;
    const line = i + 1;
    const cell = (name: string) => row[index.get(name) ?? -1] ?? "";

    const date = parseDate(cell(mapping.date), mapping.dateOrder);
    if (date === null) { skipped.invalidDate.push(line); continue; }
    const merchant = cell(mapping.merchant);
    if (merchant.trim() === "") { skipped.emptyMerchant.push(line); continue; }
    const amount = amountOf(cell, mapping);
    if (amount === null) { skipped.zeroAmount.push(line); continue; }
    if (!mapping.amountOut && mapping.typeMode === "auto" && paypal && cell(PAYPAL_COLUMN) !== "Debit") {
      skipped.notDebit.push(line);
      continue;
    }
    if (mapping.filter && mapping.filter.value.trim() !== ""
      && cell(mapping.filter.column).trim().toLowerCase() !== mapping.filter.value.trim().toLowerCase()) {
      skipped.filtered.push(line);
      continue;
    }
    rows.push({ line, date, merchant, ...amount });
  }
  return { header, headerRow, rows, skipped };
}

const COMMA_DECIMAL = [
  /^[^\d,.]*-?\(?\d{1,3}(?:\.\d{3})*,\d{1,2}\)?[^\d,.]*$/,
  /^[^\d,.]*-?\(?\d+,\d{1,2}\)?[^\d,.]*$/,
];

/**
 * The first amount cell written with a comma for decimals ("-12,50"), which
 * parseAmountCents (like the Python) would read as -1250.00; null when none.
 * "1,234" is a thousands separator and does not count.
 */
export function commaDecimalSample(grid: string[][], mapping: Partial<ImportMapping>): string | null {
  const headerRow = findHeaderRow(grid, mapping);
  if (headerRow < 0) return null;
  const names = columnNames(grid[headerRow]);
  const columns = [mapping.amount, mapping.amountOut]
    .flatMap((c) => (c ? [names.indexOf(c)] : []))
    .filter((i) => i >= 0);
  for (const row of grid.slice(headerRow + 1)) {
    for (const i of columns) {
      const text = (row[i] ?? "").trim();
      if (text !== "" && COMMA_DECIMAL.some((re) => re.test(text))) return text;
    }
  }
  return null;
}
