import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError } from "../lib/api";
import { Chevron } from "../lib/Chevron";
import { StickyPanel } from "../lib/StickyPanel";
import { monthRange } from "../lib/types";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { usePeriods } from "../summary/queries";
import { DayList } from "./DayList";
import { defaultMonth } from "./defaultMonth";
import { parseTxParams, shiftMonth, toTxSearch, transactionsApiPath, wholeMonth, type TxParams } from "./params";
import { useLookups, useTransactions } from "./queries";
import { TotalsStrip } from "./TotalsStrip";
import { TransactionFilters } from "./TransactionFilters";
import { sortRows, TransactionTable } from "./TransactionTable";

export const PAGE_SIZE = 200;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function rangeLabel(p: TxParams): string {
  const m = wholeMonth(p);
  if (m) return `${MONTH_NAMES[m.month - 1]} ${m.year}`;
  if (p.from && p.to) return `${p.from} – ${p.to}`;
  if (p.from) return `${p.from} onwards`;
  if (p.to) return `until ${p.to}`;
  return "All dates";
}

export function TransactionsPage() {
  const [search, setSearch] = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const params = parseTxParams(search);
  const unset = search.toString() === "";
  const periods = usePeriods();
  const lookups = useLookups();
  const list = useTransactions(params, !unset);
  const path = transactionsApiPath(params);
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [path]);

  const start = unset && periods.data ? defaultMonth(periods.data, new Date()) : null;
  useEffect(() => {
    if (start) setSearch(toTxSearch({ ...params, ...monthRange(start.year, start.month) }), { replace: true });
  }, [start?.year, start?.month]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<TxParams>) => setSearch(toTxSearch({ ...params, ...patch }), { replace: true });
  const clear = () => setSearch(new URLSearchParams());

  if (unset && periods.error && !periods.data) {
    return (
      <main className="mx-auto max-w-6xl p-4 text-sm">
        <p className="mb-2">{periods.error.message}</p>
        <button type="button" onClick={() => periods.refetch()} className="rounded-md border px-3 py-1">Retry</button>
      </main>
    );
  }

  if (unset && periods.data && !start) {
    return <main className="mx-auto max-w-6xl p-4"><p>No transactions yet.</p></main>;
  }

  const month = wholeMonth(params);
  const data = list.data;
  const badRequest = list.error instanceof ApiError && list.error.status === 400 ? list.error.message : null;
  const rows = data ? (desktop ? sortRows(data.rows, params.sort, params.dir) : data.rows) : [];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <StickyPanel label="Transaction controls">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Transactions</h1>
          <div className="flex items-center gap-2 text-sm">
            {month && <button type="button" aria-label="Previous month" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={() => setSearch(toTxSearch(shiftMonth(params, -1)))}><Chevron dir="left" size={20} /></button>}
            <span className="text-base font-medium">{rangeLabel(params)}</span>
            {month && <button type="button" aria-label="Next month" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={() => setSearch(toTxSearch(shiftMonth(params, 1)))}><Chevron dir="right" size={20} /></button>}
          </div>
        </header>

        <TransactionFilters params={params} lookups={lookups.data} onChange={update} onClear={clear} desktop={desktop} />
        {data && data.count > 0 && (
          <div className={`transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
            <TotalsStrip count={data.count} incomeCents={data.incomeCents} expensesCents={data.expensesCents} type={params.type} />
          </div>
        )}
      </StickyPanel>
      {badRequest && <p role="alert" className="text-sm text-expense">{badRequest}</p>}
      {list.error && !badRequest && (
        <div className="text-sm">
          <p className="mb-2">{list.error.message}</p>
          <button type="button" onClick={() => list.refetch()} className="rounded-md border px-3 py-1">Retry</button>
        </div>
      )}

      {!data && !list.error && <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" aria-busy="true" />}
      {data && (
        <section aria-label="Transactions list" className={`flex flex-col gap-3 transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
          {data.count === 0 ? (
            <p className="text-sm">
              No transactions match these filters.{" "}
              <button type="button" onClick={clear} className="underline">Clear filters</button>
            </p>
          ) : desktop ? (
            <TransactionTable rows={rows.slice(0, shown)} sort={params.sort} dir={params.dir}
              onSort={(sort, dir) => setSearch(toTxSearch({ ...params, sort, dir }), { replace: true })} />
          ) : (
            <DayList rows={rows.slice(0, shown)} />
          )}
          {rows.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="self-start text-sm underline">
              Show more ({rows.length - shown} left)
            </button>
          )}
        </section>
      )}
    </main>
  );
}
