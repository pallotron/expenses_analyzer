/** Shown while merchants are selected: on phones pinned to the bottom, on desktop in the frozen controls. */
export function MerchantActionBar(props: {
  count: number; total: number; busy?: boolean;
  onSelectAll: () => void; onSetCategory: () => void; onClearCategory: () => void; onCancel: () => void;
}) {
  const btn = "rounded-md disabled:opacity-50 border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800";
  return (
    <section aria-label="Selected merchants"
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white p-3 text-sm shadow-[0_-2px_8px_rgba(0,0,0,0.06)] md:static md:rounded-lg md:border md:shadow-none dark:border-slate-800 dark:bg-slate-950">
      <span className="font-medium">{props.count} selected</span>
      {props.count < props.total && (
        <button type="button" onClick={props.onSelectAll} className="underline">Select all {props.total}</button>
      )}
      <span className="flex-1" />
      <button type="button" onClick={props.onSetCategory} disabled={props.busy} className={btn}>Set category</button>
      <button type="button" onClick={props.onClearCategory} disabled={props.busy} className={btn}>Clear category</button>
      <button type="button" onClick={props.onCancel} className="px-2 py-1.5 underline">Cancel</button>
    </section>
  );
}
