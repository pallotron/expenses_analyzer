import { describe, expect, it } from "vitest";

import { signedAmount } from "../../transactions/amount";

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
