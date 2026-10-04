import type { ImportMapping } from "../lib/types";

const field = "rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";

/** Every choice re-parses at once; the page owns the mapping. */
export function MappingForm(props: {
  header: string[]; headerRow: number; gridRows: number; mapping: ImportMapping; onChange: (m: ImportMapping) => void;
}) {
  const { mapping, header } = props;
  // -1 when no header was found: the field is then empty rather than 0.
  const headerRowShown = mapping.headerRow ?? props.headerRow;
  const set = (patch: Partial<ImportMapping>) => props.onChange({ ...mapping, ...patch });
  const column = (label: string, value: string, onPick: (v: string) => void, optional = false) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)} className={field}>
        {optional ? <option value="">None</option> : <option value="" disabled>Choose a column</option>}
        {header.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
  return (
    <fieldset aria-label="Mapping" className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-800">
      {column("Date", mapping.date, (date) => set({ date }))}
      {column("Merchant", mapping.merchant, (merchant) => set({ merchant }))}
      {column(mapping.amountOut ? "Money in" : "Amount", mapping.amount, (amount) => set({ amount }))}
      {column("Money out (optional)", mapping.amountOut ?? "", (v) => set({ amountOut: v || undefined }), true)}
      <label className="flex flex-col gap-1 text-sm">
        Type
        <select aria-label="Type" value={mapping.typeMode} disabled={!!mapping.amountOut}
          onChange={(e) => set({ typeMode: e.target.value as ImportMapping["typeMode"] })} className={field}>
          <option value="auto">From the sign (negative = expense)</option>
          <option value="expense">All expenses</option>
          <option value="income">All income</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Date order
        <select aria-label="Date order" value={mapping.dateOrder}
          onChange={(e) => set({ dateOrder: e.target.value as ImportMapping["dateOrder"] })} className={field}>
          <option value="dmy">Day first (01/09 = 1 September)</option>
          <option value="mdy">Month first (09/01 = 1 September)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Header row
        <input aria-label="Header row" type="number" min={1} max={props.gridRows}
          value={headerRowShown < 0 ? "" : headerRowShown + 1}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isNaN(n)) return;
            set({ headerRow: Math.min(Math.max(Math.round(n), 1), props.gridRows) - 1 });
          }} className={field} />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span>Only import rows where (optional)</span>
        <div className="flex gap-2">
          <select aria-label="Only rows where" value={mapping.filter?.column ?? ""} className={field}
            onChange={(e) => set({ filter: e.target.value ? { column: e.target.value, value: mapping.filter?.value ?? "" } : undefined })}>
            <option value="">No filter</option>
            {header.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <input aria-label="Only rows where value is" placeholder="is…" value={mapping.filter?.value ?? ""}
            disabled={!mapping.filter} className={`${field} min-w-0 flex-1`}
            onChange={(e) => mapping.filter && set({ filter: { column: mapping.filter.column, value: e.target.value } })} />
        </div>
      </div>
    </fieldset>
  );
}

/** "Date ← Completed Date · Merchant ← Description · Amount ← Amount · State = COMPLETED". */
export function mappingSummary(m: ImportMapping): string {
  return [
    `Date ← ${m.date}`,
    `Merchant ← ${m.merchant}`,
    m.amountOut ? `Money in ← ${m.amount} · Money out ← ${m.amountOut}` : `Amount ← ${m.amount}`,
    ...(m.filter ? [`${m.filter.column} = ${m.filter.value}`] : []),
  ].join(" · ");
}
