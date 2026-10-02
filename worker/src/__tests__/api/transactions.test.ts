import { describe, expect, it } from "vitest";

import { drillDown, monthRange, quote, toTransactionsSearch } from "../../api/transactions";

describe("monthRange", () => {
  it("spans a whole month, leap February included", () => {
    expect(monthRange(2026, 9)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("spans the year when there is no month", () => {
    expect(monthRange(2025, null)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
});

describe("drillDown", () => {
  it("asks for the exact category in the period, with type and budget", () => {
    expect(drillDown({ year: 2026, month: 3, type: "expense", category: "Groceries", budget: "essential", excludeHidden: true }))
      .toEqual({ from: "2026-03-01", to: "2026-03-31", category: '"Groceries"', type: "expense", budget: "essential", excludeHidden: true });
  });
  it("asks for the exact merchant and leaves out what is unset", () => {
    expect(drillDown({ year: 2026, month: null, type: "income", merchant: "Employer", excludeHidden: false }))
      .toEqual({ from: "2026-01-01", to: "2026-12-31", merchant: '"Employer"', type: "income" });
  });
  it("carries an empty source list, which means none", () => {
    expect(drillDown({ year: 2026, month: null, type: "expense", sources: [], excludeHidden: false }).sources).toEqual([]);
  });
});

describe("toTransactionsSearch", () => {
  it("round-trips awkward names through a URL", () => {
    const name = 'Café "Bar" & Co, #1';
    const sp = toTransactionsSearch({ merchant: quote(name), sources: ["Bank A", "Card, joint"] });
    const back = new URLSearchParams(sp.toString());
    expect(back.get("merchant")).toBe(`"${name}"`);
    expect(back.getAll("sources")).toEqual(["Bank A", "Card, joint"]);
  });
  it("writes one empty sources value for none, nothing for all, and skips empty text", () => {
    expect(toTransactionsSearch({ sources: [] }).getAll("sources")).toEqual([""]);
    expect(toTransactionsSearch({ merchant: "" }).toString()).toBe("");
    expect(toTransactionsSearch({ excludeHidden: true }).get("excludeHidden")).toBe("1");
    expect(toTransactionsSearch({ excludeHidden: false }).has("excludeHidden")).toBe(false);
  });
});
