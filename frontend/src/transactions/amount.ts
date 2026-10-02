import { formatCents } from "../lib/money";
import type { TransactionRow } from "../lib/types";

/** Income is "+" in green, an expense "−" (U+2212) in the normal colour. */
export function signedAmount(row: Pick<TransactionRow, "type" | "amountCents">): { text: string; className: string } {
  return row.type === "income"
    ? { text: `+${formatCents(row.amountCents)}`, className: "text-income" }
    : { text: `−${formatCents(row.amountCents)}`, className: "" };
}
