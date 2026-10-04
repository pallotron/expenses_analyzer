/**
 * The import page's files, one row each, as a pure reducer. Every change
 * that can alter what a row would import bumps its `version`; check answers
 * carry the version they were asked for, and older ones are ignored.
 */

import {
  columnNames, findHeaderRow, MAX_IMPORT_ROWS, missingColumns, processRows,
  type ImportMapping, type ImportRequest, type ImportResponse, type ParsedImport,
} from "../lib/types";
import { startMapping } from "./startMapping";

export const NEW_SOURCE = "__new__";
const NEW_SOURCE_NAME = "CSV Import";

export type SavedMappings = Record<string, ImportMapping>;
export interface Counts { inserted: number; duplicates: number; suppressedDeleted: number; newMerchants: string[] }

export type Check =
  | { state: "idle" }
  | { state: "checking"; version: number }
  | { state: "done"; version: number; counts: Counts }
  | { state: "failed"; version: number; message: string; errors?: string[]; refused: boolean };

export type Run =
  | { state: "no" }
  | { state: "importing" }
  | { state: "done"; result: ImportResponse }
  | { state: "failed"; message: string; errors?: string[] };

export interface FileRow {
  id: string;
  file: File;
  /** Name, size and modified time: the same file dropped twice. */
  fingerprint: string;
  /** The earlier row holding the same file, if any. */
  sameAs: string | null;
  grid: string[][] | null;
  readError: string | null;
  /** The select's value: a source name, NEW_SOURCE, or "". */
  choice: string;
  newName: string;
  /** The source the row imports into; "" for none. */
  source: string;
  mapping: ImportMapping | null;
  parsed: ParsedImport | null;
  /** A saved mapping fitted, or the user accepted the columns. */
  confirmed: boolean;
  /** Why the row is unconfirmed: the saved columns the file lacks. Cleared once confirmed or edited. */
  missing: string[];
  open: boolean;
  editing: boolean;
  version: number;
  check: Check;
  run: Run;
}

export type RowStatus =
  | { kind: "reading" }
  | { kind: "readFailed"; message: string }
  | { kind: "sameFile" }
  | { kind: "leftOut" }
  | { kind: "needsName" }
  | { kind: "needsMapping"; missing: string[] }
  | { kind: "nothing" }
  | { kind: "tooMany"; rows: number }
  | { kind: "checking" }
  | { kind: "ready"; counts: Counts; skipped: number }
  | { kind: "checkFailed"; message: string }
  | { kind: "refused"; message: string; errors: string[] }
  | { kind: "importing" }
  | { kind: "imported"; result: ImportResponse }
  | { kind: "importFailed"; message: string; errors: string[] };

export type Action =
  | { type: "add"; files: { id: string; file: File }[] }
  | { type: "read"; id: string; grid: string[][]; saved: SavedMappings }
  | { type: "readFailed"; id: string; message: string }
  | { type: "choose"; id: string; choice: string; saved: SavedMappings }
  | { type: "rename"; id: string; name: string; saved: SavedMappings }
  | { type: "mapping"; id: string; mapping: ImportMapping }
  | { type: "confirm"; id: string }
  | { type: "toggle"; id: string }
  | { type: "edit"; id: string }
  | { type: "checkStart"; id: string; version: number }
  | { type: "checked"; id: string; version: number; counts: Counts }
  | { type: "checkFailed"; id: string; version: number; message: string; errors?: string[]; refused: boolean }
  | { type: "recheck"; ids: string[] }
  | { type: "importStart"; id: string }
  | { type: "imported"; id: string; result: ImportResponse }
  | { type: "importFailed"; id: string; message: string; errors?: string[] }
  | { type: "remove"; id: string }
  | { type: "reset" };

const IDLE: Check = { state: "idle" };
const fingerprintOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const sourceOf = (choice: string, newName: string) => (choice === NEW_SOURCE ? newName.trim() : choice);
// Source names are typed by people and the map is a plain object.
const savedFor = (saved: SavedMappings, name: string) => (Object.hasOwn(saved, name) ? saved[name] : undefined);
const complete = (m: ImportMapping) => m.date !== "" && m.merchant !== "" && m.amount !== "";
const skippedCount = (p: ParsedImport) => Object.values(p.skipped).reduce((n, lines) => n + lines.length, 0);

/** Start the row's mapping for `source`: its saved one when it fits, else a guess to confirm. */
function withSource(row: FileRow, source: string, saved: SavedMappings): FileRow {
  const version = row.version + 1;
  if (!row.grid || !source) {
    return { ...row, source, mapping: null, parsed: null, confirmed: false, missing: [], editing: false, version, check: IDLE };
  }
  const own = savedFor(saved, source);
  const at = findHeaderRow(row.grid, own);
  const header = at < 0 ? [] : columnNames(row.grid[at]).filter((n): n is string => n !== null);
  const start = startMapping(header, own);
  return {
    ...row, source, mapping: start.mapping, parsed: processRows(row.grid, start.mapping),
    confirmed: start.fits, missing: start.missing, open: row.open, editing: !start.fits, version, check: IDLE,
  };
}

/** A new source or columns mean a failed import may now work: check it again before any import. */
const unfailed = (r: FileRow): FileRow => (r.run.state === "failed" ? { ...r, run: { state: "no" } } : r);

