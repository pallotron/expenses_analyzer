// Shared by the import page tests; Vitest only collects *.test.*.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";

import { ImportPage } from "../../import/ImportPage";
import type { ImportMapping } from "../../lib/types";

export type Call = { path: string; method: string; body: unknown };
type Answer = (body: unknown) => { status?: number; body: unknown };

export function api(opts: {
  sources?: string[]; gemini?: boolean; mappings?: Record<string, ImportMapping>; routes?: Record<string, Answer>;
} = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const route = opts.routes?.[`${method} ${url.pathname}`];
    if (route) { const r = route(body); return json(r.body, r.status); }
    if (url.pathname === "/api/lookups") {
      return json({ categories: [], tags: [], sources: opts.sources ?? ["Card"], essentialCategories: [], gemini: opts.gemini ?? false });
    }
    if (url.pathname === "/api/import/mappings") return json({ mappings: opts.mappings ?? {} });
    return json({});
  };
  return { fetch, calls };
}

export function renderImport(mock: ReturnType<typeof api>) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/import"]}>
        <Routes><Route path="*" element={<ImportPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

export const csvFile = (text: string, name = "sept.csv") => new File([text], name, { type: "text/csv" });

export function useHarness() {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
}
