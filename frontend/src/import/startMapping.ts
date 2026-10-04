import { missingColumns, type ImportMapping } from "../lib/types";

const find = (header: string[], pattern: RegExp) => header.find((h) => pattern.test(h)) ?? "";

/** A first guess for a source with no saved mapping; blanks where nothing fits. */
export function guessMapping(header: string[]): ImportMapping {
  const moneyIn = find(header, /money in|paid in|credit/i);
  const moneyOut = find(header, /money out|paid out|debit/i);
  const twoColumns = moneyIn !== "" && moneyOut !== "";
  return {
    date: find(header, /date/i),
    merchant: find(header, /description|merchant|payee|name|details/i),
    amount: twoColumns ? moneyIn : find(header, /^amount$|amount/i),
    ...(twoColumns && { amountOut: moneyOut }),
    typeMode: "auto",
    dateOrder: "dmy",
  };
}

/**
 * Where the mapping form starts for this file: the saved mapping when every
 * column it names is in the header; otherwise a guess, overridden by whatever
 * of the saved mapping still matches, with the missing columns named.
 */
export function startMapping(header: string[], saved?: ImportMapping) {
  if (!saved) return { mapping: guessMapping(header), fits: false, missing: [] as string[] };
  const missing = missingColumns(header, saved);
  if (missing.length === 0) return { mapping: saved, fits: true, missing };
  const names = new Set(header);
  const keep = <K extends "date" | "merchant" | "amount" | "amountOut">(k: K) =>
    saved[k] !== undefined && names.has(saved[k] as string) ? { [k]: saved[k] } : {};
  return {
    mapping: {
      ...guessMapping(header),
      typeMode: saved.typeMode,
      dateOrder: saved.dateOrder,
      ...keep("date"), ...keep("merchant"), ...keep("amount"), ...keep("amountOut"),
      ...(saved.filter && names.has(saved.filter.column) && { filter: saved.filter }),
    } as ImportMapping,
    fits: false,
    missing,
  };
}
