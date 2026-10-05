import type { SpendingKind } from "../lib/types";

const KINDS: [SpendingKind, string][] = [["essential", "Essential"], ["discretionary", "Discretionary"]];

/** Two buttons, one pressed: a category is essential or discretionary. */
export function TypeSwitch(props: {
  label: string; value: SpendingKind; onChange: (v: SpendingKind) => void; disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={props.label}
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-slate-300 text-xs dark:border-slate-700">
      {KINDS.map(([kind, text]) => {
        const on = props.value === kind;
        return (
          <button key={kind} type="button" aria-pressed={on} disabled={props.disabled}
            onClick={() => { if (!on) props.onChange(kind); }}
            className={`flex min-h-9 items-center gap-1.5 px-2.5 disabled:opacity-50 ${on
              ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${kind === "essential" ? "bg-essential" : "bg-discretionary"}`} />
            {text}
          </button>
        );
      })}
    </div>
  );
}
