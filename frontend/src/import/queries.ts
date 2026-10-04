import { useQuery } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import type { ImportMappingsResponse } from "../lib/types";

export function useImportMappings() {
  return useQuery({ queryKey: ["import-mappings"], queryFn: () => getJson<ImportMappingsResponse>("/api/import/mappings") });
}
