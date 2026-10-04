import { useQuery } from "@tanstack/react-query";
import { getJson, send } from "../lib/api";
import type { ImportRequest, ImportResponse, ImportSourcesResponse } from "../lib/types";

export function useImportSources() {
  return useQuery({ queryKey: ["import-sources"], queryFn: () => getJson<ImportSourcesResponse>("/api/import/sources") });
}

export const postImport = (body: ImportRequest) => send<ImportResponse>("POST", "/api/import", body);

/** New rows touch every list and total, the sources' last dates, and the saved mappings. */
export const IMPORT_WRITES = ["transactions", "summary", "periods", "lookups", "merchants", "import-sources"];
