import { useState } from "react";
import { Link } from "react-router";
import { Chevron } from "../lib/Chevron";
import { formatCents } from "../lib/money";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";

export interface BreakdownItem {
  label: string;
  sublabel?: string;
  amountCents: number;
  /** Merchants: how many payments. Moves the sublabel to a line of its own. */
  count?: number;
  /** Colours the bar: what the money was. Without it the list's tone is used. */
  kind?: "essential" | "discretionary" | "income";
  /** The transactions behind the amount; makes the label a link. */
  href?: string;
}

const BAR_COLOUR = { essential: "bg-essential", discretionary: "bg-discretionary", income: "bg-income" };

const payments = (n: number) => `${n} ${n === 1 ? "payment" : "payments"}`;

/** A ranked list with proportional bars: categories, merchants, income sources. */
export function BreakdownList(props: {
  title: string;
  items: BreakdownItem[];
  showShare?: boolean;
  limit?: number;
  tone: "income" | "expense";
  /** On a phone the list starts collapsed behind its header; desktop always shows it. */
  collapsible?: boolean;
  /**
   * Items below this share of the total (e.g. 0.01) fold into one "Smaller
   * items" row, opened on request. Needs at least two such items.
   */
  foldBelow?: number;
}) {
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [smallOpen, setSmallOpen] = useState(false);
  const desktop = useMediaQuery(DESKTOP);
  const toggles = !!props.collapsible && !desktop;
  const open = !toggles || expanded;
  const total = props.items.reduce((a, i) => a + i.amountCents, 0);
  const max = Math.max(1, ...props.items.map((i) => i.amountCents));

  const isSmall = (i: BreakdownItem) => props.foldBelow !== undefined && i.amountCents < total * props.foldBelow;
  const smallCount = props.items.filter(isSmall).length;
  const folding = smallCount >= 2;
  const main = folding ? props.items.filter((i) => !isSmall(i)) : props.items;
  const small = folding ? props.items.filter(isSmall) : [];
  const shown = props.limit && !all ? main.slice(0, props.limit) : main;

  const row = (item: BreakdownItem) => (
    // A linked row is clickable all over: the label's link stretches across it.
    <li key={item.label} className={item.href ? "group relative -mx-2 rounded-md px-2 py-0.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" : "text-sm"}>
      <div className="flex justify-between gap-3">
        <span className="min-w-0 truncate">
          {item.href ? <Link to={item.href} className="after:absolute after:inset-0 after:content-['']">{item.label}</Link> : item.label}
          {item.sublabel && item.count === undefined && <span className="ml-1.5 text-xs text-slate-500">{item.sublabel}</span>}
        </span>
        <span className="shrink-0">
          {formatCents(item.amountCents)}
          {props.showShare && total > 0 && (
            <span className="ml-1.5 text-xs text-slate-500">{((item.amountCents / total) * 100).toFixed(1)}%</span>
          )}
        </span>
      </div>
      {item.count !== undefined && (
        <div className="truncate text-xs text-slate-500">
          {[item.sublabel, payments(item.count)].filter(Boolean).join(" · ")}
        </div>
      )}
      {!(item.kind === "income" && item.amountCents < total / 100) && (
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 group-hover:bg-slate-200 dark:bg-slate-800 dark:group-hover:bg-slate-700">
          <div data-testid="bar"
            className={`h-1.5 rounded-full ${item.kind ? BAR_COLOUR[item.kind] : props.tone === "income" ? "bg-income" : "bg-expense"}`}
            style={{ width: `${Math.min(100, Math.max(0, (item.amountCents / max) * 100))}%` }} />
        </div>
      )}
    </li>
  );

  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      {/* No total here: the cash-flow tiles above already show it. */}
      <h2 className={`${open ? "mb-3" : ""} text-sm font-semibold text-slate-600 dark:text-slate-400`}>
        {toggles ? (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}
            className="flex w-full justify-between">
            <span>{props.title}</span>
            <Chevron dir={expanded ? "down" : "right"} size={14} />
          </button>
        ) : props.title}
      </h2>
      {open && (props.items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map(row)}
          {folding && (!props.limit || all || main.length <= props.limit) && (
            <li className="text-sm">
              <button type="button" aria-expanded={smallOpen} onClick={() => setSmallOpen((o) => !o)}
                className="flex w-full justify-between gap-3 text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1"><Chevron dir={smallOpen ? "down" : "right"} size={14} /> Smaller items ({small.length})</span>
                <span>{formatCents(small.reduce((a, i) => a + i.amountCents, 0))}</span>
              </button>
              {smallOpen && <ul className="mt-2 flex flex-col gap-2 pl-4">{small.map(row)}</ul>}
            </li>
          )}
        </ul>
      ))}
      {open && props.limit !== undefined && main.length > props.limit && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 text-sm underline">
          {all ? "Show fewer" : `Show all ${main.length}`}
        </button>
      )}
    </section>
  );
}
