import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";

import { columnNames, findHeaderRow, processRows, type ImportMapping } from "../lib/types";
import { useLookups } from "../transactions/queries";
import { readGrid } from "./grid";
import { MappingForm, mappingSummary } from "./MappingForm";
import { Preview } from "./Preview";
import { useImportMappings } from "./queries";
import { startMapping } from "./startMapping";

const NEW_SOURCE = "__new__";
const field = "rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";

/** What the import button and the result need from the page (Task 6). */
export interface ImportReady {
  source: string;
  file: File;
  mapping: ImportMapping;
  parsed: ReturnType<typeof processRows>;
}

/**
 * Pick a file and a source; a saved mapping that fits applies at once,
 * otherwise the form opens. The preview is exactly what will be imported.
 */
export function ImportPage(props: { renderAction?: (ready: ImportReady, reset: () => void) => ReactNode }) {
  const lookups = useLookups();
  const mappings = useImportMappings();
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("CSV Import");
  // Set from the saved mapping or a guess when the file or source changes; then edited.
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  const source = choice === NEW_SOURCE ? newName.trim() : choice;
  // A read lands later than the render that started it: it must use the source
  // chosen by then, and be dropped if another pick has superseded it.
  const sourceNow = useRef(source);
  sourceNow.current = source;
  const readId = useRef(0);
  // The source name the current mapping was built for.
  const builtFor = useRef("");
  const parsed = useMemo(() => (grid && mapping ? processRows(grid, mapping) : null), [grid, mapping]);
  const reset = () => {
    readId.current++;
    setAttempt((a) => a + 1);
    setFile(null); setGrid(null); setMapping(null); setMissing([]); setEditing(false); setReadError(null);
  };

  const begin = (g: string[][] | null, name: string) => {
    builtFor.current = name;
    if (!g || !name) { setMapping(null); setMissing([]); setEditing(false); return; }
    // Source names are typed by the user and the map is a plain object, so
    // "constructor" must not find Object.prototype's.
    const m = mappings.data?.mappings;
    const saved = m && Object.hasOwn(m, name) ? m[name] : undefined;
    const row = findHeaderRow(g, saved);
    const header = row < 0 ? [] : columnNames(g[row]).filter((n): n is string => n !== null);
    const start = startMapping(header, saved);
    setMapping(start.mapping);
    setMissing(start.missing);
    setEditing(!start.fits);
  };

  const onFile = async (f: File | undefined) => {
    const id = ++readId.current;
    setReadError(null);
    setFile(f ?? null);
    setGrid(null); setMapping(null); setMissing([]); setEditing(false);
    if (!f) return;
    try {
      const g = await readGrid(f);
      if (id !== readId.current) return;
      setGrid(g);
      begin(g, sourceNow.current);
    } catch (e) {
      if (id !== readId.current) return;
      setGrid(null);
      setMapping(null);
      setReadError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSource = (value: string) => {
    setChoice(value);
    begin(grid, value === NEW_SOURCE ? newName.trim() : value);
  };

  // The saved mappings decide what a picked file starts with, so nothing can be
  // picked before they (and the source list) have loaded.
  const loadError = lookups.error ?? mappings.error;
  if (loadError) {
    return (
      <main className="mx-auto max-w-6xl p-4 text-sm">
        <p className="mb-2">{loadError.message}</p>
        <button type="button" onClick={() => { lookups.refetch(); mappings.refetch(); }}
          className="rounded-md border px-3 py-1">Retry</button>
      </main>
    );
  }
  if (!lookups.data || !mappings.data) {
    return <main className="mx-auto max-w-6xl p-4" aria-busy="true"><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" /></main>;
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Import</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          File
          <input key={attempt} aria-label="File" type="file" accept=".csv,.xls,.xlsx"
            onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Source
          <select aria-label="Source" value={choice} onChange={(e) => onSource(e.target.value)} className={field}>
            <option value="" disabled>Choose a source</option>
            {lookups.data.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value={NEW_SOURCE}>New source…</option>
          </select>
        </label>
        {choice === NEW_SOURCE && (
          <label className="flex flex-col gap-1 text-sm">
            New source name
            <input aria-label="New source name" value={newName} maxLength={100} className={field}
              onChange={(e) => setNewName(e.target.value)} onBlur={() => newName.trim() !== builtFor.current && begin(grid, newName.trim())} />
          </label>
        )}
      </div>
      {readError && <p role="alert" className="text-sm text-expense">{readError}</p>}

      {parsed && mapping && (
        <>
          {missing.map((c) => <p key={c} className="text-sm text-expense">{`This file has no '${c}' column`}</p>)}
          {editing ? (
            <MappingForm header={parsed.header} headerRow={parsed.headerRow} mapping={mapping} onChange={setMapping} />
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <span>{mappingSummary(mapping)}</span>
              <button type="button" onClick={() => setEditing(true)} className="underline">Edit</button>
            </p>
          )}
          <Preview parsed={parsed} mapping={mapping} />
          {file && source && (
            // A new file pick or source starts a fresh action: no stale result.
            <Fragment key={`${readId.current}:${source}`}>{props.renderAction?.({ source, file, mapping, parsed }, reset)}</Fragment>
          )}
        </>
      )}
    </main>
  );
}
