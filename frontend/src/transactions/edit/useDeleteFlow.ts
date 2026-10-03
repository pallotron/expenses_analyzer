import { createElement, useState, type ReactNode } from "react";
import type { ToastState } from "../../lib/Toast";
import type { TransactionRow } from "../../lib/types";
import { DeleteSheet } from "./DeleteSheet";
import { useDelete, useRestore } from "./mutations";

/** More rows than this need a confirmation first. */
export const CONFIRM_ABOVE = 20;

const plural = (n: number) => `${n} ${n === 1 ? "was" : "were"}`;

/** Deletes at once up to CONFIRM_ABOVE ids, else asks; Undo restores the ids the server deleted. */
export function useDeleteFlow(opts: {
  rows: TransactionRow[];
  notify: (t: Omit<ToastState, "id">) => void;
  onDeleted: (ids: number[]) => void;
}): { start: (ids: number[]) => void; sheet: ReactNode } {
  const del = useDelete();
  const restore = useRestore();
  const [confirming, setConfirming] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const undo = (ids: number[]) => {
    // The toast keeps its Undo button while the restore runs, and only the
    // latest mutate() has its callbacks fired, so a second press would end on a
    // false "0 restored". Ignore it and swap the toast for a plain notice.
    if (restore.isPending) return;
    opts.notify({ message: "Restoring…" });
    restore.mutate(ids, {
      onSuccess: (r) => opts.notify({ message: `${r.restored} restored` }),
      onError: () => opts.notify({ message: "Couldn't restore", action: { label: "Retry", run: () => undo(ids) } }),
    });
  };

  const run = (ids: number[]) => {
    if (del.isPending) return;
    // Read now: the callbacks below close over this render, not the sheet's state when the request ends.
    const inSheet = confirming !== null;
    setError(null);
    del.mutate(ids, {
      onSuccess: ({ deleted, ids: gone }) => {
        setConfirming(null);
        opts.onDeleted(gone);
        const missing = ids.length - deleted;
        opts.notify({
          message: missing > 0 ? `${deleted} of ${ids.length} deleted (${plural(missing)} already gone)` : `${deleted} deleted`,
          action: deleted > 0 ? { label: "Undo", run: () => undo(gone) } : undefined,
        });
      },
      onError: (e) => {
        // A toast cannot show above a modal dialog, so a confirmed delete reports in its sheet.
        if (inSheet) setError(`Couldn't delete: ${e.message}`);
        else opts.notify({ message: `Couldn't delete: ${e.message}`, action: { label: "Retry", run: () => run(ids) } });
      },
    });
  };

  const start = (ids: number[]) => {
    if (ids.length <= CONFIRM_ABOVE) return run(ids);
    setError(null);
    setConfirming(ids);
  };

  const sheet = createElement(DeleteSheet, {
    ids: confirming, rows: opts.rows, busy: del.isPending, error,
    onConfirm: () => confirming && run(confirming), onRetry: () => confirming && run(confirming),
    onClose: () => { setConfirming(null); setError(null); },
  });
  return { start, sheet };
}
