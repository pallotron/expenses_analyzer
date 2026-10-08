import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { LookupsResponse, TransactionsQuery, TransactionsResponse } from "../lib/types";
import { transactionsApiPath } from "./params";

/** Keeps the previous list on screen while the next one loads. */
export function useTransactions(p: TransactionsQuery, enabled: boolean) {
  const path = transactionsApiPath(p);
  return useQuery({
    queryKey: ["transactions", path],
    queryFn: () => getJson<TransactionsResponse>(path),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useLookups() {
  return useQuery({ queryKey: ["lookups"], queryFn: () => getJson<LookupsResponse>("/api/lookups") });
}
