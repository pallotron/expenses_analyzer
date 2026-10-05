import { describe, expect, it } from "vitest";

import { eurosText, parseEuros } from "../../budgets/euros";

describe("parseEuros", () => {
  it.each([
    ["53000", 5_300_000],
    ["€53,000", 5_300_000],
    [" 53 000 ", 5_300_000],
    ["0.29", 29],
    ["12.5", 1250],
    ["0", 0],
    ["10000000", 1_000_000_000],
  ])("reads %j as %i cents", (text, cents) => {
    expect(parseEuros(text)).toEqual({ ok: true, cents });
  });

  it("reads blank as no budget", () => {
    expect(parseEuros("  ")).toEqual({ ok: true, cents: null });
  });

  it.each(["-5", "1.234", "abc", "1.2.3", "10000000.01"])("refuses %j", (text) => {
    expect(parseEuros(text).ok).toBe(false);
  });
});

describe("eurosText", () => {
  it.each([[null, ""], [5_300_000, "53000"], [1250, "12.50"], [29, "0.29"]] as const)("writes %j as %j", (cents, text) => {
    expect(eurosText(cents)).toBe(text);
  });
});
