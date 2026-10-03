import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal sheet on the native <dialog>, which brings the focus trap, Escape
 * and the backdrop. A centred panel on desktop, a bottom sheet on phones.
 * While `busy`, nothing closes it: the request it started must finish.
 */
export function Sheet(props: { title: string; open: boolean; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  const close = () => { if (!props.busy) props.onClose(); };
  return (
    <dialog ref={ref} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close(); }}
      // Chrome can close a dialog on a second Escape without a cancel we could
      // prevent. A busy sheet must stay up; otherwise the parent follows the close.
      // When `open` is already false we closed it ourselves, so there is nothing to do.
      onClose={() => {
        if (!props.open) return;
        if (props.busy) { if (ref.current && !ref.current.open) ref.current.showModal(); }
        else props.onClose();
      }}
      // A click on the dialog element itself, not its content, is the backdrop.
      onClick={(e) => { if (e.target === ref.current) close(); }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-slate-900 backdrop:bg-slate-900/40 md:m-auto md:max-w-lg md:rounded-2xl dark:bg-slate-900 dark:text-slate-100">
      {props.open && (
        <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold">{props.title}</h2>
            <button type="button" onClick={close} disabled={props.busy} aria-label="Close"
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800">✕</button>
          </div>
          {props.children}
        </div>
      )}
    </dialog>
  );
}
