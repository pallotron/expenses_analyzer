/**
 * The monthly grid and its anomaly flags, computed through the views, must
 * equal what SummaryScreen._populate_monthly_breakdown shows for the same rows.
 */

import { describe, expect, it } from "vitest";

import { averageCents } from "../../api/summary";
import { historicalStats, isAnomaly } from "../../domain/anomalies";
import { buildGrid } from "../../domain/grid";
import { categoryBreakdown, categoryMonthTotalsAllTypes, type Scope } from "../../queries/analysis";
import { summaryVectors, vectorStore } from "../helpers/summaryStore";

const { db } = vectorStore();

describe("the monthly grid matches the Python", () => {
  it.each(summaryVectors.grids.map((g) => [`${g.year} ${g.type} ${JSON.stringify(g.sources)}`, g] as const))(
    "%s",
    async (_name, g) => {
      const scope: Scope = { sources: g.sources ?? undefined };
      const cells = await categoryBreakdown(db, "month", g.type, { ...scope, year: String(g.year) });
      const stats = historicalStats(await categoryMonthTotalsAllTypes(db, scope));
      const grid = buildGrid(cells, (category, month, amount) =>
        g.type === "expense" && isAnomaly(stats, category, month, amount));

      if (g.expected === null) {
        expect(grid.rows).toEqual([]);
        return;
      }
      expect(grid.total.totalCents).toBe(g.expected.total.totalCents);
      expect(grid.total.months.map((m) => m.amountCents)).toEqual(g.expected.total.months);
      expect(grid.rows.map((r) => ({
        category: r.category,
        totalCents: r.totalCents,
        months: r.months.map((m) => m.amountCents),
        anomalies: r.months.map((m) => m.anomaly),
      }))).toEqual(g.expected.rows.map(({ averageCents: _a, ...rest }) => rest));

      // The TUI shows the average to the cent; ours is exact, so within half a cent.
      grid.rows.forEach((r, i) =>
        expect(Math.abs(averageCents(r) - g.expected!.rows[i].averageCents)).toBeLessThanOrEqual(0.5));
    },
  );

  it("the fixture really has an anomaly and a zero-std category", () => {
    const g2026 = summaryVectors.grids.find((g) => g.year === 2026 && g.sources === null && g.type === "expense")!;
    const rows = new Map(g2026.expected!.rows.map((r) => [r.category, r]));
    expect(rows.get("Groceries")!.anomalies).toContain(true);
    expect(rows.get("Rent")!.anomalies).not.toContain(true);
  });
});
