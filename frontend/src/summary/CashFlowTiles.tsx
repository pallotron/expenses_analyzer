import { formatCents, formatPercent, savingsRate } from "../lib/money";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import type { SummaryResponse } from "../lib/types";

export function CashFlowTiles(props: { cashFlow: SummaryResponse["cashFlow"] }) {
  const compact = !useMediaQuery(DESKTOP);
  const { incomeCents, expensesCents } = props.cashFlow;
  const net = incomeCents - expensesCents;
  const tiles = [
    { label: "Income", value: formatCents(incomeCents, { compact }), tone: "text-income" },
    { label: "Expenses", value: formatCents(expensesCents, { compact }), tone: "text-expense" },
    { label: "Net", value: formatCents(net, { compact }), tone: net >= 0 ? "text-income" : "text-expense" },
    { label: "Savings rate", value: formatPercent(savingsRate(incomeCents, expensesCents)), tone: "" },
  ];
  return (
    <section aria-label="Cash flow" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t.label}</div>
          <div className={`mt-1 text-xl font-semibold md:text-2xl ${t.tone}`}>{t.value}</div>
        </div>
      ))}
    </section>
  );
}
