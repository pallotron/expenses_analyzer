/**
 * Payslip arithmetic shared by the browser parser and the Worker, and the
 * month roll-up: a port of expenses/payslip_handler.aggregate_runs, held to it
 * by python_vectors.json (the Python app's answers, frozen). All money is integer cents, so the Python's
 * round(x, 2) calls have no counterpart.
 */

import type { DerivedRun, RunParts } from "../api/payslips";

/** Every numeric part, in a fixed order; statedNetCents is the nullable one. */
export const RUN_PART_KEYS = [
  "salaryCents", "bonusCents", "onCallCents", "reimbursementsCents", "nonTaxableAdjCents",
  "miscDeductionsCents", "pensionEeCents", "avcCents", "pensionErCents", "payeCents",
  "prsiEeCents", "uscCents", "pensionEeYtdCents", "avcYtdCents", "pensionErYtdCents",
] as const satisfies readonly (keyof RunParts)[];

/**
 * Gross is cash earnings (no notional BIK, no non-taxable adjustments). Net
 * mirrors the payslip's NETT PAY. A missing stated net counts as reconciled,
 * since there is nothing to compare with.
 */
export function deriveRun(p: RunParts): DerivedRun {
  const grossCents = p.salaryCents + p.bonusCents + p.onCallCents + p.reimbursementsCents;
  const taxTotalCents = p.payeCents + p.prsiEeCents + p.uscCents;
  const netCents = grossCents - (p.pensionEeCents + p.avcCents) - taxTotalCents
    - p.miscDeductionsCents + p.nonTaxableAdjCents;
  const netReconciled = p.statedNetCents === null || Math.abs(netCents - p.statedNetCents) < 1;
  return { grossCents, taxTotalCents, netCents, netReconciled };
}

export interface StoredRun extends RunParts, DerivedRun {
  /** "YYYY-MM". */
  month: string;
  sourceFile: string;
}

export interface MonthTotals {
  month: string;
  grossCents: number;
  netCents: number;
  taxTotalCents: number;
  pensionEeCents: number;
  avcCents: number;
  pensionErCents: number;
  bonusCents: number;
  onCallCents: number;
  /** Sorted. */
  sourceFiles: string[];
  netReconciled: boolean;
  /** Null when the month it must be compared with has no runs (TUI data). */
  ytdReconciled: boolean | null;
}

const sum = (runs: StoredRun[], pick: (r: StoredRun) => number) => runs.reduce((a, r) => a + pick(r), 0);

/**
 * One row per month that has runs, sorted by month. Same-month runs are summed.
 * The YTD check compares the month's employee pension + AVC with its ending
 * year-to-date (the largest over its runs) minus the prior: the ending YTD of
 * the latest earlier month in the same calendar year, or 0 when there is none
 * or when the count fell (a new employer). `runlessMonths` are months saved
 * without runs; when one is the latest earlier month, the check is null.
 */
export function aggregateMonths(runs: StoredRun[], runlessMonths: string[]): MonthTotals[] {
  const byMonth = new Map<string, StoredRun[]>();
  for (const run of runs) byMonth.set(run.month, [...(byMonth.get(run.month) ?? []), run]);
  const runless = new Set(runlessMonths.filter((m) => !byMonth.has(m)));
  const all = [...new Set([...byMonth.keys(), ...runless])].sort();
  const endingYtd = new Map([...byMonth].map(([m, rs]) =>
    [m, Math.max(...rs.map((r) => r.pensionEeYtdCents + r.avcYtdCents))]));

  return [...byMonth.keys()].sort().map((month) => {
    const group = byMonth.get(month)!;
    const pensionEeCents = sum(group, (r) => r.pensionEeCents);
    const avcCents = sum(group, (r) => r.avcCents);
    const earlier = all.filter((m) => m < month && m.slice(0, 4) === month.slice(0, 4)).at(-1);

    let ytdReconciled: boolean | null;
    if (earlier !== undefined && runless.has(earlier)) {
      ytdReconciled = null;
    } else {
      const ending = endingYtd.get(month)!;
      let prior = earlier === undefined ? 0 : endingYtd.get(earlier)!;
      if (ending < prior) prior = 0;
      ytdReconciled = Math.abs(pensionEeCents + avcCents - (ending - prior)) < 1;
    }

    return {
      month,
      grossCents: sum(group, (r) => r.grossCents),
      netCents: sum(group, (r) => r.netCents),
      taxTotalCents: sum(group, (r) => r.taxTotalCents),
      pensionEeCents,
      avcCents,
      pensionErCents: sum(group, (r) => r.pensionErCents),
      bonusCents: sum(group, (r) => r.bonusCents),
      onCallCents: sum(group, (r) => r.onCallCents),
      sourceFiles: group.map((r) => r.sourceFile).sort(),
      netReconciled: group.every((r) => r.netReconciled),
      ytdReconciled,
    };
  });
}

/**
 * Constrained to a real year and month so an unrelated digit run in a filename
 * cannot be mistaken for a date.
 */
const MONTH_RE = /((?:19|20)\d{2}-(?:0[1-9]|1[0-2]))/;

/**
 * A YYYY-MM from anywhere in a payslip filename, or null.
 *
 * Not anchored to the start: a folder from a different employer may prefix its
 * payslips with a word, and those files still carry a usable month.
 */
export function monthFromFilename(name: string): string | null {
  const base = name.split("/").pop() ?? name;
  return MONTH_RE.exec(base)?.[1] ?? null;
}
