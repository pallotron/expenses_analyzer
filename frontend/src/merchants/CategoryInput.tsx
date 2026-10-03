import { useId } from "react";

/** A category by name: pick one in use or type a new one. Empty means none chosen. */
export function CategoryInput(props: { value: string; onChange: (v: string) => void; categories: string[]; autoFocus?: boolean }) {
  const listId = useId();
  // "Other" is what no category reads as; it is not one you can choose.
  const choices = props.categories.filter((c) => c !== "Other");
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-slate-500">Category</span>
      <input list={listId} value={props.value} autoFocus={props.autoFocus} placeholder="No category"
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900" />
      <datalist id={listId}>{choices.map((c) => <option key={c} value={c} />)}</datalist>
    </label>
  );
}
