import { useState } from "react";
import { formatCents } from "../lib/money";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";

export interface BreakdownItem {
  label: string;
  sublabel?: string;
  amountCents: number;
  count?: number;
  /** Colours the bar: what the money was. Without it the list's tone is used. */
  kind?: "essential" | "discretionary" | "income";
}

const BAR_COLOUR = { essential: "bg-essential", discretionary: "bg-discretionary", income: "bg-income" };

/** A ranked list with proportional bars: categories, merchants, income sources. */
export function BreakdownList(props: {
  title: string;
  items: BreakdownItem[];
  showShare?: boolean;
  limit?: number;
  tone: "income" | "expense";
  /** On a phone the list starts collapsed behind its header; desktop always shows it. */
  collapsible?: boolean;
}) {
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const desktop = useMediaQuery(DESKTOP);
  const toggles = !!props.collapsible && !desktop;
  const open = !toggles || expanded;
  const total = props.items.reduce((a, i) => a + i.amountCents, 0);
  const max = Math.max(1, ...props.items.map((i) => i.amountCents));
  const shown = props.limit && !all ? props.items.slice(0, props.limit) : props.items;
  const heading = (
    <>
      <span>{props.title}</span>
      <span>{formatCents(total)}</span>
    </>
  );

  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className={`${open ? "mb-3" : ""} text-sm font-semibold text-slate-600 dark:text-slate-400`}>
        {toggles ? (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}
            className="flex w-full justify-between">
            {heading}
          </button>
        ) : (
          <div className="flex justify-between">{heading}</div>
        )}
      </h2>
      {open && (props.items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {item.label}
                  {item.sublabel && <span className="ml-1.5 text-xs text-slate-500">{item.sublabel}</span>}
                </span>
                <span className="shrink-0">
                  {formatCents(item.amountCents)}
                  {props.showShare && total > 0 && (
                    <span className="ml-1.5 text-xs text-slate-500">{((item.amountCents / total) * 100).toFixed(1)}%</span>
                  )}
                  {item.count !== undefined && <span className="ml-1.5 text-xs text-slate-500">×{item.count}</span>}
                </span>
              </div>
              {!(item.kind === "income" && item.amountCents < total / 100) && (
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div data-testid="bar"
                    className={`h-1.5 rounded-full ${item.kind ? BAR_COLOUR[item.kind] : props.tone === "income" ? "bg-income" : "bg-expense"}`}
                    style={{ width: `${Math.min(100, Math.max(0, (item.amountCents / max) * 100))}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}
      {open && props.limit !== undefined && props.items.length > props.limit && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 text-sm underline">
          {all ? "Show fewer" : `Show all ${props.items.length}`}
        </button>
      )}
    </section>
  );
}
