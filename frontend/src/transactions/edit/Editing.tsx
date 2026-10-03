import { useState } from "react";
import { Toast, useToast } from "../../lib/Toast";
import type { LookupsResponse, TransactionRow } from "../../lib/types";
import { ActionBar } from "./ActionBar";
import { BulkEditSheet } from "./BulkEditSheet";
import { EditSheet } from "./EditSheet";
import { TagSheet } from "./TagSheet";
import { useDeleteFlow } from "./useDeleteFlow";

/** Owns everything that changes transactions: the action bar now, the sheets and the toast later. */
export function Editing(props: {
  rows: TransactionRow[];
  selectedIds: number[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeselect: (ids: number[]) => void;
  open: TransactionRow | null;
  onCloseOpen: () => void;
  lookups: LookupsResponse | undefined;
}) {
  const { toast, notify, dismiss } = useToast();
  const [tagMode, setTagMode] = useState<"add" | "remove" | null>(null);
  const [bulkIds, setBulkIds] = useState<number[] | null>(null);
  const deleting = useDeleteFlow({ rows: props.rows, notify, onDeleted: props.onDeselect });
  return (
    <>
      {props.selectedIds.length > 0 && (
        <ActionBar count={props.selectedIds.length} total={props.rows.length} onSelectAll={props.onSelectAll}
          onTag={() => setTagMode("add")} onUntag={() => setTagMode("remove")} onEdit={() => setBulkIds(props.selectedIds)} onDelete={() => deleting.start(props.selectedIds)} onCancel={props.onClearSelection} />
      )}
      {deleting.sheet}
      <TagSheet mode={tagMode} ids={props.selectedIds} rows={props.rows} known={props.lookups?.tags ?? []}
        onClose={() => setTagMode(null)} onDone={(message) => notify({ message })} />
      <BulkEditSheet ids={bulkIds} lookups={props.lookups} onClose={() => setBulkIds(null)}
        onDone={(message) => { notify({ message }); props.onClearSelection(); }} />
      <Toast toast={toast} onDismiss={dismiss} />
      <EditSheet row={props.open} lookups={props.lookups} onClose={props.onCloseOpen} onSaved={() => notify({ message: "Saved" })}
        onDelete={(id) => { props.onCloseOpen(); deleting.start([id]); }} />
    </>
  );
}
