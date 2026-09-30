import { useState } from "react";
import { formatCents } from "../lib/money";
import { averageCents, type Grid, type GridCell, type GridRow } from "../lib/types";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { Sparkline } from "./Sparkline";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Amount(props: { cell: GridCell }) {
  if (props.cell.amountCents === 0) return <span className="text-slate-400">–</span>;
  const text = formatCents(props.cell.amountCents);
  return props.cell.anomaly
    ? <span title="Unusually high: more than 2σ above the previous 12 months" className="rounded bg-anomaly/15 px-1 font-semibold text-anomaly">{text} ↑</span>
    : <>{text}</>;
}

function DesktopTable(props: { grid: Grid }) {
  const row = (r: GridRow, isTotal = false) => (
    <tr key={r.category} className={isTotal ? "font-semibold" : "border-t border-slate-100 dark:border-slate-800"}>
      <th scope="row" className="sticky left-0 bg-white py-1.5 pr-3 text-left font-medium dark:bg-slate-950">{r.category}</th>
      {r.months.map((c, i) => <td key={i} className="px-2 text-right whitespace-nowrap"><Amount cell={c} /></td>)}
      <td className="px-2 text-right whitespace-nowrap">{formatCents(r.totalCents)}</td>
      <td className="px-2 text-right whitespace-nowrap">{formatCents(averageCents(r, isTotal))}</td>
      <td className="pl-2">{!isTotal && <Sparkline values={r.months} label={`${r.category} by month`} />}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="sticky left-0 bg-white text-left dark:bg-slate-950">Category</th>
            {MONTHS.map((m) => <th key={m} className="px-2 text-right font-normal">{m}</th>)}
            <th className="px-2 text-right font-normal">Total</th>
            <th className="px-2 text-right font-normal">Average</th>
            <th className="pl-2 text-left font-normal">Trend</th>
          </tr>
        </thead>
        <tbody>
          {row(props.grid.total, true)}
          {props.grid.rows.map((r) => row(r))}
        </tbody>
      </table>
    </div>
  );
}

function PhoneRows(props: { grid: Grid }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {props.grid.rows.map((r) => (
        <li key={r.category} className="py-2">
          <button type="button" aria-expanded={open === r.category}
            onClick={() => setOpen(open === r.category ? null : r.category)}
            className="flex w-full items-center justify-between gap-3 text-left text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.category}</span>
              <span className="text-xs text-slate-500">{formatCents(r.totalCents)} · avg {formatCents(averageCents(r))}</span>
            </span>
            <Sparkline values={r.months} label={`${r.category} by month`} />
          </button>
          {open === r.category && (
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              {r.months.map((c, i) => (
                <div key={i} className="flex justify-between">
                  <dt className="text-slate-500">{MONTHS[i]}</dt>
                  <dd><Amount cell={c} /></dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MonthlyGrid(props: { title: string; grid: Grid; tone: "income" | "expense" }) {
  const desktop = useMediaQuery(DESKTOP);
  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">{props.title}</h2>
      {props.grid.rows.length === 0
        ? <p className="text-sm text-slate-500">Nothing this year.</p>
        : desktop ? <DesktopTable grid={props.grid} /> : <PhoneRows grid={props.grid} />}
    </section>
  );
}
