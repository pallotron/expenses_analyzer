import { describe, expect, it } from "vitest";
import { suggestPattern } from "../../lib/suggestPattern";

// Hand-written. The Python escaped "." before "\" and so doubled the backslash
// ("SHOP\\.EXAMPLE"), which never matched the name it came from.
const CASES: [string, string][] = [
  ["POS SHOP.EXAMPLE/BI 02/08 1", "POS\\s+SHOP\\.EXAMPLE/BI.*"],
  ["CORNER SHOP  12/31", "CORNER\\s+SHOP.*"],
  ["ACME (UK) LTD 1234", "ACME\\s+\\(UK\\)\\s+LTD.*"],
  ["PAY*COFFEE+CO", "PAY\\*COFFEE\\+CO.*"],
  ["Plain", "Plain.*"],
  ["BACKSLASH\\NAME 07/07 99", "BACKSLASH\\\\NAME.*"],
  ["TRAILING.*", "TRAILING\\.\\*.*"],
  ["A 12/31 B", "A.*"],
  ["SHOP 12/31/2024", "SHOP.*"],
  ["   ", ""],
];

describe("suggestPattern", () => {
  it.each(CASES)("%s", (raw, expected) => {
    expect(suggestPattern(raw)).toBe(expected);
  });

  it.each(CASES.filter(([raw]) => raw.trim()))("the suggestion for %s matches it", (raw) => {
    expect(new RegExp(suggestPattern(raw), "i").test(raw)).toBe(true);
  });
});
