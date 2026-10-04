import { send } from "../lib/api";
import type {
  AskResponse, CategoryChange, CategoryChangesResponse, ConfirmResponse, DecisionRequest, DecisionResponse, MerchantCategoryRequest, MerchantCategoryResponse,
  RuleDeletedResponse, SuggestResponse,
} from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

/** A rule change can rename any row, so everything that shows rows refetches. */
const MERCHANT_WRITES = ["transactions", "summary", "periods", "lookups", "merchants", "merchant-rule", "alias-preview"];

export const useSaveDecision = () =>
  useWrite((body: DecisionRequest) => send<DecisionResponse>("POST", "/api/merchants/decision", body), MERCHANT_WRITES);
export const useDeleteRule = () =>
  useWrite((id: number) => send<RuleDeletedResponse>("POST", `/api/merchants/rules/${id}/delete`, {}), MERCHANT_WRITES);
export const useSetMerchantCategory = () =>
  useWrite((body: MerchantCategoryRequest) => send<MerchantCategoryResponse>("POST", "/api/merchants/category", body), MERCHANT_WRITES);
export const useSuggestCategories = () =>
  useWrite(() => send<SuggestResponse>("POST", "/api/merchants/suggest", {}), MERCHANT_WRITES);
export const useConfirmSuggestions = () =>
  useWrite((ids: number[]) => send<ConfirmResponse>("POST", "/api/merchants/confirm", { ids }), MERCHANT_WRITES);
/** Gemini's opinion only: nothing is saved, so nothing refetches. */
export const useAskGemini = () =>
  useWrite((ids: number[]) => send<AskResponse>("POST", "/api/merchants/ask", { ids }), []);
export const useApplyCategories = () =>
  useWrite((changes: CategoryChange[]) => send<CategoryChangesResponse>("POST", "/api/merchants/categories", { changes }), MERCHANT_WRITES);
