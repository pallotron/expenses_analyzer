import { useState } from "react";
import { formatCents } from "../lib/money";

/**
 * Sources and the hidden-tags switch. On a phone both sit behind one
 * "Filters" button; on desktop the sources open as a small popover.
 */
export function FiltersBar(props: {
  sources: string[];
  selected: string[] | undefined;
  hidden: boolean;
  hiddenCents: number;
  excludedPatterns: string[];
  onSources: (s: string[] | undefined) => void;
  onHidden: (h: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = props.selected ?? props.sources;
  const toggle = (s: string) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    props.onSources(next.length === props.sources.length ? undefined : next);
  };
  const label = props.selected === undefined ? "all" : `${props.selected.length} of ${props.sources.length}`;
  const patterns = props.excludedPatterns.join(", ");

  const tagStatus = props.excludedPatterns.length === 0
    ? "No tags excluded"
    : props.hidden
      ? `Including all (${patterns} not applied)`
      : `Excluding ${patterns} · ${formatCents(props.hiddenCents)} hidden`;

  return (
    <div className="relative flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700">
        Sources: {label} ▾
      </button>
      {open && (
        <div role="group" aria-label="Sources"
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex gap-2">
            <button type="button" className="underline" onClick={() => props.onSources(undefined)}>All</button>
            <button type="button" className="underline" onClick={() => props.onSources([])}>None</button>
          </div>
          {props.sources.map((s) => (
            <label key={s} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
      )}
      {props.excludedPatterns.length > 0 && (
        <label className="flex items-center gap-2">
          <button type="button" role="switch" aria-checked={props.hidden} aria-label="Include hidden tags"
            onClick={() => props.onHidden(!props.hidden)}
            className={`h-5 w-9 rounded-full transition-colors ${props.hidden ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-300 dark:bg-slate-700"}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition-transform dark:bg-slate-900 ${props.hidden ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </label>
      )}
      <span className="text-slate-600 dark:text-slate-400">{tagStatus}</span>
    </div>
  );
}
