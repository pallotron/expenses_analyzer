/**
 * The Summary's savings rate with pension: a port of
 * expenses/analysis.get_enhanced_savings_totals and _coverage_label, held to
 * them by tools/crosscheck/vectors.py. Choosing whose payslips count is the
 * caller's job; this sums whatever months it is given.
 */

export interface BankMonth {
  /** "YYYY-MM". Present only when the month has transactions in scope. */
  month: string;
  incomeCents: number;
  expensesCents: number;
}

export interface PensionMonth {
  month: string;
  pensionEeCents: number;
  avcCents: number;
  pensionErCents: number;
  ytdReconciled: boolean | null;
}

export interface PensionSavings {
  pensionCents: number;
  savedCents: number;
  incomeCents: number;
  /** Percent; 0 when income with pension is not positive. */
  rate: number;
  /** 1–12, ascending. */
  months: number[];
  coverageLabel: string;
  /** False only when a counted month failed its YTD check; unknown is not a failure. */
  reconciled: boolean;
}

const ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep–Dec", "Jan", or "3 mo" when there are gaps, since a range would imply full coverage. */
export function coverageLabel(months: number[]): string {
  if (months.length === 0) return "";
  const contiguous = months.every((m, i) => i === 0 || m - months[i - 1] === 1);
  if (!contiguous) return `${months.length} mo`;
  const start = ABBR[months[0] - 1];
  const end = ABBR[months[months.length - 1] - 1];
  return start === end ? start : `${start}–${end}`;
}

/**
 * Pension (employee + AVC + employer) added to both what was saved and the
 * income, over the months that have a payslip and bank transactions, so the
 * rate stays on the bank rate's base. Net pay is not added: it already lands
 * in the bank. Null when no month qualifies.
 */
export function pensionSavings(
  bank: BankMonth[], payslips: PensionMonth[], year: number, month: number | null,
): PensionSavings | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  const inPeriod = (m: string) => (month === null ? m.startsWith(`${year}-`) : m === `${year}-${pad(month)}`);
  const bankMonths = new Set(bank.map((b) => b.month));
  const matched = payslips.filter((p) => inPeriod(p.month) && bankMonths.has(p.month));
  if (matched.length === 0) return null;

  const covered = [...new Set(matched.map((p) => p.month))].sort();
  const aligned = bank.filter((b) => covered.includes(b.month));
  const income = aligned.reduce((a, b) => a + b.incomeCents, 0);
  const net = income - aligned.reduce((a, b) => a + b.expensesCents, 0);
  const pension = matched.reduce((a, p) => a + p.pensionEeCents + p.avcCents + p.pensionErCents, 0);
  const savedCents = net + pension;
  const incomeCents = income + pension;
  const months = covered.map((m) => Number(m.slice(5, 7)));
  return {
    pensionCents: pension,
    savedCents,
    incomeCents,
    rate: incomeCents > 0 ? (savedCents / incomeCents) * 100 : 0,
    months,
    coverageLabel: coverageLabel(months),
    reconciled: matched.every((p) => p.ytdReconciled !== false),
  };
}
