import { BudgetTypesEditor } from "./BudgetTypesEditor";

/** /budgets: the TUI's `u`, for sorting out every category in one sitting. */
export function BudgetsPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Budgets</h1>
      <BudgetTypesEditor />
    </main>
  );
}
