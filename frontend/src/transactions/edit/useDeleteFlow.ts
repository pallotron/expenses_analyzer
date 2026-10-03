import { createElement, useState, type ReactNode } from "react";
import type { ToastState } from "../../lib/Toast";
import type { TransactionRow } from "../../lib/types";
import { DeleteSheet } from "./DeleteSheet";
import { useDelete, useRestore } from "./mutations";

/** More rows than this need a confirmation first. */
export const CONFIRM_ABOVE = 20;

const plural = (n: number) => `${n} ${n === 1 ? "was" : "were"}`;

/** Deletes at once up to CONFIRM_ABOVE ids, else asks; Undo restores the same ids. */
export function useDeleteFlow(opts: {
  rows: TransactionRow[];
  notify: (t: Omit<ToastState, "id">) => void;
  onDeleted: () => void;
}): { start: (ids: number[]) => void; sheet: ReactNode } {
  const del = useDelete();
  const restore = useRestore();
  const [confirming, setConfirming] = useState<number[] | null>(null);

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
    del.mutate(ids, {
      onSuccess: ({ deleted }) => {
        setConfirming(null);
        opts.onDeleted();
        const gone = ids.length - deleted;
        opts.notify({
          message: gone > 0 ? `${deleted} of ${ids.length} deleted (${plural(gone)} already gone)` : `${deleted} deleted`,
          action: deleted > 0 ? { label: "Undo", run: () => undo(ids) } : undefined,
        });
      },
      onError: (e) => opts.notify({ message: `Couldn't delete: ${e.message}`, action: { label: "Retry", run: () => run(ids) } }),
    });
  };

  const start = (ids: number[]) => (ids.length > CONFIRM_ABOVE ? setConfirming(ids) : run(ids));

  const sheet = createElement(DeleteSheet, {
    ids: confirming, rows: opts.rows, busy: del.isPending,
    onConfirm: () => confirming && run(confirming), onClose: () => setConfirming(null),
  });
  return { start, sheet };
}
