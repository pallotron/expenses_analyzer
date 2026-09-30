import { useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ApiError } from "../lib/api";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { BreakdownList } from "./BreakdownList";
import { CashFlowTiles } from "./CashFlowTiles";
import { FiltersBar } from "./FiltersBar";
import { MonthlyChart } from "./MonthlyChart";
import { MonthlyGrid } from "./MonthlyGrid";
import { parseParams, toSearchParams, type SummaryParams } from "./params";
import { PeriodPicker } from "./PeriodPicker";
import { usePeriods, useSummary } from "./queries";
import { SpendingSplit } from "./SpendingSplit";

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
      {!(props.error instanceof ApiError && props.error.status === 403) && (
        <button type="button" onClick={props.onRetry} className="rounded-md border px-3 py-1">Retry</button>
      )}
    </Card>
  );
}

export function SummaryPage() {
  const [search, setSearch] = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
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
  // Later months of the year are empty, and would only pad the chart and grids.
  const lastMonth = Math.max(1, ...(known?.find((y) => y.year === year)?.months ?? []));
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
        <Card><p>No transactions yet. For now, data is added from the terminal app.</p></Card>
      </main>
    );
  }

  const data = summary.data;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      {/* Two rows at every width: up to twelve month chips need the whole line. */}
      <header className="flex flex-col gap-2">
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
          <CashFlowTiles cashFlow={data.cashFlow} monthAverage={data.monthAverage} />
          <SpendingSplit split={data.spendingType} monthView={data.month !== null} />
          {data.monthlyTotals && <MonthlyChart totals={data.monthlyTotals} lastMonth={lastMonth} />}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <BreakdownList title="Expense categories" tone="expense" showShare limit={10}
                items={data.expenseCategories.map((c) => ({ label: c.category, sublabel: c.spendingType === "essential" ? "Ess." : "Disc.", amountCents: c.amountCents, kind: c.spendingType ?? undefined }))} />
              <BreakdownList title="Top expense merchants" tone="expense" limit={10} collapsible
                items={data.topMerchants.map((m) => ({ label: m.merchant, sublabel: m.category, amountCents: m.amountCents, count: m.txnCount, kind: m.spendingType ?? undefined }))} />
            </div>
            <div className="flex flex-col gap-4">
              <BreakdownList title="Income categories" tone="income" showShare limit={10} collapsible
                items={data.incomeCategories.map((c) => ({ label: c.category, amountCents: c.amountCents, kind: "income" as const }))} />
              <BreakdownList title="Top income sources" tone="income" limit={10} collapsible
                items={data.topIncome.map((m) => ({ label: m.merchant, sublabel: m.category, amountCents: m.amountCents, count: m.txnCount, kind: "income" as const }))} />
            </div>
          </div>
          {data.monthly && (
            <details open={desktop} className="group">
              <summary className="cursor-pointer select-none py-1 text-sm font-semibold">Monthly detail</summary>
              <div className="mt-2 flex flex-col gap-4">
                <MonthlyGrid title="Monthly expenses" grid={data.monthly.expense} tone="expense" lastMonth={lastMonth} />
                <MonthlyGrid title="Monthly income" grid={data.monthly.income} tone="income" lastMonth={lastMonth} />
              </div>
            </details>
          )}
        </div>
      )}
    </main>
  );
}
