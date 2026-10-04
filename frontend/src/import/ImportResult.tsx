import { Link } from "react-router";

import { toTransactionsSearch } from "../lib/types";
import type { FileRow } from "./importList";

/** One line per file of the run, a total, Gemini's answer, and where to go next. */
export function ImportResult(props: {
  rows: FileRow[]; gemini: { message: string; ok: boolean } | null; asking: boolean;
  onAskAgain: () => void; onStartOver: () => void;
}) {
  const done = props.rows.filter((r) => r.run.state === "done");
  const total = (pick: (r: { inserted: number; duplicates: number; suppressedDeleted: number }) => number) =>
    done.reduce((n, r) => n + (r.run.state === "done" ? pick(r.run.result) : 0), 0);
  const dates = done.flatMap((r) => r.parsed?.rows.map((x) => x.date) ?? []).sort();
  const view = dates.length > 0
    ? `/transactions?${toTransactionsSearch({ from: dates[0], to: dates[dates.length - 1], sources: [...new Set(done.map((r) => r.source))] })}`
    : null;
  const cell = "px-2 py-1 text-right tabular-nums";
  return (
    <section aria-label="Import result" className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-slate-500"><tr>
            <th className="px-2 py-1 text-left font-medium">File</th><th className="px-2 py-1 text-left font-medium">Source</th>
            <th className={cell}>Imported</th><th className={cell}>Already there</th><th className={cell}>Deleted</th>
          </tr></thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-1">{r.file.name}</td><td className="px-2 py-1">{r.source}</td>
                {r.run.state === "done" ? (
                  <><td className={cell}>{r.run.result.inserted}</td><td className={cell}>{r.run.result.duplicates}</td><td className={cell}>{r.run.result.suppressedDeleted}</td></>
                ) : <td colSpan={3} className="px-2 py-1 text-right text-expense">Not imported</td>}
              </tr>
            ))}
            <tr className="font-medium">
              <td className="px-2 py-1">Total</td><td />
              <td className={cell}>{total((x) => x.inserted)}</td><td className={cell}>{total((x) => x.duplicates)}</td><td className={cell}>{total((x) => x.suppressedDeleted)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {props.asking && <p>Asking Gemini…</p>}
      {props.gemini && (
        <p className={props.gemini.ok ? "" : "text-expense"}>
          {props.gemini.message}
          {!props.gemini.ok && <button type="button" onClick={props.onAskAgain} className="ml-2 underline">Retry</button>}
        </p>
      )}
      <p className="flex flex-wrap gap-4">
        {view && <Link to={view} className="underline">View in Transactions</Link>}
        {props.gemini?.ok && <Link to="/merchants?attention=suggested" className="underline">Review suggestions</Link>}
        <button type="button" onClick={props.onStartOver} className="underline">Start over</button>
      </p>
    </section>
  );
}
