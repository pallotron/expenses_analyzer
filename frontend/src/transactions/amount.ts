import { formatCents } from "../lib/money";
import type { TransactionRow } from "../lib/types";

/** Income is "+" in green, an expense "−" (U+2212) in the normal colour. */
export function signedAmount(row: Pick<TransactionRow, "type" | "amountCents">): { text: string; className: string } {
  return row.type === "income"
    ? { text: `+${formatCents(row.amountCents)}`, className: "text-income" }
    : { text: `−${formatCents(row.amountCents)}`, className: "" };
}

/**
 * What a person types as an amount, in cents: "12,50", "12.5", "€1,234.56"
 * or "1.234,56". The last "." or "," with one or two digits after it is the
 * decimal point; other separators group thousands. Zero, negatives and
 * three decimals ("1.234": a grouping or a decimal?) are refused.
 */
export function parseEuros(text: string): number | null {
  const t = text.replace(/[€\s]/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  let whole = t;
  let fraction = "";
  if (last >= 0) {
    const after = t.slice(last + 1);
    // A lone separator before exactly three digits is ambiguous, so the person retypes it.
    if (after.length === 3 && !/[.,]/.test(t.slice(0, last))) return null;
    if (after.length >= 1 && after.length <= 2) {
      whole = t.slice(0, last);
      fraction = after;
    }
  }
  // What is left must be plain digits or digits grouped in threes with one kind of separator.
  if (!/^\d+$/.test(whole) && !/^\d{1,3}(?:([.,])\d{3})+$/.test(whole)) return null;
  const grouping: string[] = whole.match(/[.,]/g) ?? [];
  if (new Set(grouping).size > 1) return null;
  if (fraction && grouping.includes(t[last])) return null;
  const cents = Number(whole.replace(/[.,]/g, "")) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
