import { Link } from "react-router";
import { Sheet } from "../lib/Sheet";
import { BudgetTypesEditor } from "./BudgetTypesEditor";

/** The Budgets page's editor, opened from the Summary's essential/discretionary card. */
export function BudgetsSheet(props: { open: boolean; onClose: () => void }) {
  return (
    <Sheet title="Budgets" open={props.open} onClose={props.onClose}>
      <BudgetTypesEditor />
      <Link to="/budgets" className="text-sm underline">Open the Budgets page</Link>
    </Sheet>
  );
}
