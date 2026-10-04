// Shared by the Merchants page tests; Vitest only collects *.test.*.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";

import type { MerchantRow } from "../../lib/types";
import { MerchantsPage } from "../../merchants/MerchantsPage";

export const merchant = (id: number, name: string, over: Partial<MerchantRow> = {}): MerchantRow => ({
  id, name, category: "Groceries", budget: "essential", suggested: false, count: 2,
  totalCents: -1250, lastDate: "2026-09-20", type: "expense", rules: [], ...over,
});

export type Call = { path: string; method: string; body: unknown };
type Answer = (body: unknown, url: URL) => { status?: number; body: unknown };

export function api(rows: MerchantRow[], routes: Record<string, Answer> = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const route = routes[`${method} ${url.pathname}`];
    if (route) { const r = route(body, url); return json(r.body, r.status); }
    if (url.pathname === "/api/merchants") return json({ merchants: rows });
    if (url.pathname === "/api/lookups") return json({ categories: ["Eating out", "Groceries", "Other"], tags: [], sources: [], essentialCategories: ["Groceries"] });
    if (url.pathname === "/api/merchants/preview") return json({ matched: 0, totalCents: 0, currentCategories: {}, merchants: {} });
    return json({});
  };
  return { fetch, calls };
}

function Where() { const l = useLocation(); return <span aria-label="location">{l.pathname + l.search}</span>; }

export function renderMerchants(url: string, mock: ReturnType<typeof api>) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="*" element={<><MerchantsPage /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

let desktop = true;
export const setDesktop = (on: boolean) => { desktop = on; };

export function useHarness() {
  beforeEach(() => {
    desktop = true;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
}
