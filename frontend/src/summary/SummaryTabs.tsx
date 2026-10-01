import { useRef, type KeyboardEvent } from "react";
import type { Tab } from "./params";

/**
 * Expenses / Income / Monthly. A WAI-ARIA tab list: the current tab is the
 * only one in the tab order, and the arrow keys move between tabs.
 */
export function SummaryTabs(props: { tabs: { id: Tab; label: string }[]; current: Tab; onChange: (t: Tab) => void }) {
  const refs = useRef(new Map<Tab, HTMLButtonElement>());
  const onKey = (e: KeyboardEvent) => {
    const i = props.tabs.findIndex((t) => t.id === props.current);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = props.tabs[(i + step + props.tabs.length) % props.tabs.length].id;
    props.onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div role="tablist" aria-label="Summary sections" onKeyDown={onKey}
      className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {props.tabs.map((t) => {
        const selected = t.id === props.current;
        return (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`}
            aria-selected={selected} tabIndex={selected ? 0 : -1}
            ref={(el) => { if (el) refs.current.set(t.id, el); else refs.current.delete(t.id); }}
            onClick={() => props.onChange(t.id)}
            className={`-mb-px flex-1 border-b-2 px-4 py-2 text-sm md:flex-none ${selected
              ? "border-slate-900 font-semibold dark:border-slate-100"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
