import { useBudgetTypes, useSetCategoryType } from "../budgets/queries";
import { TypeSwitch } from "../budgets/TypeSwitch";

/**
 * The chosen category's budget type, changeable in place. It belongs to the
 * category, so it saves straight away and applies to every merchant in it. A
 * category not saved yet (or one only income uses) has nothing to change, so
 * it shows the type read-only.
 */
export function CategoryBudget(props: { category: string; essential: boolean }) {
  const types = useBudgetTypes();
  const save = useSetCategoryType();
  const found = types.data?.categories.find((c) => c.name === props.category);
  if (!found) {
    return (
      <span className="text-xs text-slate-500">
        Budget: {props.essential ? "Essential" : "Discretionary"} (from category)
      </span>
    );
  }
  const shown = save.isPending ? save.variables.spendingType : found.spendingType;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">Budget type</span>
      <TypeSwitch label={`${found.name} type`} value={shown} disabled={save.isPending}
        onChange={(v) => save.mutate({ name: found.name, spendingType: v })} />
      <span className="text-xs text-slate-500">Saved now, for every merchant in {found.name}.</span>
      {save.error && <span role="alert" className="text-xs text-expense">Couldn't save: {save.error.message}</span>}
    </div>
  );
}
