import type { PeriodsResponse } from "../lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3 py-1 text-sm border transition-colors ${
    active
      ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
      : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

export function PeriodPicker(props: {
  periods: PeriodsResponse;
  year: number;
  month: number | null;
  onChange: (year: number, month: number | null) => void;
}) {
  const months = props.periods.years.find((y) => y.year === props.year)?.months ?? [];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor="year">Year</label>
      <select
        id="year"
        value={props.year}
        onChange={(e) => props.onChange(Number(e.target.value), null)}
        className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-slate-700"
      >
        {props.periods.years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
      </select>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Month">
        <button type="button" className={chip(props.month === null)} aria-pressed={props.month === null}
          onClick={() => props.onChange(props.year, null)}>All</button>
        {months.map((m) => (
          <button key={m} type="button" className={chip(props.month === m)} aria-pressed={props.month === m}
            onClick={() => props.onChange(props.year, m)}>{MONTHS[m - 1]}</button>
        ))}
      </div>
    </div>
  );
}
