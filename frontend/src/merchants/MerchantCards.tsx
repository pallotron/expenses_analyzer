import type { MerchantRow } from "../lib/types";
import { BudgetLabel, CategoryLabel, TotalLabel, TransactionsLink } from "./MerchantCells";

/** Phone list, in the order given. */
export function MerchantCards(props: {
  rows: MerchantRow[]; selected: ReadonlySet<number>; onToggle: (id: number) => void; onOpen: (row: MerchantRow) => void;
}) {
  return (
    <ul aria-label="Merchants" className="flex flex-col">
      {props.rows.map((r) => (
        <li key={r.id} onClick={() => props.onOpen(r)} aria-selected={props.selected.has(r.id) || undefined}
          className={`flex cursor-pointer items-start gap-2 px-2 py-1.5 text-sm ${props.selected.has(r.id) ? "!bg-slate-200 dark:!bg-slate-800" : ""} odd:bg-white even:bg-slate-100 dark:odd:bg-slate-950 dark:even:bg-slate-900`}>
          <label className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="h-4 w-4" aria-label={`Select ${r.name}`}
              checked={props.selected.has(r.id)} onChange={() => props.onToggle(r.id)} onClick={(e) => e.stopPropagation()} />
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-3">
              <button type="button" className="min-w-0 truncate text-left" aria-label={`Edit ${r.name}`}
                onClick={(e) => { e.stopPropagation(); props.onOpen(r); }}>{r.name}</button>
              <TotalLabel row={r} className="shrink-0" />
            </div>
            <div className="truncate text-xs text-slate-500">
              <CategoryLabel row={r} />
              {r.type === "expense" && <> · <BudgetLabel row={r} /></>}
              {" · "}{r.count} {r.count === 1 ? "transaction" : "transactions"}
              {r.lastDate && <> · {r.lastDate}</>}
            </div>
            {r.rules[0] && <div className="truncate font-mono text-xs text-slate-500">{r.rules[0].pattern}</div>}
          </div>
          <TransactionsLink name={r.name} />
        </li>
      ))}
    </ul>
  );
}
