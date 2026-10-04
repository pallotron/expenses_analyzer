import { useState } from "react";
import { Link } from "react-router";

import { ApiError } from "../lib/api";
import { MAX_IMPORT_ROWS, toTransactionsSearch, type ImportResponse } from "../lib/types";
import { useSuggestCategories } from "../merchants/mutations";
import { suggestMessage } from "../merchants/suggest";
import { useLookups } from "../transactions/queries";
import type { ImportReady } from "./ImportPage";
import { useImport } from "./queries";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summary(r: ImportResponse): string {
  return `Imported ${r.inserted} · ${r.duplicates} already there · ${r.suppressedDeleted} previously deleted · `
    + plural(r.newMerchants.length, "new merchant");
}

/**
 * The Import button and what follows: the counts, Gemini's suggestions for
 * new merchants when asked, links onward, and the Worker's refusals.
 */
export function ImportAction(props: { ready: ImportReady; onReset: () => void }) {
  const { source, file, mapping, parsed } = props.ready;
  const lookups = useLookups();
  const run = useImport();
  const suggest = useSuggestCategories();
  const [askGemini, setAskGemini] = useState(true);
  const [result, setResult] = useState<{ response: ImportResponse; view: string } | null>(null);
  const [gemini, setGemini] = useState<{ message: string; ok: boolean } | null>(null);

  const geminiOn = lookups.data?.gemini === true;
  const n = parsed.rows.length;
  const askSuggestions = () => suggest.mutate(undefined, {
    onSuccess: (r) => setGemini({ message: suggestMessage(r), ok: r.suggested > 0 }),
    onError: (e) => setGemini({ message: e.message, ok: false }),
  });
  const submit = () => !run.isPending && run.mutate({
    source, filename: file.name, mapping,
    rows: parsed.rows.map(({ date, merchant, amountCents, type }) => ({ date, merchant, amountCents, type })),
  }, {
    onSuccess: (r) => {
      // The link follows what was imported, not whatever the inputs show later.
      const dates = parsed.rows.map((x) => x.date).sort();
      const view = `/transactions?${toTransactionsSearch({ from: dates[0], to: dates[dates.length - 1], sources: [source] })}`;
      setResult({ response: r, view });
      if (geminiOn && askGemini && r.newMerchants.length > 0) askSuggestions();
    },
  });

  if (result) {
    return (
      <section aria-label="Import result" className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
        <p>{summary(result.response)}</p>
        {suggest.isPending && <p>Asking Gemini…</p>}
        {gemini && (
          <p className={gemini.ok ? "" : "text-expense"}>
            {gemini.message}
            {!gemini.ok && suggest.isError && (
              <button type="button" onClick={() => { setGemini(null); askSuggestions(); }} className="ml-2 underline">Retry</button>
            )}
          </p>
        )}
        <p className="flex flex-wrap gap-4">
          <Link to={result.view} className="underline">View in Transactions</Link>
          {gemini?.ok && <Link to="/merchants?attention=suggested" className="underline">Review suggestions</Link>}
          <button type="button" onClick={props.onReset} className="underline">Import another file</button>
        </p>
      </section>
    );
  }

  const label = n === 0 ? "Nothing to import"
    : n > MAX_IMPORT_ROWS ? "Split the file: at most 5,000 rows per import"
      : run.isPending ? "Importing…" : `Import ${plural(n, "transaction")}`;
  const failure = run.error;
  return (
    <section aria-label="Import" className="flex flex-col gap-2">
      {geminiOn && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={askGemini} onChange={(e) => setAskGemini(e.target.checked)}
            aria-label="Suggest categories for new merchants" />
          Suggest categories for new merchants
        </label>
      )}
      {failure && (
        <div role="alert" className="text-sm text-expense">
          <p>{failure.message}</p>
          {failure instanceof ApiError && failure.errors && (
            <ul className="list-disc pl-5">{failure.errors.map((e, i) => <li key={`${i}:${e}`}>{e}</li>)}</ul>
          )}
        </div>
      )}
      <div>
        <button type="button" onClick={submit} disabled={n === 0 || n > MAX_IMPORT_ROWS || run.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {label}
        </button>
      </div>
    </section>
  );
}
