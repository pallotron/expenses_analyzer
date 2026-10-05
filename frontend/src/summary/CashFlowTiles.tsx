import { formatCents, formatPercent, savingsRate } from "../lib/money";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import type { SummaryResponse } from "../lib/types";

const GOOD = "text-income";
const BAD = "text-expense";

/** "▲ vs avg €X": higher or lower than the usual month. For spending, higher is the bad direction. */
function versusAverage(cents: number, average: number, higherIsBetter: boolean) {
  if (cents === average) return { text: `vs avg ${formatCents(average)}`, tone: "", title: undefined };
  const higher = cents > average;
  return { text: `${higher ? "▲" : "▼"} vs avg ${formatCents(average)}`, tone: higher === higherIsBetter ? GOOD : BAD, title: undefined };
}

export function CashFlowTiles(props: {
  cashFlow: SummaryResponse["cashFlow"];
  /** Month view only: what a typical earlier month looked like. */
  monthAverage: SummaryResponse["monthAverage"];
  /** Savings rate with pension; null hides the line. */
  pension: SummaryResponse["pension"];
}) {
  const compact = !useMediaQuery(DESKTOP);
  const { incomeCents, expensesCents } = props.cashFlow;
  const avg = props.monthAverage;
  const net = incomeCents - expensesCents;
  const rate = savingsRate(incomeCents, expensesCents);
  const tiles = [
    { label: "Income", value: formatCents(incomeCents, { compact }), tone: "text-income",
      versus: avg && versusAverage(incomeCents, avg.incomeCents, true) },
    { label: "Expenses", value: formatCents(expensesCents, { compact }), tone: "text-expense",
      versus: avg && versusAverage(expensesCents, avg.expensesCents, false) },
    { label: "Net", value: formatCents(net, { compact }), tone: net >= 0 ? GOOD : BAD, versus: null },
    { label: "Savings rate", value: formatPercent(rate), tone: rate === null ? "" : rate >= 0 ? GOOD : BAD,
      versus: props.pension && {
        text: `${formatPercent(props.pension.rate)} with pension · ${props.pension.coverageLabel}${props.pension.reconciled ? "" : " ⚠"}`,
        tone: GOOD,
        title: props.pension.reconciled
          ? `Adds ${formatCents(props.pension.pensionCents)} of pension (${props.pension.people.join(" and ")}) to what was saved and to income`
          : "A payslip's year-to-date pension does not add up for one of these months; check it on the Payslips page",
      } },
  ];
  return (
    <section aria-label="Cash flow" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t.label}</div>
          <div className={`mt-1 text-xl font-semibold md:text-2xl ${t.tone}`}>{t.value}</div>
          {t.versus && <div title={t.versus.title} className={`mt-0.5 text-xs ${t.versus.tone || "text-slate-500"}`}>{t.versus.text}</div>}
        </div>
      ))}
    </section>
  );
}
