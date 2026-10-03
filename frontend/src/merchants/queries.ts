import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { AliasPreviewResponse, MerchantsResponse, RuleLookupResponse } from "../lib/types";

export function useMerchants() {
  return useQuery({ queryKey: ["merchants"], queryFn: () => getJson<MerchantsResponse>("/api/merchants") });
}

export function useRuleLookup(raw: string | null) {
  return useQuery({
    queryKey: ["merchant-rule", raw],
    queryFn: () => getJson<RuleLookupResponse>(`/api/merchants/rule?${new URLSearchParams({ raw: raw || "" })}`),
    enabled: !!raw?.trim(),
    staleTime: 0,
  });
}

export function useAliasPreview(pattern: string, alias: string, open = true) {
  return useQuery({
    queryKey: ["alias-preview", pattern, alias.trim()],
    queryFn: () => getJson<AliasPreviewResponse>(`/api/merchants/preview?${new URLSearchParams({ pattern, alias: alias.trim() })}`),
    enabled: open && pattern.trim() !== "",
    placeholderData: keepPreviousData,
  });
}
