// frontend/src/transactions/SourcePills.tsx
/**
 * The source checkboxes, as on the Summary: undefined means every source,
 * and ticking the last one goes back to undefined so the URL stays clean.
 */
export function SourcePills(props: {
  sources: string[];
  selected: string[] | undefined;
  onChange: (s: string[] | undefined) => void;
  compact?: boolean;
}) {
  const chosen = props.selected ?? props.sources;
  const toggle = (s: string) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    props.onChange(next.length === props.sources.length ? undefined : next);
  };
  return (
    <div role="group" aria-label="Sources" className="flex flex-wrap items-center gap-2">
      <span className="text-slate-600 dark:text-slate-400">Sources:</span>
      {props.sources.map((s) => (
        <label key={s} className={props.compact
          ? "flex items-center gap-2 py-0.5"
          : `flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 ${chosen.includes(s)
            ? "border-slate-400 dark:border-slate-500"
            : "border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500"}`}>
          <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
          {s}
        </label>
      ))}
      <button type="button" className="underline" onClick={() => props.onChange(undefined)}>All</button>
      <button type="button" className="underline" onClick={() => props.onChange([])}>None</button>
    </div>
  );
}
