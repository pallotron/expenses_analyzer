import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "../lib/money";
import type { MonthTotals } from "../lib/types";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function MonthlyChart(props: { totals: MonthTotals[] }) {
  const data = props.totals.map((t) => ({ ...t, label: MONTHS[t.month - 1] }));
  return (
    <section aria-label="Income and expenses by month" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-400">Income and expenses by month</h2>
      <div className="h-48 md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={1}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={(c: number) => formatCents(c, { compact: true })} width={56} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={(c) => formatCents(Number(c))} />
            <Bar dataKey="incomeCents" name="Income" fill="var(--color-income)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expensesCents" name="Expenses" fill="var(--color-expense)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
