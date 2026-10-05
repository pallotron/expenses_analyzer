import { useId, useState, type FormEvent } from "react";
import { formatCents } from "../lib/money";
import type { BudgetCategory, SpendingKind } from "../lib/types";
import { eurosText, parseEuros } from "./euros";
import { useBudgetTypes, useSetBudget, useSetCategoryType } from "./queries";
import { TypeSwitch } from "./TypeSwitch";

const muted = "text-slate-600 dark:text-slate-400";

/**
 * The TUI's Budget types screen: the annual budget for each type, and each
 * category's type. Every change saves on its own. Shown on the Budgets page
 * and in the sheet the Summary opens.
 */
export function BudgetTypesEditor() {
  const query = useBudgetTypes();
  if (query.isPending) return <p className={`text-sm ${muted}`} aria-busy="true">Loading budgets…</p>;
  if (query.error) {
    return (
      <p role="alert" className="text-sm text-expense">
        Couldn't load the budgets: {query.error.message}
        <button type="button" onClick={() => query.refetch()} className="ml-2 underline">Retry</button>
      </p>
    );
  }
  const { categories, essentialBudgetCents, discretionaryBudgetCents } = query.data;
  const essential = categories.filter((c) => c.spendingType === "essential").length;
  return (
    <div className="flex flex-col gap-6 text-sm">
      <section aria-labelledby="annual-budgets" className="flex flex-col gap-3">
        <h2 id="annual-budgets" className="font-semibold">Annual budgets</h2>
        <p className={muted}>The Summary compares each side's spend with these, divided by 12 in a month. Leave one blank for no budget.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Keyed on the saved value, so a save elsewhere resets the field. */}
          <BudgetField key={`e${essentialBudgetCents}`} kind="essential" label="Essential" cents={essentialBudgetCents} />
          <BudgetField key={`d${discretionaryBudgetCents}`} kind="discretionary" label="Discretionary" cents={discretionaryBudgetCents} />
        </div>
      </section>
      <section aria-labelledby="category-types" className="flex flex-col gap-3">
        <h2 id="category-types" className="font-semibold">Category types</h2>
        <p className={muted}>
          {essential} essential, {categories.length - essential} discretionary. A category with no type counts as
          discretionary. Categories with no type that only income uses are not listed.
        </p>
        {categories.length === 0 ? <p className={muted}>No categories yet</p> : <CategoryTypes categories={categories} />}
      </section>
    </div>
  );
}

function BudgetField(props: { kind: SpendingKind; label: string; cents: number | null }) {
  const save = useSetBudget();
  const [text, setText] = useState(eurosText(props.cents));
  const id = useId();
  const parsed = parseEuros(text);
  const changed = parsed.ok && parsed.cents !== props.cents;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed.ok && changed) save.mutate({ spendingType: props.kind, annualBudgetCents: parsed.cents });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-slate-500">{props.label}, per year (€)</label>
      <div className="flex gap-2">
        <input id={id} value={text} onChange={(e) => { setText(e.target.value); save.reset(); }} inputMode="decimal"
          placeholder="No budget" aria-invalid={!parsed.ok}
          className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 tabular-nums dark:border-slate-700 dark:bg-slate-950" />
        <button type="submit" disabled={!changed || save.isPending}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {!parsed.ok && <span role="alert" className="text-xs text-expense">{parsed.error}</span>}
      {save.error && <span role="alert" className="text-xs text-expense">Couldn't save: {save.error.message}</span>}
      {parsed.ok && !changed && props.cents !== null && (
        <span className="text-xs text-slate-500">{formatCents(Math.round(props.cents / 12))} a month</span>
      )}
    </form>
  );
}

/**
 * The categories, used ones first and unused ones folded. While searching,
 * every match shows in one list, so a match is never hidden in the fold.
 */
function CategoryTypes(props: { categories: BudgetCategory[] }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = props.categories.filter((c) => c.name.toLowerCase().includes(needle));
  const unused = props.categories.filter((c) => c.expenseCount === 0);
  return (
    <>
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search categories"
        placeholder="Search categories"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 sm:max-w-xs dark:border-slate-700 dark:bg-slate-950" />
      {needle ? (
        matches.length === 0 ? <p className={muted}>No category matches "{search.trim()}"</p> : <CategoryList categories={matches} />
      ) : (
        <>
          <CategoryList categories={props.categories.filter((c) => c.expenseCount > 0)} />
          {unused.length > 0 && (
            // Folded: dozens of starter categories nobody uses would bury the rest.
            <details>
              <summary className="cursor-pointer select-none py-1 text-slate-600 dark:text-slate-400">
                {unused.length} unused categor{unused.length === 1 ? "y" : "ies"}
              </summary>
              <CategoryList categories={unused} />
            </details>
          )}
        </>
      )}
    </>
  );
}

function CategoryList(props: { categories: BudgetCategory[] }) {
  if (props.categories.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
      {props.categories.map((c) => <CategoryRow key={c.name} category={c} />)}
    </ul>
  );
}

function CategoryRow(props: { category: BudgetCategory }) {
  const { name, spendingType, expenseCount } = props.category;
  const save = useSetCategoryType();
  // Show the choice while it saves; the refetch then confirms or reverts it.
  const shown = save.isPending ? save.variables.spendingType : spendingType;
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="font-medium">{name}</span>{" "}
          {expenseCount > 0 && <span className="text-xs text-slate-500">{expenseCount} row{expenseCount === 1 ? "" : "s"}</span>}
        </span>
        <TypeSwitch label={`${name} type`} value={shown} disabled={save.isPending}
          onChange={(v) => save.mutate({ name, spendingType: v })} />
      </div>
      {save.error && <span role="alert" className="text-xs text-expense">Couldn't save {name}: {save.error.message}</span>}
    </li>
  );
}
