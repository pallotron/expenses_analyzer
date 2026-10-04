import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type Dispatch } from "react";

import { ApiError } from "../lib/api";
import { useSuggestCategories } from "../merchants/mutations";
import { suggestMessage } from "../merchants/suggest";
import { requestFor, type Action, type FileRow } from "./importList";
import { IMPORT_WRITES, postImport } from "./queries";
import { checkFailure } from "./useDryRun";

/**
 * Imports the given rows one after another. A row whose source an earlier
 * file of this run already imported into is checked again first, so its
 * counts are true; a failed file never stops the rest. Then one Gemini call
 * for every new merchant, when asked.
 */
export function useImportAll(rows: FileRow[], dispatch: Dispatch<Action>, askGemini: boolean) {
  const client = useQueryClient();
  const suggest = useSuggestCategories();
  const latest = useRef(rows);
  latest.current = rows;
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string[] | null>(null);
  const [gemini, setGemini] = useState<{ message: string; ok: boolean } | null>(null);

  const ask = () => suggest.mutate(undefined, {
    onSuccess: (r) => setGemini({ message: suggestMessage(r), ok: r.suggested > 0 }),
    onError: (e) => setGemini({ message: e.message, ok: false }),
  });

  // Leaving mid-run would drop the files not yet sent.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const start = async (ids: string[]) => {
    setRunning(true);
    setGemini(null);
    setLastRun((prev) => [...new Set([...(prev ?? []), ...ids])]);
    const into = new Set<string>();
    const fresh = new Set<string>();
    try {
      for (const id of ids) {
        const row = latest.current.find((r) => r.id === id);
        if (!row) continue;
        if (into.has(row.source)) {
          const version = row.version + 1;
          dispatch({ type: "recheck", ids: [id] });
          dispatch({ type: "checkStart", id, version });
          try {
            dispatch({ type: "checked", id, version, counts: await postImport(requestFor(row, true)) });
          } catch (e) {
            dispatch(checkFailure(id, version, e));
            continue;
          }
        }
        dispatch({ type: "importStart", id });
        try {
          const result = await postImport(requestFor(row, false));
          dispatch({ type: "imported", id, result });
          into.add(row.source);
          for (const m of result.newMerchants) fresh.add(m);
        } catch (e) {
          dispatch({
            type: "importFailed", id, message: e instanceof Error ? e.message : String(e),
            errors: e instanceof ApiError ? e.errors : undefined,
          });
        }
      }
    } finally {
      await Promise.all(IMPORT_WRITES.map((key) => client.invalidateQueries({ queryKey: [key] })));
      // Rows outside the run that share a source now count against the new rows.
      dispatch({ type: "recheck", ids: latest.current.filter((r) => into.has(r.source)).map((r) => r.id) });
      setRunning(false);
      if (askGemini && fresh.size > 0) ask();
    }
  };

  return {
    start, running, lastRun, gemini, asking: suggest.isPending,
    askAgain: () => { setGemini(null); ask(); },
    clear: () => { setLastRun(null); setGemini(null); },
  };
}
