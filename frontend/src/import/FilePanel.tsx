import { MappingForm, mappingSummary } from "./MappingForm";
import { Preview } from "./Preview";
import { RawGrid } from "./RawGrid";
import { missingColumns } from "../lib/types";
import type { Action, FileRow } from "./importList";

/**
 * One file's detail: its columns (form or summary), the file as read, and
 * the parsed preview. Mapping edits re-check the row; nothing is saved here.
 */
export function FilePanel(props: { row: FileRow; locked: boolean; dispatch: (a: Action) => void }) {
  const { row, dispatch } = props;
  const { mapping, parsed, grid } = row;
  const complete = !!mapping && mapping.date !== "" && mapping.merchant !== "" && mapping.amount !== "";
  const missing = mapping && parsed ? missingColumns(parsed.header, mapping) : [];
  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 py-3 dark:border-slate-800">
      {!row.source && grid && (
        <p className="text-sm text-slate-600 dark:text-slate-400">Choose a source to map its columns.</p>
      )}
      {mapping && parsed && (row.editing ? (
        <fieldset disabled={props.locked} className="contents">
          <MappingForm header={parsed.header} headerRow={parsed.headerRow} gridRows={grid?.length ?? 0}
            mapping={mapping} onChange={(m) => dispatch({ type: "mapping", id: row.id, mapping: m })} />
        </fieldset>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span>{mappingSummary(mapping)}</span>
          <button type="button" disabled={props.locked} onClick={() => dispatch({ type: "edit", id: row.id })} className="underline">Edit</button>
        </p>
      ))}
      {mapping && parsed && !row.confirmed && (
        <div>
          <button type="button" disabled={props.locked || !complete || missing.length > 0}
            onClick={() => dispatch({ type: "confirm", id: row.id })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900">
            Use these columns
          </button>
        </div>
      )}
      {grid && <RawGrid grid={grid} headerRow={parsed?.headerRow ?? -1} />}
      {mapping && parsed && <Preview key={row.version} parsed={parsed} mapping={mapping} />}
    </div>
  );
}
