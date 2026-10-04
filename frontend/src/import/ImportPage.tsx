import { useMemo, useReducer, useRef, useState } from "react";

import { useLookups } from "../transactions/queries";
import { FileRowView } from "./FileRow";
import { readGrid } from "./grid";
import { importList, isReady, rowStatus, type SavedMappings } from "./importList";
import { ImportResult } from "./ImportResult";
import { useImportSources } from "./queries";
import { useDryRun } from "./useDryRun";
import { useImportAll } from "./useImportAll";

/**
 * A month's statements at once: each file gets a source picked by hand and
 * is checked by a dry run; nothing is saved until Import.
 */
export function ImportPage() {
  const lookups = useLookups();
  const sources = useImportSources();
  const [rows, dispatch] = useReducer(importList, []);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  const [askGemini, setAskGemini] = useState(true);
  const geminiOn = lookups.data?.gemini === true;
  const run = useImportAll(rows, dispatch, geminiOn && askGemini);
  const running = run.running;
  const dry = useDryRun(rows, dispatch, running);

  const saved = useMemo<SavedMappings>(() => Object.fromEntries(
    (sources.data?.sources ?? []).filter((s) => s.mapping).map((s) => [s.name, s.mapping]),
  ) as SavedMappings, [sources.data]);
  // A read lands later than the render that started it: it uses the mappings known by then.
  const savedNow = useRef(saved);
  savedNow.current = saved;

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []).map((file) => ({ id: `f${++nextId.current}`, file }));
    if (files.length === 0) return;
    dispatch({ type: "add", files });
    for (const { id, file } of files) {
      readGrid(file).then(
        (grid) => dispatch({ type: "read", id, grid, saved: savedNow.current }),
        (e) => dispatch({ type: "readFailed", id, message: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const loadError = lookups.error ?? sources.error;
  if (loadError) {
    return (
      <main className="mx-auto max-w-6xl p-4 text-sm">
        <p className="mb-2">{loadError.message}</p>
        <button type="button" onClick={() => { lookups.refetch(); sources.refetch(); }} className="rounded-md border px-3 py-1">Retry</button>
      </main>
    );
  }
  if (!lookups.data || !sources.data) {
    return <main className="mx-auto max-w-6xl p-4" aria-busy="true"><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" /></main>;
  }
  const names = sources.data.sources.map((s) => s.name);
  const lastDates = Object.fromEntries(sources.data.sources.map((s) => [s.name, s.lastDate]));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Import</h1>
      <p className="-mt-2 text-sm text-slate-600 dark:text-slate-400">
        Pick each statement's account. Nothing is saved until you press Import.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Files</span>
        <span data-dropzone
          onDragOver={(e) => { e.preventDefault(); if (!running) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (!running) addFiles(e.dataTransfer.files); }}
          className={`flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-3 py-2 ${
            dragging ? "border-slate-500 bg-slate-100 dark:border-slate-400 dark:bg-slate-800" : "border-slate-300 dark:border-slate-700"}`}>
          <input aria-label="Files" type="file" multiple accept=".csv,.xls,.xlsx" disabled={running}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              // Cleared so choosing the same files again still fires.
              e.target.value = "";
              addFiles(picked);
            }}
            className="w-56 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1 file:text-sm hover:file:bg-slate-50 dark:file:border-slate-700 dark:file:bg-slate-900 dark:hover:file:bg-slate-800" />
          <span>Drop statements here or choose files</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">.csv, .xls or .xlsx</span>
        </span>
      </label>
      {rows.length > 0 && (
        <>
        <ul aria-label="Files to import" className="flex flex-col">
          {rows.map((row) => (
            <FileRowView key={row.id} row={row} sources={names} saved={saved} locked={running} lastDates={lastDates}
              dispatch={dispatch} onRetryCheck={dry.retry} onRetryImport={(id) => run.start([id])} />
          ))}
        </ul>
          {(() => {
            const ready = rows.filter(isReady);
            const kinds = rows.map((r) => rowStatus(r).kind);
            const checking = kinds.includes("checking") || kinds.includes("reading");
            const leftOut = kinds.filter((k) => k === "leftOut" || k === "sameFile").length;
            const attention = kinds.filter((k) => ["readFailed", "needsMapping", "nothing", "tooMany", "checkFailed", "refused", "importFailed"].includes(k)).length;
            const total = ready.reduce((n, r) => n + (r.check.state === "done" ? r.check.counts.inserted : 0), 0);
            const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
            return (
              <div className="flex flex-col gap-2">
                {geminiOn && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={askGemini} disabled={running} onChange={(e) => setAskGemini(e.target.checked)}
                      aria-label="Suggest categories for new merchants" />
                    Suggest categories for new merchants
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <button type="button" onClick={() => run.start(ready.map((r) => r.id))}
                    disabled={ready.length === 0 || checking || running}
                    className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                    {running ? "Importing…" : `Import ${plural(ready.length, "file")} · ${plural(total, "transaction")}`}
                  </button>
                  {leftOut > 0 && <span className="text-slate-600 dark:text-slate-400">{leftOut} left out</span>}
                  {attention > 0 && <span className="text-expense">{attention} need attention</span>}
                </div>
              </div>
            );
          })()}
        </>
      )}
      {run.lastRun && !running && (
        <ImportResult rows={rows.filter((r) => run.lastRun?.includes(r.id))} gemini={run.gemini} asking={run.asking}
          onAskAgain={run.askAgain} onStartOver={() => { run.clear(); dispatch({ type: "reset" }); }} />
      )}
    </main>
  );
}
