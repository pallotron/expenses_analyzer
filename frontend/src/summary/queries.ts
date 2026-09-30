import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { PeriodsResponse, SummaryResponse } from "../lib/types";
import { summaryApiPath, type SummaryParams } from "./params";

export function usePeriods() {
  return useQuery({ queryKey: ["periods"], queryFn: () => getJson<PeriodsResponse>("/api/summary/periods") });
}

/** Keeps the previous view on screen while the next one loads. */
export function useSummary(p: SummaryParams) {
  return useQuery({
    queryKey: ["summary", p.year, p.month, p.sources ?? null, p.hidden],
    queryFn: () => getJson<SummaryResponse>(summaryApiPath({ ...p, year: p.year! })),
    enabled: p.year !== null,
    placeholderData: keepPreviousData,
  });
}
