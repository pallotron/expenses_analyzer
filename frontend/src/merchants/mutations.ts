import { send } from "../lib/api";
import type {
  AskResponse, CategoryChange, CategoryChangesResponse, ConfirmResponse, DecisionRequest, DecisionResponse, MerchantCategoryRequest, MerchantCategoryResponse,
  RuleDeletedResponse, SuggestResponse,
} from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

export const useSaveDecision = () =>
  useWrite((body: DecisionRequest) => send<DecisionResponse>("POST", "/api/merchants/decision", body));
export const useDeleteRule = () =>
  useWrite((id: number) => send<RuleDeletedResponse>("POST", `/api/merchants/rules/${id}/delete`, {}));
export const useSetMerchantCategory = () =>
  useWrite((body: MerchantCategoryRequest) => send<MerchantCategoryResponse>("POST", "/api/merchants/category", body));
export const useSuggestCategories = () =>
  useWrite(() => send<SuggestResponse>("POST", "/api/merchants/suggest", {}));
export const useConfirmSuggestions = () =>
  useWrite((ids: number[]) => send<ConfirmResponse>("POST", "/api/merchants/confirm", { ids }));
/** Gemini's opinion only: nothing is saved, so nothing refetches. */
export const useAskGemini = () =>
  useWrite((ids: number[]) => send<AskResponse>("POST", "/api/merchants/ask", { ids }), { saves: false });
export const useApplyCategories = () =>
  useWrite((changes: CategoryChange[]) => send<CategoryChangesResponse>("POST", "/api/merchants/categories", { changes }));
