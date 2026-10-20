import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAxisCents, formatCents } from "../lib/money";
import type { SpendingTrendMonth } from "../lib/types";
import { usePrinting } from "../lib/usePrinting";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SERIES = ["Essential", "Discretionary", "Essential, 12-month average", "Discretionary, 12-month average"];

/**
 * Essential and discretionary spend by month, up to two years back, with each
 * side's 12-month average: the averages show a cost creeping up that single
 * months, lumpy with annual bills, hide.
 */
export function SpendingTrendChart(props: { trend: SpendingTrendMonth[] }) {
  // The browser prints straight after beforeprint: a growing bar would print half drawn.
  const animate = !usePrinting();
  if (props.trend.length < 2) return null;
  const data = props.trend.map((t) => ({
    ...t, label: `${MONTHS[Number(t.month.slice(5, 7)) - 1]} ${t.month.slice(2, 4)}`,
  }));
  return (
    <section aria-label="Essential and discretionary by month" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-400">Essential and discretionary by month</h2>
      <div className="h-48 md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} barGap={2}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={12} />
            <YAxis tickFormatter={formatAxisCents} width={56} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={(c) => formatCents(Number(c))} />
            {/* Recharts sorts legend items by name unless told otherwise. */}
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} itemSorter={(item) => SERIES.indexOf(String(item.value))} />
            {/* Faint bars, so the averages over them read first. */}
            <Bar dataKey="essentialCents" name={SERIES[0]} fill="var(--color-essential)" fillOpacity={0.45} radius={[4, 4, 0, 0]} isAnimationActive={animate} />
            <Bar dataKey="discretionaryCents" name={SERIES[1]} fill="var(--color-discretionary)" fillOpacity={0.45} radius={[4, 4, 0, 0]} isAnimationActive={animate} />
            <Line dataKey="essentialAvgCents" name={SERIES[2]} type="monotone" stroke="var(--color-essential)" strokeWidth={2} dot={false} isAnimationActive={animate} />
            <Line dataKey="discretionaryAvgCents" name={SERIES[3]} type="monotone" stroke="var(--color-discretionary)" strokeWidth={2} dot={false} isAnimationActive={animate} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
