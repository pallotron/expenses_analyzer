import { useMemo, useReducer, useRef, useState } from "react";

import { useLookups } from "../transactions/queries";
import { FileRowView } from "./FileRow";
import { readGrid } from "./grid";
import { importList, type SavedMappings } from "./importList";
import { useImportSources } from "./queries";
import { useDryRun } from "./useDryRun";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
  const running = false; // Task 7: true while the list imports
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

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Import</h1>
      <p className="-mt-2 text-sm text-slate-600 dark:text-slate-400">
        Pick each statement's account. Nothing is saved until you press Import.
      </p>
      {sources.data.sources.length > 0 && (
        <section aria-label="Where each source left off" className="text-sm">
          <h2 className="mb-1 font-medium">Where each source left off</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
            {sources.data.sources.map((s) => (
              <li key={s.name}><span className="text-slate-900 dark:text-slate-100">{s.name}</span> {s.lastDate ? day(s.lastDate) : "no transactions"}</li>
            ))}
          </ul>
        </section>
      )}
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
        <ul aria-label="Files to import" className="flex flex-col">
          {rows.map((row) => (
            <FileRowView key={row.id} row={row} sources={names} saved={saved} locked={running}
              dispatch={dispatch} onRetryCheck={dry.retry} onRetryImport={() => {}} />
          ))}
        </ul>
      )}
    </main>
  );
}
