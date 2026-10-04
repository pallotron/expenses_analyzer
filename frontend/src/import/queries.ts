import { useQuery } from "@tanstack/react-query";
import { getJson, send } from "../lib/api";
import type { ImportMappingsResponse, ImportRequest, ImportResponse } from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

export function useImportMappings() {
  return useQuery({ queryKey: ["import-mappings"], queryFn: () => getJson<ImportMappingsResponse>("/api/import/mappings") });
}

/** New rows touch every list and total, and the saved mappings. */
export const useImport = () => useWrite(
  (body: ImportRequest) => send<ImportResponse>("POST", "/api/import", body),
  ["transactions", "summary", "periods", "lookups", "merchants", "import-mappings"],
);
