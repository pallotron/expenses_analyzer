import { formatCents } from "../lib/money";

export function TotalsStrip(props: { count: number; incomeCents: number; expensesCents: number; type?: "expense" | "income" }) {
  const { count, incomeCents, expensesCents, type } = props;
  const net = incomeCents - expensesCents;
  const income = { label: "Income", value: formatCents(incomeCents), tone: "text-income" };
  const expenses = { label: "Expenses", value: formatCents(expensesCents), tone: "text-expense" };
  const netTile = {
    label: "Net",
    value: `${net < 0 ? "−" : ""}${formatCents(Math.abs(net))}`,
    tone: net >= 0 ? "text-income" : "text-expense",
  };
  const tiles = type === "income" ? [income] : type === "expense" ? [expenses] : [income, expenses, netTile];
  return (
    <section aria-label="Totals" className="flex flex-col gap-2">
      <div className={`grid grid-cols-3 ${tiles.length === 3 ? "gap-2 sm:gap-3" : ""}`}>
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-xl border border-slate-200 px-2.5 py-2 sm:px-4 sm:py-3 dark:border-slate-800">
            <div className="text-xs uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className={`mt-1 whitespace-nowrap text-base font-semibold tabular-nums sm:text-xl ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{count} {count === 1 ? "transaction" : "transactions"}</p>
    </section>
  );
}
