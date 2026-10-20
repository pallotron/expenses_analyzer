import { Link } from "react-router";
import { formatCents } from "../lib/money";
import type { SpendingPacing, SummaryResponse } from "../lib/types";

const DAY = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * _build_spending_type_line: the split, and each side against its budget. In
 * the year still running, each side is paced instead: spend so far against
 * the budget for the share of the year gone, and where the year is heading.
 */
export function SpendingSplit(props: {
  split: SummaryResponse["spendingType"]; pacing?: SpendingPacing | null; monthView: boolean; onEdit?: () => void;
}) {
  const { essentialCents, discretionaryCents, unclassifiedCents } = props.split;
  const pacing = props.pacing ?? null;
  const total = essentialCents + discretionaryCents;
  const share = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);
  const divisor = props.monthView ? 12 : 1;
  const period = props.monthView ? "/mo" : "/yr";

  const budgetLine = (cents: number, annual: number | null) => {
    if (annual === null) return null;
    const budget = annual / divisor;
    const used = budget ? Math.round((cents / budget) * 100) : null;
    return (
      <span className={cents <= budget ? "text-income" : "text-expense"}>
        {" "}· {used}% of {formatCents(budget)}{period}
      </span>
    );
  };

  const paceLine = (pace: SpendingPacing["essential"], annual: number | null) => {
    if (annual === null) return <span className="text-slate-600 dark:text-slate-400"> · heading for {formatCents(pace.projectedCents)}</span>;
    const toDate = Math.round(annual * pacing!.elapsed);
    return (
      <span className={pace.projectedCents <= annual ? "text-income" : "text-expense"}>
        {" "}· {formatCents(toDate)} budgeted so far · heading for {formatCents(pace.projectedCents)} of {formatCents(annual)}
      </span>
    );
  };

  const side = (label: string, cents: number, annual: number | null, pace: SpendingPacing["essential"] | undefined, tone: string) => (
    <div>
      <span className={`mr-1 inline-block h-2 w-2 rounded-full ${tone}`} />
      <span className="font-medium">{label}</span> {formatCents(cents)} ({share(cents)}%)
      {pace ? paceLine(pace, annual) : budgetLine(cents, annual)}
    </div>
  );

  return (
    <section aria-label="Essential and discretionary" className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
      <div className="mb-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {/* Empty segments are left out, or the gap would draw a sliver for them. */}
        {essentialCents > 0 && <div className="bg-essential" style={{ width: `${share(essentialCents)}%` }} />}
        {discretionaryCents > unclassifiedCents && (
          <div className="bg-discretionary" style={{ width: `${share(discretionaryCents - unclassifiedCents)}%` }} />
        )}
        {unclassifiedCents > 0 && <div className="bg-unclassified" style={{ width: `${share(unclassifiedCents)}%` }} />}
      </div>
      <div className="flex flex-col gap-1 md:flex-row md:gap-6">
        {side("Essential", essentialCents, props.split.essentialBudgetCents, pacing?.essential, "bg-essential")}
        {side("Discretionary", discretionaryCents, props.split.discretionaryBudgetCents, pacing?.discretionary, "bg-discretionary")}
        {props.onEdit && (
          <button type="button" onClick={props.onEdit} aria-label="Edit budgets" className="self-start underline md:ml-auto print:hidden">Edit…</button>
        )}
      </div>
      {unclassifiedCents > 0 && (
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-unclassified" />
          {formatCents(unclassifiedCents)} ({share(unclassifiedCents)}%) is in categories with no type, counted as
          discretionary.{" "}
          <Link to="/budgets" className="underline print:hidden">Give them a type</Link>
        </p>
      )}
      {pacing && (
        <p className="mt-2 text-xs text-slate-500">
          Year so far: to {DAY.format(new Date(`${pacing.asOf}T00:00:00Z`))}, the latest expense
          ({Math.round(pacing.elapsed * 100)}% of the year).{" "}
          {pacing.basis === "last-year"
            ? "The rest of the year is projected as last year spent it."
            : "The rest of the year is projected at this year's rate so far."}
        </p>
      )}
    </section>
  );
}
