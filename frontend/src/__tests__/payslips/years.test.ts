import { describe, expect, it } from "vitest";

import type { PayslipMonthRow } from "../../lib/types";
import { groupByYear } from "../../payslips/years";

const month = (m: string, over: Partial<PayslipMonthRow> = {}): PayslipMonthRow => ({
  month: m, grossCents: 1000, netCents: 600, taxTotalCents: 300, pensionEeCents: 50, avcCents: 10,
  pensionErCents: 40, bonusCents: 0, onCallCents: 0, netReconciled: true, ytdReconciled: true, runs: [], ...over,
});

describe("groupByYear", () => {
  it("groups months by year, newest year and month first, with the year's totals", () => {
    const years = groupByYear([month("2025-11"), month("2026-02"), month("2026-01"), month("2025-12")]);
    expect(years.map((y) => [y.year, y.months.map((m) => m.month)])).toEqual([
      ["2026", ["2026-02", "2026-01"]],
      ["2025", ["2025-12", "2025-11"]],
    ]);
    expect(years[0]).toMatchObject({ grossCents: 2000, netCents: 1200, pensionEeCents: 120, pensionErCents: 80 });
  });

  it("counts the TUI's months and flags a year with a failing check, but not an unknown one", () => {
    const run = { sourceFile: "a.pdf", grossCents: 1, netCents: 1, pensionEeCents: 0, avcCents: 0, pensionErCents: 0, netReconciled: true };
    const [y2026, y2025] = groupByYear([
      month("2026-02", { runs: [run], ytdReconciled: null }), month("2026-01"),
      month("2025-12", { ytdReconciled: false }),
    ]);
    expect(y2026).toMatchObject({ tuiMonths: 1, flagged: false });
    expect(y2025).toMatchObject({ tuiMonths: 1, flagged: true });
  });

  it("returns nothing for no months", () => {
    expect(groupByYear([])).toEqual([]);
  });
});
