import { useEffect, useState } from "react";
import { Sheet } from "../../lib/Sheet";
import type { TransactionRow } from "../../lib/types";
import { SheetError, useSheetSubmit } from "../../lib/useSheetSubmit";
import { useTag } from "./mutations";
import { splitTags, TagInput } from "./TagInput";

export function TagSheet(props: {
  mode: "add" | "remove" | null; ids: number[]; rows: TransactionRow[]; known: string[];
  onClose: () => void; onDone: (message: string) => void;
}) {
  const tag = useTag();
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const adding = props.mode === "add";
  const submitter = useSheetSubmit(tag, ({ tagged }) => {
    props.onDone(`${adding ? "Tagged" : "Untagged"} ${tagged}`);
    props.onClose();
  });
  useEffect(() => { setTags([]); setDraft(""); submitter.reset(); }, [props.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = new Set(props.ids);
  const carried = [...new Set(props.rows.filter((r) => chosen.has(r.id)).flatMap((r) => splitTags(r.tags)))].sort();
  // Text still in the box counts, so "Trip" typed without Enter is not lost.
  const all = [...new Set([...tags, ...splitTags(draft)])];
  const n = props.ids.length;

  const submit = () => {
    if (!props.mode || all.length === 0) return;
    submitter.run({ ids: props.ids, tags: all, mode: props.mode });
  };

  return (
    <Sheet title={`${adding ? "Tag" : "Untag"} ${n} transactions`} open={props.mode !== null} onClose={props.onClose} busy={tag.isPending}>
      <TagInput label="Tags" value={tags} onChange={setTags} draft={draft} onDraft={setDraft}
        suggestions={adding ? props.known : carried} autoFocus />
      <SheetError submit={submitter} onRetry={submit} />
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={all.length === 0 || tag.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {tag.isPending ? `${adding ? "Tagging" : "Untagging"} ${n}…` : adding ? "Add tags" : "Remove tags"}
        </button>
      </div>
    </Sheet>
  );
}
