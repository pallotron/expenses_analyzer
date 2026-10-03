import { Chevron } from "../lib/Chevron";
import type { MerchantRow } from "../lib/types";
import { BudgetLabel, CategoryLabel, RulesLabel, TotalLabel, TransactionsLink } from "./MerchantCells";
import type { MerchantSort } from "./params";

const COLUMNS: [MerchantSort, string][] = [
  ["name", "Merchant"], ["category", "Category"], ["budget", "Budget"], ["count", "Transactions"],
  ["total", "Total"], ["last", "Last"], ["rules", "Rules"],
];
const RIGHT = new Set<MerchantSort>(["count", "total"]);
const TEXT = new Set<MerchantSort>(["name", "category", "budget"]);

export function MerchantTable(props: {
  rows: MerchantRow[];
  sort: MerchantSort;
  dir: "asc" | "desc";
  onSort: (sort: MerchantSort, dir: "asc" | "desc") => void;
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onToggleShown: (ids: number[], on: boolean) => void;
  onOpen: (row: MerchantRow) => void;
}) {
  const allShown = props.rows.length > 0 && props.rows.every((r) => props.selected.has(r.id));
  const someShown = props.rows.some((r) => props.selected.has(r.id));
  const click = (key: MerchantSort) => props.onSort(key,
    key === props.sort ? (props.dir === "asc" ? "desc" : "asc") : TEXT.has(key) ? "asc" : "desc");
  return (
    <div className="overflow-x-auto md:overflow-visible">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th scope="col" className="bg-white px-2 py-1 font-normal shadow-[inset_0_-1px_0_theme(colors.slate.200)] md:sticky md:top-[calc(var(--topbar-h,0px)+var(--controls-h,0px))] md:z-10 dark:bg-slate-950 dark:shadow-[inset_0_-1px_0_theme(colors.slate.800)]">
              <label className="-m-2 inline-flex h-11 w-11 items-center justify-center">
                <input type="checkbox" className="h-4 w-4" aria-label="Select all shown" checked={allShown}
                  ref={(el) => { if (el) el.indeterminate = someShown && !allShown; }}
                  onChange={(e) => props.onToggleShown(props.rows.map((r) => r.id), e.target.checked)} />
              </label>
            </th>
            {COLUMNS.map(([key, label]) => (
              <th key={key} scope="col" className={`bg-white px-2 py-1 font-normal shadow-[inset_0_-1px_0_theme(colors.slate.200)] md:sticky md:top-[calc(var(--topbar-h,0px)+var(--controls-h,0px))] md:z-10 dark:bg-slate-950 dark:shadow-[inset_0_-1px_0_theme(colors.slate.800)] ${RIGHT.has(key) ? "text-right" : ""}`}
                aria-sort={props.sort === key ? (props.dir === "asc" ? "ascending" : "descending") : undefined}>
                <button type="button" onClick={() => click(key)} className="inline-flex items-center gap-1 whitespace-nowrap">
                  {label}{props.sort === key && <Chevron dir={props.dir === "asc" ? "up" : "down"} size={14} className="inline" />}
                </button>
              </th>
            ))}
            <th scope="col" className="bg-white px-2 py-1 font-normal shadow-[inset_0_-1px_0_theme(colors.slate.200)] md:sticky md:top-[calc(var(--topbar-h,0px)+var(--controls-h,0px))] md:z-10 dark:bg-slate-950 dark:shadow-[inset_0_-1px_0_theme(colors.slate.800)]">
              <span className="sr-only">Transactions link</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.id} onClick={() => props.onOpen(r)} aria-selected={props.selected.has(r.id) || undefined}
              className={`cursor-pointer ${props.selected.has(r.id) ? "!bg-slate-200 dark:!bg-slate-800" : ""}  odd:bg-white even:bg-slate-100 odd:hover:bg-slate-200 even:hover:bg-slate-200 dark:odd:bg-slate-950 dark:even:bg-slate-900 dark:odd:hover:bg-slate-800 dark:even:hover:bg-slate-800`}>
              <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                <label className="-m-2 inline-flex h-11 w-11 items-center justify-center">
                  <input type="checkbox" className="h-4 w-4" aria-label={`Select ${r.name}`}
                    checked={props.selected.has(r.id)} onChange={() => props.onToggle(r.id)} />
                </label>
              </td>
              <td className="max-w-32 truncate px-2 py-2 lg:max-w-64">
                <button type="button" className="max-w-full truncate text-left" aria-label={`Edit ${r.name}`}
                  onClick={(e) => { e.stopPropagation(); props.onOpen(r); }}>{r.name}</button>
              </td>
              <td className="px-2 py-2 lg:whitespace-nowrap"><CategoryLabel row={r} /></td>
              <td className="px-2 py-2"><BudgetLabel row={r} /></td>
              <td className="px-2 py-2 text-right">{r.count}</td>
              <td className="px-2 py-2 text-right whitespace-nowrap"><TotalLabel row={r} /></td>
              <td className="px-2 py-2 whitespace-nowrap">{r.lastDate ?? ""}</td>
              <td className="max-w-40 truncate px-2 py-2"><RulesLabel row={r} /></td>
              <td className="px-2 py-2 text-right"><TransactionsLink name={r.name} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
