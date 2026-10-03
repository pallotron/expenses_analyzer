import { send } from "../lib/api";
import type {
  DecisionRequest, DecisionResponse, MerchantCategoryRequest, MerchantCategoryResponse, RuleDeletedResponse,
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
