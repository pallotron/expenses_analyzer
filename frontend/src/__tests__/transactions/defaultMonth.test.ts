import { describe, expect, it } from "vitest";

import { defaultMonth } from "../../transactions/defaultMonth";

const periods = (years: { year: number; months: number[] }[]) => ({ years, sources: [] });
const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe("defaultMonth", () => {
  it("is the current month when it has transactions", () => {
    expect(defaultMonth(periods([{ year: 2026, months: [8, 9] }]), on("2026-09-15"))).toEqual({ year: 2026, month: 9 });
  });
  it("is the previous month when the current one is empty, across a year boundary", () => {
    expect(defaultMonth(periods([{ year: 2026, months: [8, 9] }]), on("2026-10-01"))).toEqual({ year: 2026, month: 9 });
    expect(defaultMonth(periods([{ year: 2025, months: [11, 12] }]), on("2026-01-03"))).toEqual({ year: 2025, month: 12 });
  });
  it("falls back to the newest month with data", () => {
    expect(defaultMonth(periods([{ year: 2026, months: [3, 5] }, { year: 2025, months: [1] }]), on("2026-09-15")))
      .toEqual({ year: 2026, month: 5 });
  });
  it("is null with no data", () => {
    expect(defaultMonth(periods([]), on("2026-09-15"))).toBeNull();
  });
});
