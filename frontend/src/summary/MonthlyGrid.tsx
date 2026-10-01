import { useState } from "react";
import { formatCents } from "../lib/money";
import { averageCents, monthTrends, type Grid, type GridCell, type GridRow, type Trend } from "../lib/types";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { useHorizontalScroll, type HorizontalScroll } from "../lib/useHorizontalScroll";
import { Sparkline } from "./Sparkline";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ARROW: Partial<Record<Trend, { className: string; label: string }>> = {
  "↑": { className: "text-expense", label: "up on the month before" },
  "↓": { className: "text-income", label: "down on the month before" },
  "=": { className: "text-essential", label: "same as the month before" },
};

/** The month's amount, its anomaly highlight, and the arrow against the month before. */
function Amount(props: { cell: GridCell; trend?: Trend | null }) {
  if (props.cell.amountCents === 0) return <span className="text-slate-400">–</span>;
  const text = formatCents(props.cell.amountCents);
  const arrow = props.trend ? ARROW[props.trend] : undefined;
  return (
    <>
      {props.cell.anomaly
        ? <span title="Unusually high: more than 2σ above the previous 12 months" className="rounded bg-anomaly/15 px-1 font-semibold text-anomaly">{text}</span>
        : text}
      {arrow && <span aria-label={arrow.label} className={`ml-1 font-semibold ${arrow.className}`}>{props.trend}</span>}
    </>
  );
}

/** Arrows are the expense grid's only, as in the TUI; the Total row has none. */
function trendsFor(row: GridRow, tone: "income" | "expense", isTotal = false): (Trend | null)[] {
  return tone === "expense" && !isTotal ? monthTrends(row) : row.months.map(() => null);
}

/**
 * Category, Total, Average and Trend stay put while the months scroll under
 * them, as the TUI's fixed_columns does. Sticky cells need known offsets, so
 * these four columns have fixed widths (the sparkline is at most 12 × 6px).
 */
const FROZEN = [
  { width: "9rem", left: "0rem" },
  { width: "7rem", left: "9rem" },
  { width: "7rem", left: "16rem" },
  { width: "5.5rem", left: "23rem" },
];
/** Where the months start: the frozen columns' widths added up. */
const FROZEN_WIDTH = "28.5rem";
const FROZEN_CLASS = "sticky z-10 bg-white dark:bg-slate-950";
// The last frozen column draws the edge the months slide under.
const EDGE = "shadow-[1px_0_0_0_var(--color-slate-200)] dark:shadow-[1px_0_0_0_var(--color-slate-800)]";
const frozen = (i: number) => ({ left: FROZEN[i].left, width: FROZEN[i].width, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width });

function DesktopTable(props: { grid: Grid; lastMonth: number; tone: "income" | "expense"; scroll: HorizontalScroll }) {
  const row = (r: GridRow, isTotal = false) => {
    const trends = trendsFor(r, props.tone, isTotal);
    return (
      <tr key={r.category} className={isTotal ? "font-semibold" : "border-t border-slate-100 dark:border-slate-800"}>
        <th scope="row" style={frozen(0)} className={`${FROZEN_CLASS} py-1.5 pr-3 text-left font-medium`}>{r.category}</th>
        <td style={frozen(1)} className={`${FROZEN_CLASS} px-2 text-right whitespace-nowrap`}>{formatCents(r.totalCents)}</td>
        <td style={frozen(2)} className={`${FROZEN_CLASS} px-2 text-right whitespace-nowrap`}>{formatCents(averageCents(r, isTotal))}</td>
        <td style={frozen(3)} className={`${FROZEN_CLASS} ${EDGE} px-2`}>{!isTotal && <Sparkline values={r.months.slice(0, props.lastMonth)} label={`${r.category} by month`} />}</td>
        {r.months.slice(0, props.lastMonth).map((c, i) => <td key={i} className="px-2 text-right whitespace-nowrap"><Amount cell={c} trend={trends[i]} /></td>)}
      </tr>
    );
  };
  const fade = "pointer-events-none absolute inset-y-0 z-20 w-8 from-white to-transparent dark:from-slate-950";
  return (
    <div className="relative">
      {/* Fades over the months say there are more off that edge. */}
      {props.scroll.canLeft && <div data-testid="fade-left" className={`${fade} bg-linear-to-r`} style={{ left: FROZEN_WIDTH }} />}
      {props.scroll.canRight && <div data-testid="fade-right" className={`${fade} right-0 bg-linear-to-l`} />}
      <div ref={props.scroll.ref} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th style={frozen(0)} className={`${FROZEN_CLASS} text-left`}>Category</th>
              <th style={frozen(1)} className={`${FROZEN_CLASS} px-2 text-right font-normal`}>Total</th>
              <th style={frozen(2)} className={`${FROZEN_CLASS} px-2 text-right font-normal`}>Average</th>
              <th style={frozen(3)} className={`${FROZEN_CLASS} ${EDGE} px-2 text-left font-normal`}>Trend</th>
              {MONTHS.slice(0, props.lastMonth).map((m) => <th key={m} data-month className="px-2 text-right font-normal">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {row(props.grid.total, true)}
            {props.grid.rows.map((r) => row(r))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PhoneRows(props: { grid: Grid; lastMonth: number; tone: "income" | "expense" }) {
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
            <Sparkline values={r.months.slice(0, props.lastMonth)} label={`${r.category} by month`} />
          </button>
          {open === r.category && (
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              {r.months.slice(0, props.lastMonth).map((c, i) => (
                <div key={i} className="flex justify-between">
                  <dt className="text-slate-500">{MONTHS[i]}</dt>
                  <dd><Amount cell={c} trend={trendsFor(r, props.tone)[i]} /></dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

/** `lastMonth` is the latest month with data (1–12): later months would be empty columns. */
export function MonthlyGrid(props: { title: string; grid: Grid; tone: "income" | "expense"; lastMonth: number }) {
  const desktop = useMediaQuery(DESKTOP);
  const scroll = useHorizontalScroll(props.grid);
  const overflows = desktop && (scroll.canLeft || scroll.canRight);
  // Three month columns per press.
  const step = () => 3 * (scroll.ref.current?.querySelector<HTMLElement>("th[data-month]")?.offsetWidth || 90);
  const arrow = "rounded-md border border-slate-300 px-2.5 py-0.5 text-base leading-none hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent dark:border-slate-700 dark:hover:bg-slate-800";
  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400">{props.title}</h2>
        {overflows && (
          <div className="flex gap-1 text-sm">
            <button type="button" aria-label="Earlier months" disabled={!scroll.canLeft}
              onClick={() => scroll.scrollBy(-step())} className={arrow}>◂</button>
            <button type="button" aria-label="Later months" disabled={!scroll.canRight}
              onClick={() => scroll.scrollBy(step())} className={arrow}>▸</button>
          </div>
        )}
      </div>
      {props.grid.rows.length === 0
        ? <p className="text-sm text-slate-500">Nothing this year.</p>
        : desktop
          ? <DesktopTable grid={props.grid} lastMonth={props.lastMonth} tone={props.tone} scroll={scroll} />
          : <PhoneRows grid={props.grid} lastMonth={props.lastMonth} tone={props.tone} />}
    </section>
  );
}
