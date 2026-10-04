import { formatCents } from "../lib/money";
import { SKIP_REASONS, type ImportMapping, type ParsedImport, type SkipReason } from "../lib/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function reasonLabel(reason: SkipReason, mapping: ImportMapping, n: number): string {
  switch (reason) {
    case "invalidDate": return plural(n, "invalid date");
    case "emptyMerchant": return plural(n, "empty merchant");
    case "zeroAmount": return plural(n, "zero amount");
    case "notDebit": return `${n} not a debit (PayPal)`;
    case "filtered": return `${n} not ${mapping.filter?.value ?? ""}`;
  }
}

/** The first rows as they will be imported, the counts, and each skip reason's rows. */
export function Preview(props: { parsed: ParsedImport; mapping: ImportMapping }) {
  const { rows, skipped } = props.parsed;
  const expenses = rows.filter((r) => r.type === "expense").length;
  const reasons = SKIP_REASONS.filter((r) => skipped[r].length > 0);
  return (
    <section aria-label="Parsed preview" className="flex flex-col gap-2">
      <p className="text-sm">
        {`${rows.length} to import (${plural(expenses, "expense")}, ${rows.length - expenses} income)`}
      </p>
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-x-4 text-sm text-slate-600 dark:text-slate-400">
          <span>Skipped:</span>
          {reasons.map((r) => (
            <details key={r}>
              <summary className="cursor-pointer">{reasonLabel(r, props.mapping, skipped[r].length)}</summary>
              <span>{`Rows ${skipped[r].join(", ")}`}</span>
            </details>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table aria-label="Preview" className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="p-2">Date</th><th className="p-2">Merchant</th><th className="p-2 text-right">Amount</th><th className="p-2">Type</th></tr></thead>
            <tbody>
              {rows.slice(0, 10).map((r) => (
                <tr key={r.line} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-2 whitespace-nowrap">{r.date}</td>
                  <td className="p-2">{r.merchant}</td>
                  <td className={`p-2 text-right whitespace-nowrap ${r.type === "income" ? "text-income" : ""}`}>
                    {formatCents(r.type === "income" ? r.amountCents : -r.amountCents)}
                  </td>
                  <td className="p-2">{r.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
