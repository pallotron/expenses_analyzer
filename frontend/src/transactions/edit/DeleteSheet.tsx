import { formatCents } from "../../lib/money";
import { Sheet } from "../../lib/Sheet";
import type { TransactionRow } from "../../lib/types";

/** Asks before a big delete, saying how many rows and how much money they hold. */
export function DeleteSheet(props: {
  ids: number[] | null; rows: TransactionRow[]; busy: boolean; error: string | null;
  onConfirm: () => void; onRetry: () => void; onClose: () => void;
}) {
  const n = props.ids?.length ?? 0;
  const chosen = new Set(props.ids ?? []);
  // Signed like the table: a refund among the rows lowers what is being deleted.
  const net = props.rows.filter((r) => chosen.has(r.id))
    .reduce((a, r) => a + (r.type === "income" ? r.amountCents : -r.amountCents), 0);
  const total = `${net < 0 ? "−" : net > 0 ? "+" : ""}${formatCents(Math.abs(net))}`;
  return (
    <Sheet title={`Delete ${n} transactions?`} open={props.ids !== null} onClose={props.onClose} busy={props.busy}>
      <p className="text-sm">These {n} transactions total {total}. You can undo this straight after.</p>
      {props.error && (
        <p role="alert" className="text-sm text-expense">
          {props.error}
          <button type="button" onClick={props.onRetry} disabled={props.busy} className="ml-2 underline">Retry</button>
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={props.onClose} disabled={props.busy} className="rounded-md px-3 py-1.5 underline disabled:opacity-40">Cancel</button>
        <button type="button" onClick={props.onConfirm} disabled={props.busy}
          className="inline-flex items-center gap-2 rounded-md bg-expense px-3 py-1.5 font-medium text-white disabled:opacity-70">
          {props.busy && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {props.busy ? `Deleting ${n}…` : `Delete ${n}`}
        </button>
      </div>
    </Sheet>
  );
}
