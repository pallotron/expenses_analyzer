import { describe, expect, it } from "vitest";

import type { RunParts } from "../../api/payslips";
import { aggregateMonths, deriveRun, RUN_PART_KEYS, type StoredRun } from "../../domain/payslips";
import rawVectors from "../fixtures/python_vectors.json";

/** Python field name -> RunParts key. */
const FIELD: Record<string, keyof RunParts> = {
  salary: "salaryCents", bonus: "bonusCents", oncall: "onCallCents",
  reimbursements: "reimbursementsCents", non_taxable_adj: "nonTaxableAdjCents",
  misc_deductions: "miscDeductionsCents", pension_ee: "pensionEeCents", avc: "avcCents",
  pension_er: "pensionErCents", paye: "payeCents", prsi_ee: "prsiEeCents", usc: "uscCents",
  pension_ee_ytd: "pensionEeYtdCents", avc_ytd: "avcYtdCents", pension_er_ytd: "pensionErYtdCents",
};

interface VectorRun { month: string; sourceFile: string; cents: Record<string, number>; statedNet: number | null }
const vectors = rawVectors as unknown as {
  payslips: { aggregate: { name: string; runs: VectorRun[]; expected: unknown[] }[] };
};

function stored(v: VectorRun): StoredRun {
  const parts = { statedNetCents: v.statedNet } as RunParts;
  for (const [field, cents] of Object.entries(v.cents)) parts[FIELD[field]] = cents as never;
  return { ...parts, ...deriveRun(parts), month: v.month, sourceFile: v.sourceFile };
}

export const zeroParts = (over: Partial<RunParts> = {}): RunParts => ({
  ...Object.fromEntries(RUN_PART_KEYS.map((k) => [k, 0])) as Omit<RunParts, "statedNetCents">,
  statedNetCents: null,
  ...over,
});

describe("deriveRun", () => {
  it("works out gross, tax and net as the payslip does", () => {
    expect(deriveRun(zeroParts({
      salaryCents: 500000, bonusCents: 1000, onCallCents: 2000, reimbursementsCents: 3000,
      pensionEeCents: 50000, avcCents: 10000, payeCents: 100000, prsiEeCents: 20000, uscCents: 15000,
      miscDeductionsCents: 9000, nonTaxableAdjCents: 2500, statedNetCents: 304500,
    }))).toEqual({ grossCents: 506000, taxTotalCents: 135000, netCents: 304500, netReconciled: true });
  });

  it("flags a net that differs from the payslip, and accepts a missing one", () => {
    expect(deriveRun(zeroParts({ salaryCents: 1000, statedNetCents: 1001 })).netReconciled).toBe(false);
    expect(deriveRun(zeroParts({ salaryCents: 1000 })).netReconciled).toBe(true);
  });
});

describe("aggregateMonths matches the Python's aggregate_runs", () => {
  it.each(vectors.payslips.aggregate.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(aggregateMonths(c.runs.map(stored), [])).toEqual(c.expected);
  });
});

describe("aggregateMonths with months the TUI saved", () => {
  const run = (month: string, file: string, ytd: number): StoredRun => {
    const parts = zeroParts({ pensionEeCents: 60000, pensionEeYtdCents: ytd });
    return { ...parts, ...deriveRun(parts), month, sourceFile: file };
  };

  it("cannot check a month whose latest earlier month has no runs", () => {
    const rows = aggregateMonths([run("2026-03", "a.pdf", 180000)], ["2026-02"]);
    expect(rows.map((r) => [r.month, r.ytdReconciled])).toEqual([["2026-03", null]]);
  });

  it("still checks against an earlier month with runs when a runless one is older", () => {
    const rows = aggregateMonths([run("2026-02", "a.pdf", 120000), run("2026-03", "b.pdf", 180000)], ["2026-01"]);
    expect(rows.map((r) => [r.month, r.ytdReconciled])).toEqual([["2026-02", null], ["2026-03", true]]);
  });

  it("ignores runless months in another year", () => {
    const rows = aggregateMonths([run("2026-01", "a.pdf", 60000)], ["2025-12"]);
    expect(rows[0].ytdReconciled).toBe(true);
  });

  it("returns nothing for no runs", () => {
    expect(aggregateMonths([], ["2026-01"])).toEqual([]);
  });
});
