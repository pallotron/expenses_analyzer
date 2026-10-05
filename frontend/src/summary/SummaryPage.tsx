import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ApiError } from "../lib/api";
import { drillDown, toTransactionsSearch, type DrillTarget } from "../lib/types";
import { StickyPanel } from "../lib/StickyPanel";
import { Toast, useToast } from "../lib/Toast";
import { BreakdownList } from "./BreakdownList";
import { CashFlowTiles } from "./CashFlowTiles";
import { FiltersBar } from "./FiltersBar";
import { BudgetsSheet } from "../budgets/BudgetsSheet";
import { HiddenTagsSheet } from "./HiddenTagsSheet";
import { MonthlyChart } from "./MonthlyChart";
import { MonthlyGrid } from "./MonthlyGrid";
import { parseParams, toSearchParams, type SummaryParams, type Tab } from "./params";
import { PeriodPicker } from "./PeriodPicker";
import { usePeriods, useSummary } from "./queries";
import { SpendingSplit } from "./SpendingSplit";
import { SummaryTabs } from "./SummaryTabs";

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
  // A month view has no grids, so no Monthly tab.
  const tabs: { id: Tab; label: string }[] = [
    { id: "expenses", label: "Expenses" },
    { id: "income", label: "Income" },
    ...(month === null ? [{ id: "monthly" as const, label: "Monthly" }] : []),
  ];
  const tab: Tab = tabs.some((t) => t.id === view.tab) ? view.tab : "expenses";
  const summary = useSummary(view);
  // Survives a load or an error, so the tag filter does not flicker or vanish.
  const tags = useRef<{ patterns: string[]; hiddenCents: number; hiddenIncomeCents: number } | undefined>(undefined);
  if (summary.data) {
    const { excludedPatterns: patterns, hiddenCents, hiddenIncomeCents } = summary.data;
    tags.current = { patterns, hiddenCents, hiddenIncomeCents };
  }
  const update = (patch: Partial<SummaryParams>) => setSearch(toSearchParams({ ...view, ...patch }));
  const [editingHidden, setEditingHidden] = useState(false);
  const [editingBudgets, setEditingBudgets] = useState(false);
  const { toast, notify, dismiss } = useToast();

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
  // Each number links to the transactions behind it, in the Summary's scope.
  const excludeHidden = !view.hidden && (tags.current?.patterns.length ?? 0) > 0;
  const href = (t: Omit<DrillTarget, "year" | "month" | "sources" | "excludeHidden"> & { month?: number | null }) =>
    `/transactions?${toTransactionsSearch(drillDown({ year, month: view.month, sources: view.sources, excludeHidden, ...t }))}`;
  // The chart's whole-month click has no type: drop the one drillDown needs.
  const monthHref = (type: "income" | "expense" | null, m: number) => type
    ? href({ type, month: m })
    : `/transactions?${toTransactionsSearch({ ...drillDown({ year, month: m, type: "expense", sources: view.sources, excludeHidden }), type: undefined })}`;
  const budgetOf = (category: string) => data?.expenseCategories.find((c) => c.category === category)?.spendingType ?? null;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <StickyPanel label="Summary controls">
        {/* Two rows at every width: up to twelve month chips need the whole line. */}
        <header className="flex flex-col gap-2">
          <PeriodPicker periods={periods.data} year={year} month={view.month}
            onChange={(y, m) => update({ year: y, month: m })} />
          <FiltersBar sources={periods.data.sources} selected={view.sources} hidden={view.hidden}
            hiddenCents={tags.current?.hiddenCents ?? 0} hiddenIncomeCents={tags.current?.hiddenIncomeCents ?? 0} excludedPatterns={tags.current?.patterns}
            onSources={(s) => update({ sources: s })} onHidden={(h) => update({ hidden: h })}
            onEditHidden={() => setEditingHidden(true)} />
        </header>
        {data && (
          <div className={`flex flex-col gap-4 transition-opacity ${summary.isPlaceholderData ? "opacity-60" : ""}`}>
            <CashFlowTiles cashFlow={data.cashFlow} monthAverage={data.monthAverage} pension={data.pension} />
            <SpendingSplit split={data.spendingType} monthView={data.month !== null} onEdit={() => setEditingBudgets(true)} />
          </div>
        )}
      </StickyPanel>

      {summary.error && <ErrorCard error={summary.error} onRetry={() => summary.refetch()} />}
      {!data && !summary.error && <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" aria-busy="true" />}
      {data && (
        <div className={`flex flex-col gap-4 transition-opacity ${summary.isPlaceholderData ? "opacity-60" : ""}`}>
          <SummaryTabs tabs={tabs} current={tab} onChange={(t) => update({ tab: t })} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-4">
            {tab === "expenses" && (
              <>
                {data.monthlyTotals && <MonthlyChart totals={data.monthlyTotals} lastMonth={lastMonth} monthHref={monthHref} />}
                <div className="grid gap-4 md:grid-cols-2">
                  <BreakdownList title="Expense categories" tone="expense" showShare limit={10} foldBelow={0.01}
                    items={data.expenseCategories.map((c) => ({ label: c.category, sublabel: c.spendingType === "essential" ? "Ess." : "Disc.", amountCents: c.amountCents, kind: c.spendingType ?? undefined, href: href({ type: "expense", category: c.category, budget: c.spendingType }) }))} />
                  <BreakdownList title="Top expense merchants" tone="expense" limit={10} collapsible foldBelow={0.01}
                    items={data.topMerchants.map((m) => ({ label: m.merchant, sublabel: m.category, amountCents: m.amountCents, count: m.txnCount, kind: m.spendingType ?? undefined, href: href({ type: "expense", merchant: m.merchant }) }))} />
                </div>
              </>
            )}
            {tab === "income" && (
              <div className="grid items-start gap-4 md:grid-cols-2">
                <BreakdownList title="Income categories" tone="income" showShare limit={5} foldBelow={0.01}
                  items={data.incomeCategories.map((c) => ({ label: c.category, amountCents: c.amountCents, kind: "income" as const, href: href({ type: "income", category: c.category }) }))} />
                <BreakdownList title="Top income sources" tone="income" limit={5} foldBelow={0.01}
                  items={data.topIncome.map((m) => ({ label: m.merchant, sublabel: m.category, amountCents: m.amountCents, count: m.txnCount, kind: "income" as const, href: href({ type: "income", merchant: m.merchant }) }))} />
              </div>
            )}
            {tab === "monthly" && data.monthly && (
              <>
                <MonthlyGrid title="Monthly expenses" grid={data.monthly.expense} tone="expense" lastMonth={lastMonth}
                  cellHref={(category, m) => href({ type: "expense", month: m, ...(category !== null && { category, budget: budgetOf(category) }) })} />
                <MonthlyGrid title="Monthly income" grid={data.monthly.income} tone="income" lastMonth={lastMonth}
                  cellHref={(category, m) => href({ type: "income", month: m, ...(category !== null && { category }) })} />
              </>
            )}
          </div>
        </div>
      )}
      <BudgetsSheet open={editingBudgets} onClose={() => setEditingBudgets(false)} />
      <HiddenTagsSheet open={editingHidden} excluded={tags.current?.patterns ?? []} onClose={() => setEditingHidden(false)}
        onSaved={(patterns) => {
          // Like the TUI: a saved list is applied straight away.
          update({ hidden: false });
          notify({ message: patterns.length === 0 ? "No tags hidden" : `Hiding ${patterns.length} tag pattern${patterns.length === 1 ? "" : "s"}` });
        }} />
      <Toast toast={toast} onDismiss={dismiss} />
    </main>
  );
}
