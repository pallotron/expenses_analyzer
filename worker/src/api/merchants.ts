import type { BudgetKind, TransactionType } from "./transactions";

export interface MerchantRule { id: number; pattern: string }

export interface MerchantRow {
  id: number;
  name: string;
  /** Null: no category, so it counts as "Other". */
  category: string | null;
  /** Anything not essential is discretionary, as on Transactions. */
  budget: BudgetKind;
  /** Gemini proposed the category and nobody confirmed it. */
  suggested: boolean;
  /** Live rows only. */
  count: number;
  /** Income minus expenses, in cents: a shop is negative. */
  totalCents: number;
  /** YYYY-MM-DD of the newest live row; null when it has none. */
  lastDate: string | null;
  /** income when most of its live rows are income. */
  type: TransactionType;
  /** Priority order. */
  rules: MerchantRule[];
}

export interface MerchantsResponse { merchants: MerchantRow[] }

/** The rule deciding a raw name today, and the merchant it lands on. */
export interface RuleLookupResponse { rule: MerchantRule | null; merchant: string; category: string | null }

export interface AliasPreviewResponse {
  matched: number;
  totalCents: number;
  currentCategories: Record<string, number>;
  merchants: Record<string, number>;
  error?: string;
}

export interface DecisionRequest { pattern: string; alias: string; category?: string; tags?: string[] }
export interface DecisionResponse { repointed: number; tagged: number }
export interface RuleDeletedResponse { repointed: number }
export interface MerchantCategoryRequest { ids: number[]; category: string | null }
export interface MerchantCategoryResponse { updated: number }

/** POST /api/merchants/suggest: what Gemini was asked and what was saved. */
export interface SuggestResponse {
  /** Uncategorized merchants (live rows or a rule) that were sent. */
  asked: number;
  /** Merchants that now carry a suggested category. */
  suggested: number;
  /** Categories created for these answers, in first-seen spelling. */
  newCategories: string[];
  /** asked - suggested. */
  unanswered: number;
}

/** POST /api/merchants/confirm. Only merchants still flagged change. */
export interface ConfirmRequest { ids: number[] }
export interface ConfirmResponse { confirmed: number }

/** POST /api/merchants/ask: Gemini's opinion on chosen merchants. Nothing is saved. */
export interface AskRequest { ids: number[] }
export interface AskAnswer {
  id: number;
  name: string;
  /** The merchant's category now; null when it has none. */
  current: string | null;
  /** In an existing category's spelling when one matches, ignoring case. */
  suggested: string;
  /** No category of that name exists yet; applying it creates one. */
  isNew: boolean;
}
export interface AskResponse { answers: AskAnswer[]; unanswered: number }

/** POST /api/merchants/categories: several merchants, each its own category, all or nothing. */
export interface CategoryChange { id: number; category: string }
export interface CategoryChangesRequest { changes: CategoryChange[] }
export interface CategoryChangesResponse { updated: number }
