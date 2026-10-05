import { Fragment, useState } from "react";
import { formatCents } from "../lib/money";
import type { PayslipPerson } from "../lib/types";
import { useRemovePayslips } from "./queries";

function Check(props: { ok: boolean | null; what: string }) {
  if (props.ok === null) return <span title={`${props.what}: unknown`} className="text-slate-400">—</span>;
  return props.ok
    ? <span title={`${props.what} adds up`} className="text-income">✓</span>
    : <span title={`${props.what} does not add up`} className="text-amber-600 dark:text-amber-400">⚠</span>;
}

/** The chosen person's saved months, each expandable to its files. */
export function SavedPayslips(props: { person: PayslipPerson }) {
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useRemovePayslips();
  const { person } = props;
  if (person.months.length === 0) return <p className="text-sm text-slate-500">No payslips saved for {person.name} yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="py-1 pr-3">Month</th><th className="pr-3">Gross</th><th className="pr-3">Net</th>
            <th className="pr-3">Pension (EE+AVC / ER)</th><th className="pr-3">Checks</th><th /></tr>
        </thead>
        <tbody>
          {person.months.map((m) => (
            <Fragment key={m.month}>
              <tr className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-3 font-medium">{m.month}</td>
                <td className="pr-3">{formatCents(m.grossCents)}</td>
                <td className="pr-3">{formatCents(m.netCents)}</td>
                <td className="pr-3">{formatCents(m.pensionEeCents + m.avcCents)} / {formatCents(m.pensionErCents)}</td>
                <td className="pr-3"><Check ok={m.netReconciled} what="Net" />{" "}<Check ok={m.ytdReconciled} what="Year-to-date pension" /></td>
                <td>
                  {m.runs.length === 0
                    ? <span className="text-xs text-slate-500">from the TUI</span>
                    : <button type="button" onClick={() => setOpen(open === m.month ? null : m.month)} aria-expanded={open === m.month}
                        aria-label={`Files for ${m.month}`} className="underline">{m.runs.length} file{m.runs.length === 1 ? "" : "s"}</button>}
                </td>
              </tr>
              {open === m.month && m.runs.map((r) => (
                <tr key={r.sourceFile} className="text-xs text-slate-600 dark:text-slate-400">
                  <td colSpan={5} className="py-1 pl-4 break-all">{r.sourceFile} · gross {formatCents(r.grossCents)} · net {formatCents(r.netCents)}</td>
                  <td>
                    {confirming === r.sourceFile ? (
                      <span className="flex gap-2">
                        <button type="button" disabled={remove.isPending} className="text-expense underline"
                          onClick={() => remove.mutate({ userId: person.id, sourceFiles: [r.sourceFile] }, { onSuccess: () => setConfirming(null) })}>
                          Yes, remove</button>
                        <button type="button" onClick={() => setConfirming(null)} className="underline">Keep</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirming(r.sourceFile)} aria-label={`Remove ${r.sourceFile}`} className="underline">Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {remove.error && <p role="alert" className="text-sm text-expense">Couldn't remove it: {remove.error.message}</p>}
    </div>
  );
}
