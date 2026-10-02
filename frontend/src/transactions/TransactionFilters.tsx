// frontend/src/transactions/TransactionFilters.tsx
import { useEffect, useRef, useState } from "react";

import type { LookupsResponse } from "../lib/types";
import { activeFilterCount, type TxParams } from "./params";
import { SourcePills } from "./SourcePills";

export const DEBOUNCE_MS = 300;

type TextKey = "from" | "to" | "merchant" | "category" | "tags" | "min" | "max";

/** A box that shows the URL's value and reports edits after a pause. */
function DebouncedInput(props: {
  label: string; name: TextKey; value: string | undefined; onChange: (patch: Partial<TxParams>) => void;
  type?: string; list?: string; inputMode?: "decimal"; placeholder?: string;
}) {
  const [text, setText] = useState(props.value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  // The timer must call the newest callback: an older one closes over stale params.
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const key = props.name;
  // Back/forward or a chip changed the URL: show it, and drop a pending edit.
  useEffect(() => { clearTimeout(timer.current); pending.current = null; setText(props.value ?? ""); }, [props.value]);
  // Unmounting (sheet closed, layout switch) keeps a pending edit rather than losing it.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) onChangeRef.current({ [key]: pending.current || undefined });
  }, [key]);
  const id = `filter-${props.name}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
      {props.label}
      <input id={id} type={props.type ?? "text"} list={props.list} inputMode={props.inputMode} placeholder={props.placeholder}
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          pending.current = value;
          timer.current = setTimeout(() => {
            pending.current = null;
            onChangeRef.current({ [key]: value || undefined });
          }, DEBOUNCE_MS);
        }}
        className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:text-slate-100" />
    </label>
  );
}

function Segmented<T extends string>(props: {
  label: string; options: [T | undefined, string][]; value: T | undefined; onChange: (v: T | undefined) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
      {props.options.map(([value, text]) => (
        <button key={text} type="button" aria-pressed={props.value === value} onClick={() => props.onChange(value)}
          className={`px-2.5 py-1 ${props.value === value ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** One removable chip per active filter (phone). */
function chips(p: TxParams): { label: string; patch: Partial<TxParams> }[] {
  const out: { label: string; patch: Partial<TxParams> }[] = [];
  if (p.merchant) out.push({ label: `Merchant: ${p.merchant}`, patch: { merchant: undefined } });
  if (p.category) out.push({ label: `Category: ${p.category}`, patch: { category: undefined } });
  if (p.tags) out.push({ label: `Tags: ${p.tags}`, patch: { tags: undefined } });
  if (p.min) out.push({ label: `≥ €${p.min}`, patch: { min: undefined } });
  if (p.max) out.push({ label: `≤ €${p.max}`, patch: { max: undefined } });
  if (p.type) out.push({ label: p.type === "income" ? "Income" : "Expenses", patch: { type: undefined } });
  if (p.budget) out.push({ label: p.budget === "essential" ? "Essential" : "Discretionary", patch: { budget: undefined } });
  if (p.sources) out.push({ label: p.sources.length ? p.sources.join(", ") : "No sources", patch: { sources: undefined } });
  if (p.excludeHidden) out.push({ label: "Hidden tags excluded", patch: { excludeHidden: false } });
  return out;
}

export function TransactionFilters(props: {
  params: TxParams;
  lookups: LookupsResponse | undefined;
  onChange: (patch: Partial<TxParams>) => void;
  onClear: () => void;
  desktop: boolean;
}) {
  const { params: p, onChange } = props;
  const [open, setOpen] = useState(false);

  const controls = (
    <div className={props.desktop ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700"}>
      <div className={props.desktop ? "grid grid-cols-4 gap-3" : "grid grid-cols-2 gap-3"}>
        <DebouncedInput label="From" name="from" type="date" value={p.from} onChange={onChange} />
        <DebouncedInput label="To" name="to" type="date" value={p.to} onChange={onChange} />
        <DebouncedInput label="Amount min" name="min" inputMode="decimal" placeholder="0.00" value={p.min} onChange={onChange} />
        <DebouncedInput label="Amount max" name="max" inputMode="decimal" placeholder="0.00" value={p.max} onChange={onChange} />
        <DebouncedInput label="Merchant" name="merchant" placeholder='contains… ("exact")' value={p.merchant} onChange={onChange} />
        <DebouncedInput label="Category" name="category" list="tx-categories" placeholder='contains… ("exact")' value={p.category} onChange={onChange} />
        <DebouncedInput label="Tags" name="tags" list="tx-tags" placeholder="contains…" value={p.tags} onChange={onChange} />
      </div>
      <datalist id="tx-categories">{props.lookups?.categories.map((c) => <option key={c} value={`"${c}"`} />)}</datalist>
      <datalist id="tx-tags">{props.lookups?.tags.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Type" value={p.type} onChange={(type) => onChange({ type })}
          options={[[undefined, "All"], ["expense", "Expense"], ["income", "Income"]]} />
        <Segmented label="Budget" value={p.budget} onChange={(budget) => onChange({ budget })}
          options={[[undefined, "All"], ["essential", "Essential"], ["discretionary", "Discretionary"]]} />
      </div>
      {props.lookups && (
        <SourcePills sources={props.lookups.sources} selected={p.sources} compact={!props.desktop}
          onChange={(sources) => onChange({ sources })} />
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {p.excludeHidden && (
          <button type="button" onClick={() => onChange({ excludeHidden: false })}
            className="rounded-full border border-slate-300 px-2.5 py-0.5 dark:border-slate-700">
            Hidden tags excluded ✕
          </button>
        )}
        <button type="button" onClick={props.onClear} className="underline">Clear filters</button>
      </div>
    </div>
  );

  if (props.desktop) return <div className="text-sm">{controls}</div>;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="self-start rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700">
        Filters ({activeFilterCount(p)})
      </button>
      {open && controls}
      <div className="flex flex-wrap gap-2">
        {chips(p).map((c) => (
          <button key={c.label} type="button" aria-label={`Remove ${c.label}`} onClick={() => onChange(c.patch)}
            className="max-w-full truncate rounded-full bg-slate-100 px-2.5 py-0.5 dark:bg-slate-800">
            {c.label} ✕
          </button>
        ))}
      </div>
    </div>
  );
}
