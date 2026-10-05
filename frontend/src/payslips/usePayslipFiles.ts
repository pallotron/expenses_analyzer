import { useCallback, useEffect, useRef, useState } from "react";

import { addFiles, needsReparse, type FileStatus, type PayslipFile } from "./fileList";
import { monthFromFilename } from "./parser";
import { parsePayslip, PayslipDecryptError, type LineExtractor } from "./payslipFile";

/**
 * pdf.js is large, so it loads on the first parse, not with the app. Tests
 * pass their own extractor and never load it.
 */
async function parse(file: File, password: string, extractor?: LineExtractor): Promise<FileStatus> {
  if (monthFromFilename(file.name) === null) return { kind: "noMonth" };
  try {
    const extract = extractor ?? (await import("./pdf")).extractTextLines;
    const run = await parsePayslip(file, password || undefined, extract);
    return run ? { kind: "ready", run } : { kind: "unrecognised" };
  } catch (e) {
    if (e instanceof PayslipDecryptError) return { kind: password ? "wrongPassword" : "needsPassword" };
    return { kind: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}

/** The dropped files, each parsed in the browser as it arrives. */
export function usePayslipFiles(password: string, extractor?: LineExtractor) {
  const [files, setFiles] = useState<PayslipFile[]>([]);
  const ids = useRef(0);
  const current = useRef(files);
  current.current = files;

  const latestPassword = useRef(password);
  latestPassword.current = password;

  const start = useCallback(function run(targets: PayslipFile[], pw: string) {
    for (const target of targets) {
      void parse(target.file, pw, extractor).then((status) => {
        // The password changed while this file was read: read it again with the new one.
        if ((status.kind === "needsPassword" || status.kind === "wrongPassword") && pw !== latestPassword.current) {
          const again = { ...target, version: target.version + 1 };
          setFiles((list) => list.map((f) => (f.id === target.id && f.version === target.version ? again : f)));
          run([again], latestPassword.current);
          return;
        }
        setFiles((list) => list.map((f) =>
          f.id === target.id && f.version === target.version ? { ...f, status } : f));
      });
    }
  }, [extractor]);

  const add = useCallback((picked: File[]) => {
    const pdfs = picked.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return;
    const next = addFiles(current.current, pdfs, () => ++ids.current);
    const added = next.slice(next.length - pdfs.length);
    setFiles(next);
    start(added, password);
  }, [password, start]);

  // A new password re-reads the files that wanted one.
  useEffect(() => {
    const waiting = current.current.filter(needsReparse).map((f) => ({ ...f, version: f.version + 1, status: { kind: "reading" } as const }));
    if (waiting.length === 0) return;
    const byId = new Map(waiting.map((f) => [f.id, f]));
    setFiles((list) => list.map((f) => byId.get(f.id) ?? f));
    start(waiting, password);
  }, [password, start]);

  return {
    files,
    add,
    remove: (id: number) => setFiles((list) => list.filter((f) => f.id !== id)),
    useAnyway: (id: number) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, useAnyway: true } : f))),
    clear: (gone: number[]) => setFiles((list) => list.filter((f) => !gone.includes(f.id))),
    reading: files.some((f) => f.status.kind === "reading"),
  };
}
