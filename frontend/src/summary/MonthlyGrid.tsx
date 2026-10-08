import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Chevron } from "../lib/Chevron";
import { formatCents } from "../lib/money";
import { averageCents, monthTrends, type Grid, type GridCell, type GridRow, type Trend } from "../lib/types";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { usePrinting } from "../lib/usePrinting";
import { useHorizontalScroll, type HorizontalScroll } from "../lib/useHorizontalScroll";
import { Sparkline } from "./Sparkline";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ARROW: Partial<Record<Trend, { className: string; label: string }>> = {
  "↑": { className: "text-expense", label: "up on the month before" },
  "↓": { className: "text-income", label: "down on the month before" },
  "=": { className: "text-essential", label: "same as the month before" },
};

/** The month's amount, its anomaly highlight, and the arrow against the month before. */
function Amount(props: { cell: GridCell; trend?: Trend | null; whole?: boolean }) {
  if (props.cell.amountCents === 0) return <span className="text-slate-400">–</span>;
  const text = formatCents(props.cell.amountCents, { whole: props.whole });
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

/** `category` null is the Total row; `month` null is the whole year. */
type CellHref = (category: string | null, month: number | null) => string;

/** A link filling its cell, so the whole cell is the target. */
function Linked(props: { to: string | undefined; children: ReactNode }) {
  return props.to ? <Link to={props.to} className="block hover:underline">{props.children}</Link> : <>{props.children}</>;
}

const ROW_HOVER = "hover:bg-slate-100 dark:hover:bg-slate-800";
// Frozen cells paint their own background over the months, so they follow the row's hover.
const FROZEN_HOVER = "group-hover:bg-slate-100 dark:group-hover:bg-slate-800";

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

function DesktopTable(props: { grid: Grid; lastMonth: number; tone: "income" | "expense"; scroll: HorizontalScroll; cellHref?: CellHref; printing?: boolean }) {
  // Nothing scrolls on paper: the frozen columns size to their content, leaving the width to the months.
  // Sixteen columns with cents are wider than a landscape page, so paper gets whole euros, as the
  // TUI's PDF did, and no sparkline: the months it sums up are printed beside it.
  const pin = (i: number) => (props.printing ? undefined : frozen(i));
  const whole = props.printing;
  const trend = !props.printing;
  const row = (r: GridRow, isTotal = false) => {
    const trends = trendsFor(r, props.tone, isTotal);
    const cat = isTotal ? null : r.category;
    const yearHref = props.cellHref?.(cat, null);
    const hover = props.cellHref ? FROZEN_HOVER : "";
    return (
      <tr key={r.category} className={`${isTotal ? "font-semibold" : "border-t border-slate-100 dark:border-slate-800"} ${props.cellHref ? `group ${ROW_HOVER}` : ""}`}>
        <th scope="row" style={pin(0)} className={`${FROZEN_CLASS} ${hover} py-1.5 pr-3 text-left font-medium`}><Linked to={yearHref}>{r.category}</Linked></th>
        <td style={pin(1)} className={`${FROZEN_CLASS} ${hover} px-2 text-right whitespace-nowrap`}><Linked to={yearHref}>{formatCents(r.totalCents, { whole })}</Linked></td>
        <td style={pin(2)} className={`${FROZEN_CLASS} ${hover} px-2 text-right whitespace-nowrap`}><Linked to={yearHref}>{formatCents(averageCents(r, isTotal), { whole })}</Linked></td>
        {trend && <td style={pin(3)} className={`${FROZEN_CLASS} ${hover} ${EDGE} px-2`}>{!isTotal && <Sparkline values={r.months.slice(0, props.lastMonth)} label={`${r.category} by month`} />}</td>}
        {r.months.slice(0, props.lastMonth).map((c, i) => <td key={i} className="px-2 text-right whitespace-nowrap">
          <Linked to={c.amountCents ? props.cellHref?.(cat, i + 1) : undefined}><Amount cell={c} trend={trends[i]} whole={whole} /></Linked>
        </td>)}
      </tr>
    );
  };
  const fade = "pointer-events-none absolute inset-y-0 z-20 w-8 from-white to-transparent dark:from-slate-950";
  return (
    <div className="relative">
      {/* Fades over the months say there are more off that edge. */}
      {props.scroll.canLeft && <div data-testid="fade-left" className={`${fade} bg-linear-to-r`} style={{ left: FROZEN_WIDTH }} />}
      {props.scroll.canRight && <div data-testid="fade-right" className={`${fade} right-0 bg-linear-to-l`} />}
      <div ref={props.scroll.ref} className="overflow-x-auto print:overflow-visible">
        <table className="print-dense w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th style={pin(0)} className={`${FROZEN_CLASS} text-left`}>Category</th>
              <th style={pin(1)} className={`${FROZEN_CLASS} px-2 text-right font-normal`}>Total</th>
              <th style={pin(2)} className={`${FROZEN_CLASS} px-2 text-right font-normal`}>Average</th>
              {trend && <th style={pin(3)} className={`${FROZEN_CLASS} ${EDGE} px-2 text-left font-normal`}>Trend</th>}
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

function PhoneRows(props: { grid: Grid; lastMonth: number; tone: "income" | "expense"; cellHref?: CellHref }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {props.grid.rows.map((r) => (
        <li key={r.category} className="py-2">
          <button type="button" aria-expanded={open === r.category}
            onClick={() => setOpen(open === r.category ? null : r.category)}
            className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.category}</span>
              <span className="text-xs text-slate-500">{formatCents(r.totalCents)} · avg {formatCents(averageCents(r))}</span>
            </span>
            <Sparkline values={r.months.slice(0, props.lastMonth)} label={`${r.category} by month`} />
          </button>
          {open === r.category && (
            <>
              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
                {r.months.slice(0, props.lastMonth).map((c, i) => (
                  <div key={i} className="flex justify-between">
                    <dt className="text-slate-500">{MONTHS[i]}</dt>
                    <dd>
                      <Linked to={c.amountCents ? props.cellHref?.(r.category, i + 1) : undefined}>
                        <Amount cell={c} trend={trendsFor(r, props.tone)[i]} />
                      </Linked>
                    </dd>
                  </div>
                ))}
              </dl>
              {props.cellHref && (
                <Link to={props.cellHref(r.category, null)} className="mt-2 block text-xs underline">
                  All {r.category} transactions
                </Link>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** `lastMonth` is the latest month with data (1–12): later months would be empty columns. */
export function MonthlyGrid(props: { title: string; grid: Grid; tone: "income" | "expense"; lastMonth: number; cellHref?: CellHref }) {
  // Paper gets the table at any width: nothing on it can be opened.
  const printing = usePrinting();
  const table = useMediaQuery(DESKTOP) || printing;
  const scroll = useHorizontalScroll(props.grid);
  const overflows = table && (scroll.canLeft || scroll.canRight);
  // Three month columns per press.
  const step = () => 3 * (scroll.ref.current?.querySelector<HTMLElement>("th[data-month]")?.offsetWidth || 90);
  const arrow = "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 dark:border-slate-700 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400">{props.title}</h2>
        {overflows && (
          <div className="flex gap-1 text-sm print:hidden">
            <button type="button" aria-label="Earlier months" disabled={!scroll.canLeft}
              onClick={() => scroll.scrollBy(-step())} className={arrow}><Chevron dir="left" size={20} /></button>
            <button type="button" aria-label="Later months" disabled={!scroll.canRight}
              onClick={() => scroll.scrollBy(step())} className={arrow}><Chevron dir="right" size={20} /></button>
          </div>
        )}
      </div>
      {props.grid.rows.length === 0
        ? <p className="text-sm text-slate-500">Nothing this year.</p>
        : table
          ? <DesktopTable grid={props.grid} lastMonth={props.lastMonth} tone={props.tone} scroll={scroll} cellHref={props.cellHref} printing={printing} />
          : <PhoneRows grid={props.grid} lastMonth={props.lastMonth} tone={props.tone} cellHref={props.cellHref} />}
    </section>
  );
}
