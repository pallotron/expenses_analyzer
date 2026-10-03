import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "./api";

export interface SheetSubmit<V> {
  /** Start the request unless one is running. */
  run: (vars: V) => void;
  /** Show a message without sending anything (form validation). */
  fail: (message: string) => void;
  reset: () => void;
  error: string | null;
  /** True when the request never got an answer, so Retry may work. */
  retryable: boolean;
  pending: boolean;
}

/**
 * What every sheet's Save does: one request at a time, the Worker's message
 * shown as is, and Retry only when the request never got an answer.
 */
export function useSheetSubmit<V, R>(
  mutation: UseMutationResult<R, Error, V>,
  onSuccess: (result: R, vars: V) => void,
  onError?: (e: Error) => void,
): SheetSubmit<V> {
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const reset = () => { setError(null); setRetryable(false); };
  return {
    run: (vars) => {
      if (mutation.isPending) return;
      reset();
      mutation.mutate(vars, {
        onSuccess: (r) => onSuccess(r, vars),
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : `Couldn't save: ${e.message}`);
          setRetryable(!(e instanceof ApiError));
          onError?.(e);
        },
      });
    },
    fail: (message) => { setError(message); setRetryable(false); },
    reset,
    error,
    retryable,
    pending: mutation.isPending,
  };
}

/** The alert line under a form, with Retry when retryable. */
export function SheetError(props: { submit: Pick<SheetSubmit<unknown>, "error" | "retryable">; onRetry: () => void }) {
  if (!props.submit.error) return null;
  return (
    <p role="alert" className="text-sm text-expense">
      {props.submit.error}
      {props.submit.retryable && <button type="button" onClick={props.onRetry} className="ml-2 underline">Retry</button>}
    </p>
  );
}
