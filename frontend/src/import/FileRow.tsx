import { commaDecimalSample } from "../lib/types";
import { FilePanel } from "./FilePanel";
import { NEW_SOURCE, rowStatus, type Action, type FileRow, type RowStatus, type SavedMappings } from "./importList";

const field = "rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";

const quoted = (cols: string[]) => cols.map((c) => `'${c}'`).join(", ");
const counted = (inserted: number, duplicates: number, deleted: number) =>
  `${inserted} · ${duplicates} already there${deleted > 0 ? ` · ${deleted} deleted` : ""}`;

/** One line per status; the row adds the errors list and Retry where they apply. */
export function statusText(s: RowStatus): string {
  switch (s.kind) {
    case "reading": return "Reading…";
    case "readFailed": return `Couldn't read: ${s.message}`;
    case "sameFile": return "Same file as above";
    case "leftOut": return "Left out";
    case "needsMapping": return s.missing.length === 0 ? "Needs mapping: choose its columns"
      : `Needs mapping: no ${quoted(s.missing)} column${s.missing.length === 1 ? "" : "s"}`;
    case "nothing": return "Nothing to import";
    case "tooMany": return `Too many rows (${s.rows}): split the file`;
    case "checking": return "Checking…";
    case "ready": return `Ready · ${s.counts.inserted} new · ${s.counts.duplicates} already there`
      + `${s.counts.suppressedDeleted > 0 ? ` · ${s.counts.suppressedDeleted} deleted` : ""}`
      + `${s.skipped > 0 ? ` · ${s.skipped} skipped` : ""}`;
    case "checkFailed": return `Couldn't check: ${s.message}`;
    case "refused": return `Refused: ${s.message}`;
    case "importing": return "Importing…";
    case "imported": return `Imported ${counted(s.result.inserted, s.result.duplicates, s.result.suppressedDeleted)}`;
    case "importFailed": return `Failed: ${s.message}`;
  }
}

const ALERT = new Set<RowStatus["kind"]>(["readFailed", "needsMapping", "tooMany", "checkFailed", "refused", "importFailed"]);

export function FileRowView(props: {
  row: FileRow; sources: string[]; saved: SavedMappings; locked: boolean;
  dispatch: (a: Action) => void; onRetryCheck: (id: string) => void; onRetryImport: (id: string) => void;
}) {
  const { row, dispatch, locked } = props;
  const name = row.file.name;
  const status = rowStatus(row);
  const errors = status.kind === "refused" || status.kind === "importFailed" ? status.errors : [];
  const comma = row.grid && row.mapping && row.source ? commaDecimalSample(row.grid, row.mapping) : null;
  return (
    <li className="border-b border-slate-200 py-2 dark:border-slate-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="flex min-w-0 items-center gap-2 sm:w-64">
          <button type="button" aria-expanded={row.open} aria-label={`${row.open ? "Hide" : "Show"} ${name}`}
            onClick={() => dispatch({ type: "toggle", id: row.id })} className="w-5 shrink-0">{row.open ? "▾" : "▸"}</button>
          <span className="truncate text-sm" title={name}>{name}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <select aria-label={`Source for ${name}`} value={row.choice} disabled={locked}
            onChange={(e) => dispatch({ type: "choose", id: row.id, choice: e.target.value, saved: props.saved })}
            className={`${field} h-9`}>
            <option value="" disabled>Choose a source…</option>
            {props.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value={NEW_SOURCE}>New source…</option>
          </select>
          {row.choice === NEW_SOURCE && (
            <input aria-label={`New source name for ${name}`} defaultValue={row.newName} maxLength={100} disabled={locked}
              className={`${field} h-9`}
              onBlur={(e) => dispatch({ type: "rename", id: row.id, name: e.target.value, saved: props.saved })}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          )}
        </span>
        <div aria-label={`Status of ${name}`} className={`flex-1 text-sm ${ALERT.has(status.kind) ? "text-expense" : ""}`}>
          <span>{statusText(status)}</span>
          {(status.kind === "checkFailed" || status.kind === "refused") && (
            <button type="button" disabled={locked} onClick={() => props.onRetryCheck(row.id)} className="ml-2 underline">Retry</button>
          )}
          {status.kind === "importFailed" && (
            <button type="button" disabled={locked} onClick={() => props.onRetryImport(row.id)} className="ml-2 underline">Retry</button>
          )}
          {errors.length > 0 && <ul className="list-disc pl-5">{errors.map((e, i) => <li key={`${i}:${e}`}>{e}</li>)}</ul>}
        </div>
        <button type="button" aria-label={`Remove ${name}`} disabled={locked}
          onClick={() => dispatch({ type: "remove", id: row.id })} className="self-start px-2 sm:self-auto">✕</button>
      </div>
      {comma !== null && (
        <p role="alert" className="text-sm text-expense">
          {`Some amounts use a comma for decimals (e.g. "${comma}"); they would import 100 times too large. Fix the file's number format before importing.`}
        </p>
      )}
      {row.open && <FilePanel row={row} locked={locked} dispatch={dispatch} />}
    </li>
  );
}
