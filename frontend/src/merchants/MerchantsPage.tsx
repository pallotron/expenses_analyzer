import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { Segmented } from "../lib/Segmented";
import { StickyPanel } from "../lib/StickyPanel";
import { Toast, useToast } from "../lib/Toast";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { useLookups } from "../transactions/queries";
import { MerchantCards } from "./MerchantCards";
import { MerchantEditor, type EditorTarget } from "./MerchantEditor";
import { MerchantTable } from "./MerchantTable";
import { filterMerchants, parseMerchantParams, sortMerchants, toMerchantSearch, type MerchantParams } from "./params";
import { useMerchants } from "./queries";

const field = "rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

export function MerchantsPage() {
  const [search, setSearch] = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const params = parseMerchantParams(search);
  const list = useMerchants();
  const lookups = useLookups();
  const { toast, notify, dismiss } = useToast();
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  const all = list.data?.merchants;
  const rows = useMemo(
    () => (all ? sortMerchants(filterMerchants(all, params), params.sort, params.dir) : []),
    [all, search], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const update = (patch: Partial<MerchantParams>) => setSearch(toMerchantSearch({ ...params, ...patch }), { replace: true });
  const open = (merchant: Extract<EditorTarget, { kind: "merchant" }>["merchant"]) => setEditing({ kind: "merchant", merchant });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <StickyPanel label="Merchant controls">
        <h1 className="text-lg font-semibold">Merchants</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" aria-label="Search merchants" placeholder="Search merchants" value={params.q ?? ""}
            onChange={(e) => update({ q: e.target.value || undefined })} className={`${field} min-w-40 flex-1`} />
          <select aria-label="Category" value={params.category ?? ""}
            onChange={(e) => update({ category: e.target.value || undefined })} className={field}>
            <option value="">All categories</option>
            {(lookups.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Segmented label="Needs attention" value={params.attention} onChange={(attention) => update({ attention })}
            options={[[undefined, "All"], ["uncategorized", "Uncategorized"], ["suggested", "Suggested"]]} />
          <Segmented label="Type" value={params.type} onChange={(type) => update({ type })}
            options={[[undefined, "All"], ["expense", "Expense"], ["income", "Income"]]} />
        </div>
        {all && (
          <p className="text-sm text-slate-500">
            {rows.length} merchants · {rows.filter((r) => r.category === null).length} uncategorized
          </p>
        )}
      </StickyPanel>

      {list.error && (
        <div className="text-sm">
          <p className="mb-2">{list.error.message}</p>
          <button type="button" onClick={() => list.refetch()} className="rounded-md border px-3 py-1">Retry</button>
        </div>
      )}
      {!all && !list.error && <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" aria-busy="true" />}
      {all && (rows.length === 0 ? (
        <p className="text-sm">
          No merchants match these filters.{" "}
          <button type="button" onClick={() => setSearch(new URLSearchParams())} className="underline">Clear filters</button>
        </p>
      ) : desktop ? (
        <MerchantTable rows={rows} sort={params.sort} dir={params.dir} onOpen={open}
          onSort={(sort, dir) => update({ sort, dir })} />
      ) : (
        <MerchantCards rows={rows} onOpen={open} />
      ))}

      <MerchantEditor target={editing} lookups={lookups.data} onClose={() => setEditing(null)}
        onDone={(message) => notify({ message })} />
      <Toast toast={toast} onDismiss={dismiss} />
    </main>
  );
}
