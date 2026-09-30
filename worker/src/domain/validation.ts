/**
 * What an import must pass before anything is written: validation.py's
 * validate_transaction_dataframe, with the same limits and the same messages.
 *
 * Rows arrive typed, so the Python's column and dtype checks become per-value
 * checks: a date must be a real YYYY-MM-DD calendar day, the merchant must not
 * be blank, |amount| is at most 1,000,000.00, and a type, if given, is expense
 * or income in any case.
 */

export class ValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Validation failed with ${errors.length} error(s)`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export interface ValidatableRow {
  date: string;
  merchant: string;
  amountCents: number;
  type?: string;
}

export interface ValidationLimits {
  /** Inclusive, YYYY-MM-DD. Default 1900-01-01. */
  minDate?: string;
  /** Inclusive, YYYY-MM-DD. Default a year from today. */
  maxDate?: string;
}

const MAX_ABS_CENTS = 100_000_000;
const TYPES = new Set(["expense", "income"]);

/** A real calendar day: 2026-02-30 is not one, though Date.parse rolls it over. */
function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function aYearFromToday(): string {
  const now = new Date();
  now.setUTCFullYear(now.getUTCFullYear() + 1);
  return now.toISOString().slice(0, 10);
}

/** Every problem found, in the Python's order and wording. Empty means valid. */
export function validateImportRows(rows: ValidatableRow[], limits: ValidationLimits = {}): string[] {
  const minDate = limits.minDate ?? "1900-01-01";
  const maxDate = limits.maxDate ?? aYearFromToday();
  const errors: string[] = [];
  if (rows.length === 0) return errors;

  const valid = rows.filter((r) => isCalendarDate(r.date));
  const invalidDates = rows.length - valid.length;
  if (invalidDates) {
    errors.push(`Found ${invalidDates} row(s) with invalid dates that cannot be parsed`);
  }
  const tooOld = valid.filter((r) => r.date < minDate).length;
  const tooNew = valid.filter((r) => r.date > maxDate).length;
  if (tooOld) errors.push(`Found ${tooOld} date(s) before minimum allowed date ${minDate}`);
  if (tooNew) errors.push(`Found ${tooNew} date(s) after maximum allowed date ${maxDate}`);

  const blank = rows.filter((r) => !r.merchant || !r.merchant.trim()).length;
  if (blank) errors.push(`Found ${blank} row(s) with empty or missing merchant names`);

  const notNumbers = rows.filter((r) => !Number.isFinite(r.amountCents)).length;
  if (notNumbers) errors.push(`Found ${notNumbers} row(s) with non-numeric amounts`);
  const tooLarge = rows.filter((r) => Math.abs(r.amountCents) > MAX_ABS_CENTS).length;
  if (tooLarge) {
    errors.push(`Found ${tooLarge} row(s) with amounts (absolute value) exceeding 1,000,000.00`);
  }

  // The Python reported a second, column-level error whenever any date failed.
  if (invalidDates) errors.push("Date column cannot be converted to datetime type");

  const badTypes = rows.filter((r) => r.type !== undefined && !TYPES.has(r.type.toLowerCase()));
  if (badTypes.length) {
    const shown = [...new Set(badTypes.map((r) => r.type))].slice(0, 5).map((t) => `'${t}'`);
    errors.push(
      `Found ${badTypes.length} row(s) with invalid Type values. `
      + `Must be 'expense' or 'income'. Invalid values: [${shown.join(", ")}]`,
    );
  }
  return errors;
}
