import { Link } from "react-router";
import { formatCents } from "../lib/money";
import { quote, type MerchantRow } from "../lib/types";

/** Shared by the table and the phone cards. */
export function CategoryLabel({ row }: { row: MerchantRow }) {
  return (
    <>
      {row.category ?? <span className="text-slate-500">Uncategorized</span>}
      {row.suggested && (
        <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-800">suggested</span>
      )}
    </>
  );
}

export function BudgetLabel({ row }: { row: MerchantRow }) {
  if (row.type !== "expense") return null;
  return <>{row.budget === "essential" ? "Essential" : "Discretionary"}</>;
}

export function TotalLabel({ row, className = "" }: { row: MerchantRow; className?: string }) {
  const c = row.totalCents;
  const text = c > 0 ? `+${formatCents(c)}` : c < 0 ? `−${formatCents(-c)}` : formatCents(0);
  return <span className={`${c > 0 ? "text-income" : ""} ${className}`.trim()}>{text}</span>;
}

export function RulesLabel({ row }: { row: MerchantRow }) {
  if (row.rules.length === 0) return <>0</>;
  return (
    <>
      {row.rules.length}{" "}
      <span className="font-mono text-xs text-slate-500">{row.rules[0].pattern}</span>
    </>
  );
}

export function TransactionsLink({ name }: { name: string }) {
  return (
    <Link to={`/transactions?${new URLSearchParams({ merchant: quote(name) })}`} aria-label={`Transactions for ${name}`}
      onClick={(e) => e.stopPropagation()} className="px-1 underline">→</Link>
  );
}
