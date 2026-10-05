import type { PayslipMonthRow } from "../lib/types";

export interface PayslipYear {
  year: string;
  /** Newest first, as the API sends them. */
  months: PayslipMonthRow[];
  grossCents: number;
  netCents: number;
  /** Employee pension + AVC. */
  pensionEeCents: number;
  pensionErCents: number;
  /** Months the TUI saved, which have no files. */
  tuiMonths: number;
  /** Some month's net or year-to-date check does not add up. */
  flagged: boolean;
}

/** Saved months by calendar (Irish tax) year, newest year first, with the year's totals. */
export function groupByYear(months: PayslipMonthRow[]): PayslipYear[] {
  const byYear = new Map<string, PayslipMonthRow[]>();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), m]);
  }
  const sum = (ms: PayslipMonthRow[], pick: (m: PayslipMonthRow) => number) => ms.reduce((a, m) => a + pick(m), 0);
  return [...byYear.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, ms]) => ({
      year,
      months: [...ms].sort((a, b) => b.month.localeCompare(a.month)),
      grossCents: sum(ms, (m) => m.grossCents),
      netCents: sum(ms, (m) => m.netCents),
      pensionEeCents: sum(ms, (m) => m.pensionEeCents + m.avcCents),
      pensionErCents: sum(ms, (m) => m.pensionErCents),
      tuiMonths: ms.filter((m) => m.runs.length === 0).length,
      flagged: ms.some((m) => m.netReconciled === false || m.ytdReconciled === false),
    }));
}
