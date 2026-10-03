import type { MerchantRow } from "../lib/types";
import { BudgetLabel, CategoryLabel, TotalLabel, TransactionsLink } from "./MerchantCells";

/** Phone list, in the order given. */
export function MerchantCards(props: { rows: MerchantRow[]; onOpen: (row: MerchantRow) => void }) {
  return (
    <ul aria-label="Merchants" className="flex flex-col">
      {props.rows.map((r) => (
        <li key={r.id} onClick={() => props.onOpen(r)}
          className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-sm odd:bg-white even:bg-slate-100 dark:odd:bg-slate-950 dark:even:bg-slate-900">
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
