import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError } from "../lib/api";
import { Segmented } from "../lib/Segmented";
import { StickyPanel } from "../lib/StickyPanel";
import { Toast, useToast } from "../lib/Toast";
import { DESKTOP, useMediaQuery } from "../lib/useMediaQuery";
import { useLookups } from "../transactions/queries";
import { MerchantActionBar } from "./MerchantActionBar";
import { MerchantCards } from "./MerchantCards";
import { MerchantEditor, type EditorTarget } from "./MerchantEditor";
import { MerchantTable } from "./MerchantTable";
import { merchantCount } from "./count";
import { useConfirmSuggestions, useSetMerchantCategory, useSuggestCategories } from "./mutations";
import { filterMerchants, parseMerchantParams, sortMerchants, toMerchantSearch, type MerchantParams } from "./params";
import { useMerchants } from "./queries";
import { SetCategorySheet } from "./SetCategorySheet";
import { suggestMessage } from "./suggest";

const field = "rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

export function MerchantsPage() {
  const [search, setSearch] = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const params = parseMerchantParams(search);
  const list = useMerchants();
  const lookups = useLookups();
  const { toast, notify, dismiss } = useToast();
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [setting, setSetting] = useState<number[] | null>(null);
  const clear = useSetMerchantCategory();
  const confirm = useConfirmSuggestions();

  const all = list.data?.merchants;
  const rows = useMemo(
    () => (all ? sortMerchants(filterMerchants(all, params), params.sort, params.dir) : []),
    [all, search], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Sorting reorders the same rows, so only a filter change drops the selection.
  const filterKey = JSON.stringify([params.q, params.category, params.attention, params.type]);
  useEffect(() => { setSelected(new Set()); }, [filterKey]);

  // Only rows still shown count: a filter or refetch drops the rest from the selection.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id).sort((a, b) => a - b);
  const effective = new Set(selectedIds);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const toggleShown = (ids: number[], on: boolean) => setSelected((s) => {
    const n = new Set(s);
    for (const id of ids) { if (on) n.add(id); else n.delete(id); }
    return n;
  });
  const clearCategory = (ids: number[]) => !clear.isPending && clear.mutate({ ids, category: null }, {
    onSuccess: ({ updated }) => { notify({ message: `Cleared the category on ${merchantCount(updated)}` }); setSelected(new Set()); },
    onError: (e) => notify({ message: `Couldn't clear: ${e.message}`, action: { label: "Retry", run: () => clearCategory(ids) } }),
  });
  // Only flagged rows have anything to confirm; the rest of the selection is ignored.
  const confirmIds = rows.filter((r) => effective.has(r.id) && r.suggested).map((r) => r.id);
  const confirmSuggested = (ids: number[]) => !confirm.isPending && confirm.mutate(ids, {
    onSuccess: ({ confirmed }) => { notify({ message: `Confirmed ${merchantCount(confirmed)}` }); setSelected(new Set()); },
    onError: (e) => notify({ message: `Couldn't confirm: ${e.message}`, action: { label: "Retry", run: () => confirmSuggested(ids) } }),
  });
  const update = (patch: Partial<MerchantParams>) => setSearch(toMerchantSearch({ ...params, ...patch }), { replace: true });
  const open = (merchant: Extract<EditorTarget, { kind: "merchant" }>["merchant"]) => setEditing({ kind: "merchant", merchant });
  const suggest = useSuggestCategories();
  // Gemini is asked about every uncategorized merchant listed, filtered out or not.
  const canSuggest = lookups.data?.gemini === true && (all ?? []).some((m) => m.category === null);
  const askGemini = () => !suggest.isPending && suggest.mutate(undefined, {
    onSuccess: (r) => notify({
      message: suggestMessage(r),
      ...(r.suggested > 0 && { action: { label: "Review", run: () => { update({ attention: "suggested" }); dismiss(); } } }),
    }),
    onError: (e) => notify({
      message: e instanceof ApiError ? e.message : `Couldn't ask Gemini: ${e.message}`,
      action: { label: "Retry", run: () => { dismiss(); askGemini(); } },
    }),
  });

  return (
    <main className={`mx-auto flex max-w-6xl flex-col gap-4 p-4 ${selectedIds.length > 0 ? "pb-28 md:pb-4" : ""}`}>
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
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
            <span>{merchantCount(rows.length)} · {rows.filter((r) => r.category === null).length} uncategorized</span>
            {canSuggest && (
              <button type="button" onClick={askGemini} disabled={suggest.isPending}
                className="underline disabled:no-underline disabled:opacity-60">
                {suggest.isPending ? "Asking Gemini…" : "Suggest categories"}
              </button>
            )}
          </p>
        )}
        {selectedIds.length > 0 && (
          <MerchantActionBar count={selectedIds.length} total={rows.length}
            onSelectAll={() => setSelected(new Set(rows.map((r) => r.id)))}
            busy={clear.isPending || confirm.isPending} onSetCategory={() => setSetting(selectedIds)} onClearCategory={() => clearCategory(selectedIds)}
            onCancel={() => setSelected(new Set())} onConfirm={confirmIds.length > 0 ? () => confirmSuggested(confirmIds) : undefined} />
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
        <MerchantTable rows={rows} sort={params.sort} dir={params.dir} selected={effective} onToggle={toggle} onToggleShown={toggleShown} onOpen={open}
          onSort={(sort, dir) => update({ sort, dir })} />
      ) : (
        <MerchantCards rows={rows} selected={effective} onToggle={toggle} onOpen={open} />
      ))}

      <MerchantEditor target={editing} lookups={lookups.data} onClose={() => setEditing(null)}
        onDone={(message) => notify({ message })} />
      <SetCategorySheet ids={setting} categories={lookups.data?.categories ?? []} onClose={() => setSetting(null)}
        onDone={(message) => { notify({ message }); setSelected(new Set()); }} />
      <Toast toast={toast} onDismiss={dismiss} />
    </main>
  );
}
