import type { LookupsResponse, TransactionRow } from "../../lib/types";
import { ActionBar } from "./ActionBar";

/** Owns everything that changes transactions: the action bar now, the sheets and the toast later. */
export function Editing(props: {
  rows: TransactionRow[];
  selectedIds: number[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  open: TransactionRow | null;
  onCloseOpen: () => void;
  lookups: LookupsResponse | undefined;
}) {
  return (
    <>
      {props.selectedIds.length > 0 && (
        <ActionBar count={props.selectedIds.length} total={props.rows.length} onSelectAll={props.onSelectAll}
          onTag={() => {}} onUntag={() => {}} onEdit={() => {}} onDelete={() => {}} onCancel={props.onClearSelection} />
      )}
      <span hidden data-testid="open-row">{props.open?.id}</span>
    </>
  );
}
