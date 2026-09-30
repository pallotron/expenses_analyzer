import { formatCents } from "../lib/money";
import type { SummaryResponse } from "../lib/types";

/** _build_spending_type_line: the split, and each side against its budget. */
export function SpendingSplit(props: { split: SummaryResponse["spendingType"]; monthView: boolean }) {
  const { essentialCents, discretionaryCents } = props.split;
  const total = essentialCents + discretionaryCents;
  const share = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);
  const divisor = props.monthView ? 12 : 1;
  const period = props.monthView ? "/mo" : "/yr";

  const side = (label: string, cents: number, annual: number | null, tone: string) => {
    const budget = annual === null ? null : annual / divisor;
    const used = budget ? Math.round((cents / budget) * 100) : null;
    return (
      <div>
        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${tone}`} />
        <span className="font-medium">{label}</span> {formatCents(cents)} ({share(cents)}%)
        {budget !== null && (
          <span className={cents <= budget ? "text-income" : "text-expense"}>
            {" "}· {used}% of {formatCents(budget)}{period}
          </span>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Essential and discretionary" className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
      <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="bg-essential" style={{ width: `${share(essentialCents)}%` }} />
        <div className="bg-discretionary" style={{ width: `${share(discretionaryCents)}%` }} />
      </div>
      <div className="flex flex-col gap-1 md:flex-row md:gap-6">
        {side("Essential", essentialCents, props.split.essentialBudgetCents, "bg-essential")}
        {side("Discretionary", discretionaryCents, props.split.discretionaryBudgetCents, "bg-discretionary")}
      </div>
    </section>
  );
}
