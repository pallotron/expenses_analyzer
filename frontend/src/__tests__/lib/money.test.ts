import { describe, expect, it } from "vitest";
import { formatCents, formatPercent, savingsRate } from "../../lib/money";

describe("formatCents", () => {
  it("formats euros with two decimals and grouping", () => {
    expect(formatCents(123_456)).toBe("€1,234.56");
    expect(formatCents(0)).toBe("€0.00");
    expect(formatCents(-1_234)).toBe("-€12.34");
  });
  it("has a compact form for small tiles", () => {
    expect(formatCents(6_140_000, { compact: true })).toBe("€61.4K");
    expect(formatCents(95_000, { compact: true })).toBe("€950");
  });
});

describe("savingsRate", () => {
  it("is net over income, in percent", () => {
    expect(savingsRate(10_000, 7_500)).toBe(25);
  });
  it("can be negative", () => {
    expect(savingsRate(10_000, 12_000)).toBe(-20);
  });
  it("is null with no income, never a division by zero", () => {
    expect(savingsRate(0, 5_000)).toBeNull();
  });
});

describe("formatPercent", () => {
  it("shows a dash for null", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(36.63)).toBe("36.6%");
  });
});
