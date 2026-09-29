/**
 * Amount strings from a statement -> integer cents, exactly as the Python
 * import stored them.
 *
 * The Python pipeline was clean_amount() -> pandas .round(2) -> to_cents().
 * pandas rounds by multiplying by 100 and rounding half to even in binary
 * floating point, so "2.675" (267.5 after the multiply) became 268 while
 * "1.005" (100.49999...) became 100. Every amount in the database went through
 * that, so imports must too, or a re-imported row would miss its duplicate by a
 * cent. tools/crosscheck/vectors.py records the Python's answers; the tests
 * replay them.
 *
 * Only amounts with more than two decimals are affected. Statements have two.
 */

/** A plain decimal number, optionally signed, optionally with an exponent. */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * clean_amount: "(12.34)" is negative, currency symbols, thousands separators
 * and whitespace are ignored, and anything unparseable ("-", "", "abc") is 0.
 */
export function parseAmountCents(raw: string): number {
  const cleaned = raw
    .replace(/\((.*)\)/, "-$1")
    .replace(/[€$£,\s]/g, "");
  if (!NUMERIC.test(cleaned)) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  // `+ 0` turns -0 into 0.
  return roundHalfEven(value * 100) + 0;
}

/** "2026-08-12" -> unix seconds at UTC midnight, as transactions.date stores. */
export function epochDay(isoDate: string): number {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || Number.isNaN(ms)) {
    throw new RangeError(`not a YYYY-MM-DD date: ${isoDate}`);
  }
  return ms / 1000;
}
