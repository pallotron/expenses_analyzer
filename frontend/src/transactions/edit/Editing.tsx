import { useRef, useState } from "react";
import { Toast, type ToastState } from "../../lib/Toast";
import type { LookupsResponse, TransactionRow } from "../../lib/types";
import { ActionBar } from "./ActionBar";
import { useDeleteFlow } from "./useDeleteFlow";

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
  const [toast, setToast] = useState<ToastState | null>(null);
  // A counter, not Date.now(): two toasts in one millisecond must still restart the timer.
  const nextId = useRef(0);
  const notify = (t: Omit<ToastState, "id">) => setToast({ ...t, id: ++nextId.current });
  const deleting = useDeleteFlow({ rows: props.rows, notify, onDeleted: props.onClearSelection });
  return (
    <>
      {props.selectedIds.length > 0 && (
        <ActionBar count={props.selectedIds.length} total={props.rows.length} onSelectAll={props.onSelectAll}
          onTag={() => {}} onUntag={() => {}} onEdit={() => {}} onDelete={() => deleting.start(props.selectedIds)} onCancel={props.onClearSelection} />
      )}
      {deleting.sheet}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <span hidden data-testid="open-row">{props.open?.id}</span>
    </>
  );
}
