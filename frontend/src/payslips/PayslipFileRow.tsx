import { formatCents } from "../lib/money";
import { ignoredBy, type PayslipFile } from "./fileList";

/** What a dropped file will do, in words. */
export function fileStatusText(f: PayslipFile, saved: Set<string>): { text: string; tone: "ok" | "warn" | "off" } {
  switch (f.status.kind) {
    case "reading": return { text: "Reading…", tone: "off" };
    case "needsPassword": return { text: "Needs password", tone: "warn" };
    case "wrongPassword": return { text: "Wrong password", tone: "warn" };
    case "unrecognised": return { text: "Layout not recognised", tone: "off" };
    case "noMonth": return { text: "No month in the file name", tone: "off" };
    case "failed": return { text: `Couldn't read it: ${f.status.message}`, tone: "off" };
    case "ready": {
      const token = ignoredBy(f.file.name);
      if (token && !f.useAnyway) return { text: `Left out (name contains "${token}")`, tone: "off" };
      const what = saved.has(f.file.name) ? "Replaces the saved copy" : "New";
      return f.status.run.netReconciled
        ? { text: what, tone: "ok" }
        : { text: `${what} · Net doesn't match the payslip`, tone: "warn" };
    }
  }
}

const TONE = { ok: "text-income", warn: "text-amber-600 dark:text-amber-400", off: "text-slate-500" };

export function PayslipFileRow(props: {
  file: PayslipFile; saved: Set<string>; disabled: boolean; onRemove: () => void; onUseAnyway: () => void;
}) {
  const { file } = props;
  const status = fileStatusText(file, props.saved);
  const run = file.status.kind === "ready" ? file.status.run : null;
  const canUse = run !== null && ignoredBy(file.file.name) !== null && !file.useAnyway;
  return (
    <li className="flex flex-col gap-1 border-b border-slate-100 py-2 text-sm sm:flex-row sm:items-center sm:gap-3 dark:border-slate-800">
      <span className="min-w-0 flex-1 break-all font-medium">{file.file.name}</span>
      {run && (
        <span className="tabular-nums text-slate-600 dark:text-slate-400">
          {run.month} · gross {formatCents(run.gross)} · net {formatCents(run.net)} · pension{" "}
          {formatCents(run.pensionEe + run.avc)} / {formatCents(run.pensionEr)}
        </span>
      )}
      <span className={TONE[status.tone]}>{status.text}</span>
      {canUse && <button type="button" onClick={props.onUseAnyway} disabled={props.disabled} className="underline">Use anyway</button>}
      <button type="button" onClick={props.onRemove} disabled={props.disabled} aria-label={`Remove ${file.file.name} from the list`}
        className="self-start rounded px-2 text-slate-500 hover:bg-slate-100 sm:self-auto dark:hover:bg-slate-800">✕</button>
    </li>
  );
}
