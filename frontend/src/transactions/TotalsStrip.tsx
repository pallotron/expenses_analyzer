import { formatCents } from "../lib/money";

export function TotalsStrip(props: { count: number; incomeCents: number; expensesCents: number; type?: "expense" | "income" }) {
  const { count, incomeCents, expensesCents, type } = props;
  const net = incomeCents - expensesCents;
  const income = { label: "Income", value: formatCents(incomeCents), tone: "text-income" };
  const expenses = { label: "Expenses", value: formatCents(expensesCents), tone: "text-expense" };
  const netItem = {
    label: "Net",
    value: `${net < 0 ? "−" : ""}${formatCents(Math.abs(net))}`,
    tone: net >= 0 ? "text-income" : "text-expense",
  };
  const items = type === "income" ? [income] : type === "expense" ? [expenses] : [income, expenses, netItem];
  return (
    <section aria-label="Totals" className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {items.map((t) => (
        <span key={t.label} className="whitespace-nowrap">
          <span className="text-xs uppercase tracking-wide text-slate-500">{t.label}</span>{" "}
          <span className={`text-sm font-semibold tabular-nums ${t.tone}`}>{t.value}</span>
        </span>
      ))}
      <span className="text-sm text-slate-500 dark:text-slate-400">{count} {count === 1 ? "transaction" : "transactions"}</span>
    </section>
  );
}
