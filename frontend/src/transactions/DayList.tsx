import type { TransactionRow } from "../lib/types";
import { signedAmount } from "./amount";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 29 Sep". Built by hand: Intl's short month differs by ICU ("Sept"). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** Phone list: rows in the order given, under a heading per day. */
export function DayList(props: {
  rows: TransactionRow[];
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onOpen: (row: TransactionRow) => void;
}) {
  const days: { date: string; rows: TransactionRow[] }[] = [];
  for (const r of props.rows) {
    const last = days[days.length - 1];
    if (last?.date === r.date) last.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => {
        const label = dayLabel(day.date);
        return (
          <section key={day.date}>
            <h3 className="mb-1 border-b border-slate-200 pb-0.5 text-xs font-semibold text-slate-500 dark:border-slate-800">{label}</h3>
            <ul aria-label={label} className="flex flex-col">
              {day.rows.map((r) => (
                <li key={r.id} onClick={() => props.onOpen(r)} aria-selected={props.selected.has(r.id) || undefined}
                  className={`flex cursor-pointer items-start gap-2 px-2 py-1.5 text-sm ${props.selected.has(r.id) ? "!bg-slate-200 dark:!bg-slate-800" : ""} odd:bg-white even:bg-slate-100 dark:odd:bg-slate-950 dark:even:bg-slate-900`}>
                  <label className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4" aria-label={`Select ${r.merchant}, ${r.date}, ${signedAmount(r).text}`}
                      checked={props.selected.has(r.id)} onChange={() => props.onToggle(r.id)} onClick={(e) => e.stopPropagation()} />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <button type="button" className="min-w-0 truncate text-left" aria-label={`Edit ${r.merchant}`}
                        onClick={(e) => { e.stopPropagation(); props.onOpen(r); }}>{r.merchant}</button>
                      <span className={`shrink-0 ${signedAmount(r).className}`.trimEnd()}>{signedAmount(r).text}</span>
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {[r.category, r.source, r.tags].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