export function rowStatus(row: FileRow): RowStatus {
  if (row.run.state === "importing") return { kind: "importing" };
  if (row.run.state === "done") return { kind: "imported", result: row.run.result };
  if (row.run.state === "failed") return { kind: "importFailed", message: row.run.message, errors: row.run.errors ?? [] };
  if (row.readError !== null) return { kind: "readFailed", message: row.readError };
  if (!row.grid) return { kind: "reading" };
  if (!row.source && row.choice === NEW_SOURCE) return { kind: "needsName" };
  if (!row.source) return row.sameAs ? { kind: "sameFile" } : { kind: "leftOut" };
  if (!row.mapping || !row.parsed) return { kind: "needsMapping", missing: [] };
  if (!row.confirmed) return { kind: "needsMapping", missing: row.missing };
  const missing = missingColumns(row.parsed.header, row.mapping);
  if (missing.length > 0 || !complete(row.mapping)) return { kind: "needsMapping", missing };
  const n = row.parsed.rows.length;
  if (n === 0) return { kind: "nothing" };
  if (n > MAX_IMPORT_ROWS) return { kind: "tooMany", rows: n };
  const c = row.check;
  if (c.state === "done" && c.version === row.version) return { kind: "ready", counts: c.counts, skipped: skippedCount(row.parsed) };
  if (c.state === "failed" && c.version === row.version) {
    return c.refused ? { kind: "refused", message: c.message, errors: c.errors ?? [] } : { kind: "checkFailed", message: c.message };
  }
  return { kind: "checking" };
}

export const isReady = (row: FileRow) => rowStatus(row).kind === "ready";

/** What POST /api/import takes for this row. Call only for a row with a mapping and parsed rows. */
export function requestFor(row: FileRow, dryRun: boolean): ImportRequest {
  return {
    source: row.source,
    filename: row.file.name,
    mapping: row.mapping as ImportMapping,
    rows: (row.parsed as ParsedImport).rows.map(({ date, merchant, amountCents, type }) => ({ date, merchant, amountCents, type })),
    ...(dryRun && { dryRun: true }),
  };
}

function update(rows: FileRow[], id: string, change: (row: FileRow) => FileRow): FileRow[] {
  // A row that is gone (removed, or the list reset) ignores late answers.
  return rows.map((r) => (r.id === id ? change(r) : r));
}

export function importList(rows: FileRow[], action: Action): FileRow[] {
  switch (action.type) {
    case "add": {
      const next = [...rows];
      for (const { id, file } of action.files) {
        const fingerprint = fingerprintOf(file);
        next.push({
          id, file, fingerprint, sameAs: next.find((r) => r.fingerprint === fingerprint)?.id ?? null,
          grid: null, readError: null, choice: "", newName: NEW_SOURCE_NAME, source: "",
          mapping: null, parsed: null, confirmed: false, missing: [], open: false, editing: false,
          version: 0, check: IDLE, run: { state: "no" },
        });
      }
      return next;
    }
    case "read":
      return update(rows, action.id, (r) => withSource({ ...r, grid: action.grid, readError: null }, r.source, action.saved));
    case "readFailed":
      return update(rows, action.id, (r) => ({ ...r, grid: null, readError: action.message }));
    case "choose":
      return update(rows, action.id, (r) => withSource(unfailed({ ...r, choice: action.choice }), sourceOf(action.choice, r.newName), action.saved));
    case "rename":
      return update(rows, action.id, (r) => {
        const next = { ...r, newName: action.name };
        const source = sourceOf(r.choice, action.name);
        return r.choice === NEW_SOURCE && source !== r.source ? withSource(unfailed(next), source, action.saved) : next;
      });
    case "mapping":
      return update(rows, action.id, (r) => {
        if (!r.grid) return r;
        return {
          ...unfailed(r), mapping: action.mapping, parsed: processRows(r.grid, action.mapping), missing: [],
          version: r.version + 1, check: IDLE,
        };
      });
    case "confirm":
      return update(rows, action.id, (r) => ({ ...unfailed(r), confirmed: true, missing: [], editing: false, version: r.version + 1, check: IDLE }));
    case "toggle":
      return update(rows, action.id, (r) => ({ ...r, open: !r.open }));
    case "edit":
      return update(rows, action.id, (r) => ({ ...r, open: true, editing: true }));
    case "checkStart":
      return update(rows, action.id, (r) => (r.version === action.version ? { ...r, check: { state: "checking", version: action.version } } : r));
    case "checked":
      return update(rows, action.id, (r) => (r.version === action.version
        ? { ...r, check: { state: "done", version: action.version, counts: action.counts } } : r));
    case "checkFailed":
      return update(rows, action.id, (r) => (r.version === action.version
        ? { ...r, check: { state: "failed", version: action.version, message: action.message, errors: action.errors, refused: action.refused } }
        : r));
    case "recheck": {
      const ids = new Set(action.ids);
      return rows.map((r) => (ids.has(r.id) && r.run.state === "no" ? { ...r, version: r.version + 1, check: IDLE } : r));
    }
    case "importStart":
      return update(rows, action.id, (r) => ({ ...r, run: { state: "importing" } }));
    case "imported":
      return update(rows, action.id, (r) => ({ ...r, run: { state: "done", result: action.result } }));
    case "importFailed":
      return update(rows, action.id, (r) => ({ ...r, run: { state: "failed", message: action.message, errors: action.errors } }));
    case "remove":
      return rows.filter((r) => r.id !== action.id).map((r) => (r.sameAs === action.id ? { ...r, sameAs: null } : r));
    case "reset":
      return [];
  }
}
