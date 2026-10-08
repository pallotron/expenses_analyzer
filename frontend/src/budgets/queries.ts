import { useQuery } from "@tanstack/react-query";
import { getJson, send } from "../lib/api";
import type { BudgetRequest, BudgetTypesResponse, CategoryTypeRequest } from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

export const useBudgetTypes = () =>
  useQuery({ queryKey: ["budget-types"], queryFn: () => getJson<BudgetTypesResponse>("/api/budget-types") });

export const useSetCategoryType = () =>
  useWrite((body: CategoryTypeRequest) => send<{ ok: true }>("POST", "/api/budget-types/category", body));

export const useSetBudget = () =>
  useWrite((body: BudgetRequest) => send<{ ok: true }>("POST", "/api/budget-types/budget", body));
