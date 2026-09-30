import { useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { NOT_SET_UP } from "../lib/api";
import { formatCents } from "../lib/money";
import { FiltersBar } from "./FiltersBar";
import { parseParams, toSearchParams, type SummaryParams } from "./params";
import { PeriodPicker } from "./PeriodPicker";
import { usePeriods, useSummary } from "./queries";

function Card(props: { title?: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      {props.title && <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">{props.title}</h2>}
      {props.children}
    </section>
  );
}

function ErrorCard(props: { error: Error; onRetry: () => void }) {
  return (
    <Card>
      <p className="mb-3">{props.error.message}</p>
      {props.error.message !== NOT_SET_UP && (
        <button type="button" onClick={props.onRetry} className="rounded-md border px-3 py-1">Retry</button>
      )}
    </Card>
  );
}

export function SummaryPage() {
  const [search, setSearch] = useSearchParams();
  const params = parseParams(search);
  const periods = usePeriods();
  // The URL is only checked for syntax; what exists is known here.
  const known = periods.data?.years;
  const year = params.year !== null && known?.some((y) => y.year === params.year)
    ? params.year
    : known?.[0]?.year ?? null;
  const month = params.month !== null && known?.find((y) => y.year === year)?.months.includes(params.month)
    ? params.month
    : null;
  const view: SummaryParams = { ...params, year, month };
  const summary = useSummary(view);
  // Survives a load or an error, so the tag filter does not flicker or vanish.
  const tags = useRef<{ patterns: string[]; hiddenCents: number } | undefined>(undefined);
  if (summary.data) tags.current = { patterns: summary.data.excludedPatterns, hiddenCents: summary.data.hiddenCents };
  const update = (patch: Partial<SummaryParams>) => setSearch(toSearchParams({ ...view, ...patch }));

  if (periods.error) return <main className="mx-auto max-w-6xl p-4"><ErrorCard error={periods.error} onRetry={() => periods.refetch()} /></main>;
  if (periods.isPending) return <main className="mx-auto max-w-6xl p-4" aria-busy="true"><div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" /></main>;
  if (year === null) {
    return (
      <main className="mx-auto max-w-6xl p-4">
        <Card><p>No transactions yet. Import some from the Transactions screen, or link a bank.</p></Card>
      </main>
    );
  }

  const data = summary.data;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <PeriodPicker periods={periods.data} year={year} month={view.month}
          onChange={(y, m) => update({ year: y, month: m })} />
        <FiltersBar sources={periods.data.sources} selected={view.sources} hidden={view.hidden}
          hiddenCents={tags.current?.hiddenCents ?? 0} excludedPatterns={tags.current?.patterns}
          onSources={(s) => update({ sources: s })} onHidden={(h) => update({ hidden: h })} />
      </header>

      {summary.error && <ErrorCard error={summary.error} onRetry={() => summary.refetch()} />}
      {!data && !summary.error && <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" aria-busy="true" />}
      {data && (
        <div className={`flex flex-col gap-4 transition-opacity ${summary.isPlaceholderData ? "opacity-60" : ""}`}>
          {/* Task 9 replaces this line with CashFlowTiles, SpendingSplit, MonthlyChart and the breakdown columns. */}
          <p>Income <span>{formatCents(data.cashFlow.incomeCents)}</span></p>
          {/* Task 10 adds the monthly grids here. */}
        </div>
      )}
    </main>
  );
}
