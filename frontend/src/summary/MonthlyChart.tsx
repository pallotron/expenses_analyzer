import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAxisCents, formatCents } from "../lib/money";
import type { MonthTotals } from "../lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `lastMonth` is the latest month with data: the months after it are not plotted. */
export function MonthlyChart(props: { totals: MonthTotals[]; lastMonth: number }) {
  const data = props.totals
    .filter((t) => t.month <= props.lastMonth)
    .map((t) => ({ ...t, netCents: t.incomeCents - t.expensesCents, label: MONTHS[t.month - 1] }));
  return (
    <section aria-label="Income and expenses by month" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-400">Income and expenses by month</h2>
      <div className="h-48 md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} barGap={1}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={formatAxisCents} width={56} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={(c) => formatCents(Number(c))} />
            {/* Recharts sorts legend items by name unless told otherwise. */}
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }}
              itemSorter={(item) => ["Income", "Expenses", "Net"].indexOf(String(item.value))} />
            <Bar dataKey="incomeCents" name="Income" fill="var(--color-income)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expensesCents" name="Expenses" fill="var(--color-expense)" radius={[3, 3, 0, 0]} />
            <Line dataKey="netCents" name="Net" type="monotone" stroke="#64748b" strokeWidth={2} dot={{ r: 2.5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
