import { useEffect, useRef, type Dispatch } from "react";

import { ApiError } from "../lib/api";
import { createCheckQueue, type CheckQueue } from "./checkQueue";
import { requestFor, rowStatus, type Action, type FileRow } from "./importList";
import { postImport } from "./queries";

/** The failure action for a check: a 400 is the Worker refusing rows, anything else is retryable. */
export function checkFailure(id: string, version: number, e: unknown): Action {
  return {
    type: "checkFailed", id, version,
    message: e instanceof Error ? e.message : String(e),
    errors: e instanceof ApiError ? e.errors : undefined,
    refused: e instanceof ApiError && e.status === 400,
  };
}

/**
 * Checks every row waiting for one, by a dry run of its import. Paused while
 * the list imports, which does its own checks in order.
 */
export function useDryRun(rows: FileRow[], dispatch: Dispatch<Action>, paused: boolean) {
  const latest = useRef(rows);
  latest.current = rows;
  // id -> the version already handed to the queue, so a render never schedules twice.
  const scheduled = useRef(new Map<string, number>());
  const queue = useRef<CheckQueue | null>(null);
  queue.current ??= createCheckQueue({
    run: async (id, version) => {
      const row = latest.current.find((r) => r.id === id);
      if (!row || row.version !== version) return;
      dispatch({ type: "checkStart", id, version });
      try {
        const r = await postImport(requestFor(row, true));
        dispatch({ type: "checked", id, version, counts: r });
      } catch (e) {
        dispatch(checkFailure(id, version, e));
      }
    },
  });

  useEffect(() => {
    if (paused) return;
    for (const row of rows) {
      if (rowStatus(row).kind !== "checking" || row.check.state !== "idle") continue;
      if (scheduled.current.get(row.id) === row.version) continue;
      scheduled.current.set(row.id, row.version);
      queue.current?.schedule(row.id, row.version);
    }
  }, [rows, paused]);

  // Also forget what was scheduled: a StrictMode remount would otherwise skip rows the cancel dropped.
  useEffect(() => () => { queue.current?.cancelAll(); scheduled.current.clear(); }, []);

  return { retry: (id: string) => dispatch({ type: "recheck", ids: [id] }) };
}
