import { useState } from "react";
import { formatCents } from "../lib/money";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";

/**
 * Sources and the hidden-tags switch. On a phone both sit behind one
 * "Filters (n)" button that opens a panel; on desktop every source is an
 * inline checkbox, with the switch on the line below. Undefined patterns: not
 * loaded yet.
 */
export function FiltersBar(props: {
  sources: string[];
  selected: string[] | undefined;
  hidden: boolean;
  hiddenCents: number;
  excludedPatterns: string[] | undefined;
  onSources: (s: string[] | undefined) => void;
  onHidden: (h: boolean) => void;
}) {
  const desktop = useMediaQuery(DESKTOP);
  const [open, setOpen] = useState(false);
  const chosen = props.selected ?? props.sources;
  const toggle = (s: string) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    props.onSources(next.length === props.sources.length ? undefined : next);
  };
  const patterns = props.excludedPatterns ?? [];
  const list = patterns.join(", ");
  // The switch stays while it is on, so it can always be turned off.
  const showSwitch = patterns.length > 0 || props.hidden;
  const active = (props.selected !== undefined ? 1 : 0) + (props.hidden ? 1 : 0);

  const tagStatus = props.excludedPatterns === undefined
    ? ""
    : patterns.length === 0
      ? "No tags excluded"
      : props.hidden
        ? `Including all (${list} not applied)`
        : `Excluding ${list} · ${formatCents(props.hiddenCents)} hidden`;

  const allNone = (
    <span className="flex gap-2">
      <button type="button" className="underline" onClick={() => props.onSources(undefined)}>All</button>
      <button type="button" className="underline" onClick={() => props.onSources([])}>None</button>
    </span>
  );
  const boxes = props.sources.map((s) => (
    <label key={s} className={desktop
      ? `flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 ${chosen.includes(s)
        ? "border-slate-400 dark:border-slate-500"
        : "border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500"}`
      : "flex items-center gap-2 py-0.5"}>
      <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
      {s}
    </label>
  ));
  const sourceList = desktop ? (
    <div role="group" aria-label="Sources" className="flex flex-wrap items-center gap-2">
      <span className="text-slate-600 dark:text-slate-400">Sources:</span>
      {boxes}
      {allNone}
    </div>
  ) : (
    <div role="group" aria-label="Sources" className="w-full">
      <div className="mb-2">{allNone}</div>
      {boxes}
    </div>
  );

  const hiddenSwitch = showSwitch && (
    <label className="flex items-center gap-2">
      <button type="button" role="switch" aria-checked={props.hidden} aria-label="Include hidden tags"
        onClick={() => props.onHidden(!props.hidden)}
        className={`h-5 w-9 rounded-full transition-colors ${props.hidden ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-300 dark:bg-slate-700"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform dark:bg-slate-900 ${props.hidden ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
  const status = <span className="text-slate-600 dark:text-slate-400">{tagStatus}</span>;

  if (!desktop) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="self-start rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700">
          Filters ({active})
        </button>
        {open && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
            {sourceList}
            {hiddenSwitch}
            {status}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {sourceList}
      <div className="flex flex-wrap items-center gap-2">
        {hiddenSwitch}
        {status}
      </div>
    </div>
  );
}
