import { describe, expect, it } from "vitest";

import { spendingPacing, spendingTrend, splitFor } from "../../domain/spendingPlan";
import type { MonthlySpendingTypeRow } from "../../queries/analysis";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

function row(period: string, spendingType: MonthlySpendingTypeRow["spendingType"], amountCents: number, last?: string): MonthlySpendingTypeRow {
  return { period, spendingType, amountCents, lastDate: day(last ?? `${period}-28`) };
}

/** `months` months of flat spend from `start`: 1000 essential, 500 discretionary, 100 unclassified. */
function flat(start: string, months: number): MonthlySpendingTypeRow[] {
  const [y, m] = start.split("-").map(Number);
  const out: MonthlySpendingTypeRow[] = [];
  for (let i = 0; i < months; i++) {
    const n = y * 12 + (m - 1) + i;
    const p = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
    out.push(row(p, "essential", 1000), row(p, "discretionary", 500), row(p, "unclassified", 100));
  }
  return out;
}

describe("splitFor", () => {
  it("sums the months in the period, unclassified inside discretionary", () => {
    const rows = flat("2025-11", 4);
    expect(splitFor(rows, (p) => p.startsWith("2026"))).toEqual({
      essentialCents: 2000, discretionaryCents: 1200, unclassifiedCents: 200,
    });
  });
});

describe("spendingTrend", () => {
  it("shows up to 24 months ending at the given month, gaps as zero", () => {
    const rows = [...flat("2023-01", 30), row("2026-03", "essential", 700)];
    const trend = spendingTrend(rows, "2026-03");
    expect(trend).toHaveLength(24);
    expect(trend[0].month).toBe("2024-04");
    expect(trend.at(-1)).toMatchObject({ month: "2026-03", essentialCents: 700, discretionaryCents: 0, unclassifiedCents: 0 });
    // 2025-07 onwards has no rows at all.
    expect(trend.find((t) => t.month === "2025-08")).toMatchObject({ essentialCents: 0, discretionaryCents: 0 });
  });

  it("starts at the first month with spend", () => {
    const trend = spendingTrend(flat("2026-01", 3), "2026-03");
    expect(trend.map((t) => t.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("averages each type over the trailing 12 months, never before the first month", () => {
    const rows = [...flat("2025-01", 12), row("2026-01", "essential", 13_000), row("2026-01", "discretionary", 600)];
    const trend = spendingTrend(rows, "2026-01");
    expect(trend[0]).toMatchObject({ month: "2025-01", essentialAvgCents: 1000, discretionaryAvgCents: 600 });
    // 2025-02..2026-01: eleven 1000s and one 13000.
    expect(trend.at(-1)).toMatchObject({ essentialAvgCents: 2000, discretionaryAvgCents: 600 });
  });

  it("ignores months after the end", () => {
    expect(spendingTrend(flat("2026-01", 6), "2026-02").map((t) => t.month)).toEqual(["2026-01", "2026-02"]);
  });

  it("is empty with no spend up to the end", () => {
    expect(spendingTrend(flat("2026-05", 2), "2026-03")).toEqual([]);
  });
});

describe("spendingPacing", () => {
  it("projects from last year's spend after the latest row", () => {
    const rows = [
      ...flat("2025-01", 12),
      row("2025-12", "essential", 5000), // an annual bill
      ...flat("2026-01", 5),
      // June data reaches the 15th.
      row("2026-06", "essential", 400, "2026-06-15"),
    ];
    const p = spendingPacing(rows, 2026)!;
    expect(p.asOf).toBe("2026-06-15");
    expect(p.basis).toBe("last-year");
    expect(p.elapsed).toBeCloseTo(166 / 365);
    expect(p.essential.ytdCents).toBe(5 * 1000 + 400);
    // Half of last June left, then July to December, the bill included.
    expect(p.essential.projectedCents).toBe(5400 + 500 + 6 * 1000 + 5000);
    expect(p.discretionary.ytdCents).toBe(5 * 600);
    expect(p.discretionary.projectedCents).toBe(3000 + 300 + 6 * 600);
  });

  it("runs the year-to-date rate on when last year has a month missing", () => {
    const rows = [...flat("2025-01", 10), ...flat("2026-01", 6).map((r) => ({ ...r, lastDate: r.period === "2026-06" ? day("2026-06-30") : r.lastDate }))];
    const p = spendingPacing(rows, 2026)!;
    expect(p.basis).toBe("run-rate");
    expect(p.asOf).toBe("2026-06-30");
    expect(p.essential.projectedCents).toBe(Math.round(6000 / (181 / 365)));
  });

  it("is null for a year with no spend", () => {
    expect(spendingPacing(flat("2025-01", 12), 2026)).toBeNull();
  });
});
