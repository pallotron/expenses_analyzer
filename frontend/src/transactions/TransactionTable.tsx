import type { TransactionRow } from "../lib/types";
import { Chevron } from "../lib/Chevron";
import { signedAmount } from "./amount";
import type { SortKey } from "./params";

const COLUMNS: [SortKey, string][] = [
  ["date", "Date"], ["merchant", "Merchant"], ["amount", "Amount"],
  ["source", "Source"], ["category", "Category"], ["budget", "Budget"], ["tags", "Tags"],
];

function compare(a: TransactionRow, b: TransactionRow, sort: SortKey): number {
  if (sort === "amount") return a.amountCents - b.amountCents;
  return String(a[sort]).localeCompare(String(b[sort]), undefined, { sensitivity: "base" });
}

/** Client-side, as the TUI's header click was. Ties stay newest first. */
export function sortRows(rows: TransactionRow[], sort: SortKey, dir: "asc" | "desc"): TransactionRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    sign * compare(a, b, sort) || b.date.localeCompare(a.date) || b.id - a.id);
}

function AmountCell({ row }: { row: TransactionRow }) {
  const { text, className } = signedAmount(row);
  return <td className={`px-2 py-2 text-right whitespace-nowrap ${className}`.trimEnd()}>{text}</td>;
}

export function TransactionTable(props: {
  rows: TransactionRow[];
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (sort: SortKey, dir: "asc" | "desc") => void;
}) {
  const click = (key: SortKey) => props.onSort(key,
    key === props.sort ? (props.dir === "asc" ? "desc" : "asc") : key === "date" ? "desc" : "asc");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            {COLUMNS.map(([key, label]) => (
              <th key={key} scope="col" className={`px-2 py-1 font-normal ${key === "amount" ? "text-right" : ""}`}
                aria-sort={props.sort === key ? (props.dir === "asc" ? "ascending" : "descending") : undefined}>
                <button type="button" onClick={() => click(key)} className="inline-flex items-center gap-1 whitespace-nowrap">
                  {label}{props.sort === key && <Chevron dir={props.dir === "asc" ? "up" : "down"} size={14} className="inline" />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.id} className="odd:bg-white even:bg-slate-50 odd:hover:bg-slate-200/70 even:hover:bg-slate-200/70 dark:odd:bg-slate-950 dark:even:bg-slate-900/60 dark:odd:hover:bg-slate-800 dark:even:hover:bg-slate-800">
              <td className="px-2 py-2 whitespace-nowrap">{r.date}</td>
              <td className="max-w-64 truncate px-2 py-2" title={r.merchantRaw}>{r.merchant}</td>
              <AmountCell row={r} />
              <td className="px-2 py-2 whitespace-nowrap">{r.source}</td>
              <td className="px-2 py-2 whitespace-nowrap">{r.category}</td>
              <td className="px-2 py-2">{r.type === "expense" ? r.budget : ""}</td>
              <td className="px-2 py-2 text-xs text-slate-500">{r.tags}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
