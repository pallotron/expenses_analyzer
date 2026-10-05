/**
 * The Budget types API's JSON, shared with the frontend, which imports this
 * file directly. Keep it free of imports so the frontend can bundle it as is.
 */

export type SpendingKind = "essential" | "discretionary";

export interface BudgetCategory {
  name: string;
  /** A category with no type counts as discretionary, as get_category_spending_type. */
  spendingType: SpendingKind;
  /** Live expense rows in the category, for showing which ones matter. */
  expenseCount: number;
}

export interface BudgetTypesResponse {
  /** By name. Archived categories, and untyped ones only income rows use, are left out. */
  categories: BudgetCategory[];
  /** Annual, in cents; null is no budget. */
  essentialBudgetCents: number | null;
  discretionaryBudgetCents: number | null;
}

export interface CategoryTypeRequest {
  name: string;
  spendingType: SpendingKind;
}

export interface BudgetRequest {
  spendingType: SpendingKind;
  annualBudgetCents: number | null;
}

/** The largest annual budget accepted: ten million, in cents. */
export const MAX_BUDGET_CENTS = 1_000_000_000;
