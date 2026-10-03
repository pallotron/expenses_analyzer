import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { ApiError } from "../../lib/api";
import { formatCents } from "../../lib/money";
import { Segmented } from "../../lib/Segmented";
import { Sheet } from "../../lib/Sheet";
import type { LookupsResponse, TransactionEdit, TransactionRow, TransactionType } from "../../lib/types";
import { SheetError, useSheetSubmit } from "../../lib/useSheetSubmit";
import { parseEuros } from "../amount";
import { CategorySelect, toCategoryEdit } from "./CategorySelect";
import { useEditOne } from "./mutations";
import { splitTags, TagInput } from "./TagInput";

interface Form { date: string; merchant: string; amount: string; type: TransactionType; source: string; category: string; tags: string[]; tagDraft: string }

const formOf = (r: TransactionRow): Form => ({
  date: r.date,
  merchant: r.merchantRaw,
  amount: (r.amountCents / 100).toFixed(2),
  type: r.type,
  source: r.source,
  category: r.categoryOverridden ? r.category : "",
  tags: splitTags(r.tags),
  tagDraft: "",
});

/** Chips plus what is typed in the box, sorted so two sets compare by value. */
const tagsOfForm = (f: Form) => [...new Set([...f.tags, ...splitTags(f.tagDraft)])].sort();

/** Only what differs from the row, as the PATCH body. Null when the amount does not parse. */
function diff(r: TransactionRow, f: Form): TransactionEdit | null {
  const start = formOf(r);
  const edit: TransactionEdit = {};
  if (f.date !== start.date) edit.date = f.date;
  if (f.merchant.trim() !== start.merchant.trim()) edit.merchant = f.merchant.trim();
  if (f.amount !== start.amount) {
    const cents = parseEuros(f.amount);
    if (cents === null) return null;
    if (cents !== r.amountCents) edit.amountCents = cents;
  }
  if (f.type !== start.type) edit.type = f.type;
  if (f.source.trim() !== start.source.trim()) edit.source = f.source.trim();
  if (f.category !== start.category) edit.category = toCategoryEdit(f.category);
  const tags = tagsOfForm(f);
  if (tags.join(",") !== tagsOfForm(start).join(",")) edit.tags = tags;
  return edit;
}

const field = "rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900";

export function EditSheet(props: {
  row: TransactionRow | null; lookups: LookupsResponse | undefined;
  onClose: () => void; onSaved: () => void; onDelete: (id: number) => void;
  onMerchantRule: (raw: string) => void;
}) {
  const save = useEditOne();
  const client = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const submitter = useSheetSubmit(
    save,
    () => { props.onSaved(); props.onClose(); },
    (e) => {
      // Gone elsewhere: refresh so the stale row drops out of the list.
      if (e instanceof ApiError && e.status === 404) void client.invalidateQueries({ queryKey: ["transactions"] });
    },
  );
  const hintId = useId();
  const sourcesId = useId();
  useEffect(() => { setForm(props.row ? formOf(props.row) : null); submitter.reset(); }, [props.row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = props.row;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const edit = r && form ? diff(r, form) : null;
  // An amount that does not parse counts as a change, so Save is live and says why it refuses.
  const changed = edit === null || Object.keys(edit).length > 0;

  const submit = () => {
    if (!r || !form || save.isPending) return;
    if (edit === null) {
      const trimmed = form.amount.trim();
      if (trimmed.startsWith("-") || trimmed.startsWith("−") || trimmed.startsWith("+")) {
        submitter.fail("Amounts are always positive; use Expense/Income for the direction");
      } else {
        submitter.fail("Enter an amount more than zero, like 12.50");
      }
      return;
    }
    if (form.merchant.trim() === "") { submitter.fail("Statement text cannot be empty"); return; }
    if (form.source.trim() === "") { submitter.fail("Source cannot be empty"); return; }
    submitter.run({ id: r.id, edit });
  };

  return (
    <Sheet title="Edit transaction" open={r !== null} onClose={props.onClose} busy={save.isPending}>
      {r && form && (
        <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Date</span>
            <input type="date" autoFocus value={form.date} onChange={(e) => set({ date: e.target.value })} className={field} />
          </label>
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Statement text</span>
              <input value={form.merchant} onChange={(e) => set({ merchant: e.target.value })} className={field} />
            </label>
            <span className="text-xs text-slate-500">Shows as: {r.merchant}. Changing the text may change the merchant, and with it the category unless one is set below.</span>
            <button type="button" onClick={() => props.onMerchantRule(r.merchantRaw)} disabled={save.isPending}
              className="self-start text-xs underline disabled:opacity-40">Merchant rule…</button>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-slate-500">Amount</span>
              <input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })}
                aria-describedby={hintId} className={field} />
            </label>
            <Segmented label="Type" value={form.type} onChange={(t) => t && set({ type: t })}
              options={[["expense", "Expense"], ["income", "Income"]]} />
          </div>
          <span id={hintId} className="sr-only">Euros, for example 12.50. Currently {formatCents(r.amountCents)}.</span>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Source</span>
            <input list={sourcesId} value={form.source} onChange={(e) => set({ source: e.target.value })} className={field} />
            <datalist id={sourcesId}>{props.lookups?.sources.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <CategorySelect value={form.category} onChange={(category) => set({ category })}
            categories={props.lookups?.categories ?? []} merchantCategory={r.merchantCategory} />
          <TagInput label="Tags" value={form.tags} onChange={(tags) => set({ tags })}
            draft={form.tagDraft} onDraft={(tagDraft) => set({ tagDraft })} suggestions={props.lookups?.tags ?? []} />
          <SheetError submit={submitter} onRetry={submit} />
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" onClick={() => props.onDelete(r.id)} disabled={save.isPending}
              className="px-1 text-expense underline disabled:opacity-40">Delete</button>
            <button type="submit" disabled={!changed || save.isPending}
              className="rounded-md bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
