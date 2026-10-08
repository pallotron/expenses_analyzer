import { useEffect, useRef, useState } from "react";

export const TOAST_MS = 10_000;

export interface ToastState {
  /** A new id restarts the timer, even for the same message. */
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

/** One message at a time, bottom of the screen, above the phone action bar. */
export function Toast(props: { toast: ToastState | null; onDismiss: () => void }) {
  const { toast, onDismiss } = props;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(t);
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6 print:hidden">
      {toast && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" onClick={toast.action.run} className="font-semibold underline">{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  // A counter, not Date.now(): two toasts in one millisecond must still restart the timer.
  const nextId = useRef(0);
  return {
    toast,
    notify: (t: Omit<ToastState, "id">) => setToast({ ...t, id: ++nextId.current }),
    dismiss: () => setToast(null),
  };
}
