import { useEffect, useState } from "react";
import { Sheet } from "../lib/Sheet";
import { SheetError, useSheetSubmit } from "../lib/useSheetSubmit";
import { CategoryInput } from "./CategoryInput";
import { merchantCount } from "./count";
import { useSetMerchantCategory } from "./mutations";

export function SetCategorySheet(props: {
  ids: number[] | null; categories: string[]; onClose: () => void; onDone: (message: string) => void;
}) {
  const set = useSetMerchantCategory();
  const [category, setCategory] = useState("");
  const submitter = useSheetSubmit(set, ({ updated }, vars) => {
    props.onDone(`Set ${vars.category} on ${merchantCount(updated)}`);
    props.onClose();
  });
  useEffect(() => { setCategory(""); submitter.reset(); }, [props.ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = category.trim();
  const submit = () => {
    if (!props.ids || name === "") return;
    submitter.run({ ids: props.ids, category: name });
  };

  return (
    <Sheet title={`Set category on ${merchantCount(props.ids?.length ?? 0)}`} open={props.ids !== null}
      onClose={props.onClose} busy={set.isPending}>
      <CategoryInput value={category} onChange={setCategory} categories={props.categories} autoFocus />
      <SheetError submit={submitter} onRetry={submit} />
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={name === "" || set.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {set.isPending ? "Setting…" : "Set category"}
        </button>
      </div>
    </Sheet>
  );
}
