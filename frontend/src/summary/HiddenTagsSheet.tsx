import { useState } from "react";
import { Sheet } from "../lib/Sheet";
import { SheetError, useSheetSubmit } from "../lib/useSheetSubmit";
import { useLookups } from "../transactions/queries";
import { patternOptions } from "./hiddenTags";
import { useSaveHiddenTags } from "./mutations";

/** Pick which tag patterns the Summary hides (the TUI's Shift+X). */
export function HiddenTagsSheet(props: {
  open: boolean; excluded: string[]; onClose: () => void; onSaved: (patterns: string[]) => void;
}) {
  const save = useSaveHiddenTags();
  return (
    <Sheet title="Hidden tags" open={props.open} onClose={props.onClose} busy={save.isPending}>
      {/* Mounted only while open, so each opening starts from the saved list. */}
      <PatternPicker save={save} excluded={props.excluded} onSaved={(p) => { props.onSaved(p); props.onClose(); }} />
    </Sheet>
  );
}

function PatternPicker(props: {
  save: ReturnType<typeof useSaveHiddenTags>; excluded: string[]; onSaved: (patterns: string[]) => void;
}) {
  const lookups = useLookups();
  const options = patternOptions(lookups.data?.tags ?? [], props.excluded);
  const [ticked, setTicked] = useState(() => new Set(props.excluded));
  const submitter = useSheetSubmit(props.save, ({ patterns }) => props.onSaved(patterns));
  const submit = () => submitter.run({ patterns: options.map((o) => o.pattern).filter((p) => ticked.has(p)) });
  const toggle = (p: string) => setTicked((t) => {
    const next = new Set(t);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  if (lookups.isPending) return <p className="text-sm text-slate-600 dark:text-slate-400" aria-busy="true">Loading tags…</p>;
  if (lookups.error) {
    return (
      <p role="alert" className="text-sm text-expense">
        Couldn't load the tags: {lookups.error.message}
        <button type="button" onClick={() => lookups.refetch()} className="ml-2 underline">Retry</button>
      </p>
    );
  }
  return (
    <>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {options.length === 0 ? "No tags in use" : "Ticked patterns are hidden from Summary totals. A pattern ending in * hides every tag that starts with it."}
      </p>
      {options.length > 0 && (
        <ul className="flex flex-col">
          {options.map((o) => (
            <li key={o.pattern}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={ticked.has(o.pattern)} onChange={() => toggle(o.pattern)} />
                <span className="font-mono text-sm">{o.pattern}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <SheetError submit={submitter} onRetry={submit} />
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={props.save.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {props.save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
