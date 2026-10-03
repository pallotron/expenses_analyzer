import { describe, expect, it } from "vitest";

import { parseEuros, signedAmount } from "../../transactions/amount";

describe("signedAmount", () => {
  it("shows income with a plus and the income colour", () => {
    expect(signedAmount({ type: "income", amountCents: 1234 })).toEqual({ text: "+€12.34", className: "text-income" });
  });
  it("shows an expense with U+2212 and the normal colour", () => {
    const { text, className } = signedAmount({ type: "expense", amountCents: 500 });
    expect(text).toBe("−€5.00");
    expect(text.charCodeAt(0)).toBe(0x2212);
    expect(className).toBe("");
  });
});

describe("parseEuros", () => {
  it.each([
    ["12,50", 1250], ["12.5", 1250], ["€ 7", 700], ["1,234.56", 123456], ["1.234,56", 123456], [" 0,01 ", 1],
  ])("reads %s as %i cents", (text, cents) => expect(parseEuros(text)).toBe(cents));

  it.each(["", "0", "-5", "abc", "1.234", "12.345", "1,2,3"])("refuses %j", (text) => expect(parseEuros(text)).toBeNull());
});
