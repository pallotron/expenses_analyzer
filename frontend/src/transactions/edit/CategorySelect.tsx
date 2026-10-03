export const KEEP = "__keep__";

/** KEEP: leave alone; "": back to the merchant's category; else the override. */
export function toCategoryEdit(value: string): string | null | undefined {
  if (value === KEEP) return undefined;
  return value === "" ? null : value;
}

export function CategorySelect(props: {
  value: string; onChange: (v: string) => void; categories: string[]; merchantCategory?: string; allowKeep?: boolean;
}) {
  // "Other" is what no category reads as; it is not one you can choose.
  const choices = props.categories.filter((c) => c !== "Other");
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-slate-500">Category</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
        {props.allowKeep && <option value={KEEP}>Leave unchanged</option>}
        <option value="">{props.merchantCategory ? `From merchant (${props.merchantCategory})` : "From merchant"}</option>
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}
