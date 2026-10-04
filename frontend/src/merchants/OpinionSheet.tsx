import { useState } from "react";
import { Sheet } from "../lib/Sheet";
import type { AskAnswer, AskResponse } from "../lib/types";
import { SheetError, useSheetSubmit } from "../lib/useSheetSubmit";
import { merchantCount } from "./count";
import { useApplyCategories } from "./mutations";

/** Same category in another case is agreement, not a change. */
const agrees = (a: AskAnswer) => (a.current ?? "").toLowerCase() === a.suggested.toLowerCase();

/**
 * Gemini's second opinion on the selected merchants. Nothing is saved until
 * Apply, and only the ticked disagreements; closing throws the answers away.
 */
export function OpinionSheet(props: { opinion: AskResponse | null; onClose: () => void; onDone: (message: string) => void }) {
  const apply = useApplyCategories();
  const total = props.opinion ? props.opinion.answers.length + props.opinion.unanswered : 0;
  return (
    <Sheet title={`Gemini's opinion on ${merchantCount(total)}`} open={props.opinion !== null}
      onClose={props.onClose} busy={apply.isPending}>
      {/* Keyed on the answers, so each new opinion starts with nothing ticked. */}
      {props.opinion && <Opinion key={JSON.stringify(props.opinion)} opinion={props.opinion} apply={apply}
        onApplied={(message) => { props.onDone(message); props.onClose(); }} />}
    </Sheet>
  );
}

function Opinion(props: {
  opinion: AskResponse; apply: ReturnType<typeof useApplyCategories>; onApplied: (message: string) => void;
}) {
  const changes = props.opinion.answers.filter((a) => !agrees(a));
  const same = props.opinion.answers.filter(agrees);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const submitter = useSheetSubmit(props.apply, ({ updated }) => props.onApplied(`Changed ${merchantCount(updated)}`));
  const chosen = changes.filter((a) => ticked.has(a.id));
  const submit = () => submitter.run(chosen.map((a) => ({ id: a.id, category: a.suggested })));
  const toggle = (id: number) => setTicked((t) => {
    const next = new Set(t);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <>
      {changes.length === 0 ? (
        <p className="text-sm">Gemini agrees with every category.</p>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">Tick the changes to make.</p>
          <ul className="flex flex-col">
            {changes.map((a) => {
              const current = a.current ?? "Uncategorized";
              return (
                <li key={a.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3"
                    aria-label={`${a.name}: ${current} → ${a.suggested}${a.isNew ? " (new)" : ""}`}>
                    <input type="checkbox" checked={ticked.has(a.id)} onChange={() => toggle(a.id)} />
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-slate-500">{current} →</span>
                      <span>{a.suggested}</span>
                      {a.isNew && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-800">new</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {same.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Agrees on {same.length}</summary>
          <ul className="mt-1 pl-4">
            {same.map((a) => <li key={a.id}>{a.name} · {a.current}</li>)}
          </ul>
        </details>
      )}
      {props.opinion.unanswered > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-400">No answer for {props.opinion.unanswered}</p>
      )}
      <SheetError submit={submitter} onRetry={submit} />
      {changes.length > 0 && (
        <div className="flex justify-end">
          <button type="button" onClick={submit} disabled={chosen.length === 0 || props.apply.isPending}
            className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            {props.apply.isPending ? "Applying…" : `Apply (${chosen.length})`}
          </button>
        </div>
      )}
    </>
  );
}
