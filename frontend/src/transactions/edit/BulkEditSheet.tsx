import { useEffect, useId, useState } from "react";
import { Sheet } from "../../lib/Sheet";
import { SheetError, useSheetSubmit } from "../../lib/useSheetSubmit";
import type { BulkEdit, LookupsResponse, TransactionType } from "../../lib/types";
import { CategorySelect, KEEP, toCategoryEdit } from "./CategorySelect";
import { useBulkEdit } from "./mutations";

const field = "rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900";
const was = (n: number) => `${n} ${n === 1 ? "was" : "were"}`;

export function BulkEditSheet(props: {
  ids: number[] | null; lookups: LookupsResponse | undefined; onClose: () => void; onDone: (message: string) => void;
}) {
  const save = useBulkEdit();
  const [merchant, setMerchant] = useState("");
  const [type, setType] = useState<"" | TransactionType>("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState(KEEP);
  const submitter = useSheetSubmit(save, ({ updated }, { ids }) => {
    const gone = ids.length - updated;
    props.onDone(gone > 0 ? `Updated ${updated} of ${ids.length} (${was(gone)} already gone)` : `Updated ${updated}`);
    props.onClose();
  });
  const sourcesId = useId();
  useEffect(() => {
    setMerchant(""); setType(""); setSource(""); setCategory(KEEP); submitter.reset();
  }, [props.ids]);

  // Only the fields set away from "Leave unchanged"; spaces alone count as unchanged.
  const edit: BulkEdit = {
    ...(merchant.trim() && { merchant: merchant.trim() }),
    ...(type && { type }),
    ...(source.trim() && { source: source.trim() }),
    ...(category !== KEEP && { category: toCategoryEdit(category) }),
  };
  const n = props.ids?.length ?? 0;
  const changed = Object.keys(edit).length > 0;

  const submit = () => {
    if (!props.ids || !changed) return;
    submitter.run({ ids: props.ids, edit });
  };

  return (
    <Sheet title={`Edit ${n} transactions`} open={props.ids !== null} onClose={props.onClose} busy={save.isPending}>
      <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Statement text</span>
          <input autoFocus value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Leave unchanged" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as "" | TransactionType)} className={field}>
            <option value="">Leave unchanged</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Source</span>
          <input list={sourcesId} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Leave unchanged" className={field} />
          <datalist id={sourcesId}>{props.lookups?.sources.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <CategorySelect value={category} onChange={setCategory} categories={props.lookups?.categories ?? []} allowKeep />
        <SheetError submit={submitter} onRetry={submit} />
        <div className="flex justify-end">
          <button type="submit" disabled={!changed || save.isPending}
            className="rounded-md bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            {save.isPending ? `Saving ${n}…` : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
