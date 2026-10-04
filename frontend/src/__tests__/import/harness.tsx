// Shared by the import page tests; Vitest only collects *.test.*.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";

import { ImportPage } from "../../import/ImportPage";
import type { ImportRequest, ImportSource } from "../../lib/types";

export type Call = { path: string; method: string; body: unknown };
type Reply = { status?: number; body: unknown };
type Answer = (body: unknown) => Reply | Promise<Reply>;

/** A dry run or an import of every row as new, unless a test answers otherwise. */
export const asNew = (body: unknown): Reply => {
  const b = body as ImportRequest;
  return { body: { batchId: b.dryRun ? null : 1, inserted: b.rows.length, duplicates: 0, suppressedDeleted: 0, newMerchants: [] } };
};

export function api(opts: { sources?: ImportSource[]; gemini?: boolean; routes?: Record<string, Answer> } = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const route = opts.routes?.[`${method} ${url.pathname}`];
    if (route) { const r = await route(body); return json(r.body, r.status); }
    const sources = opts.sources ?? [];
    if (url.pathname === "/api/lookups") {
      return json({ categories: [], tags: [], sources: sources.map((s) => s.name), essentialCategories: [], gemini: opts.gemini ?? false });
    }
    if (url.pathname === "/api/import/sources") return json({ sources });
    if (method === "POST" && url.pathname === "/api/import") { const r = asNew(body); return json(r.body, r.status); }
    return json({});
  };
  /** The POST /api/import calls, dry or real. */
  const imports = (dry: boolean) => calls.filter((c) => c.path === "/api/import" && !!(c.body as ImportRequest).dryRun === dry)
    .map((c) => c.body as ImportRequest);
  return { fetch, calls, imports };
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

export async function addFiles(files: File[]) {
  await userEvent.upload(await screen.findByLabelText("Files"), files);
}
export const statusOf = (name: string) => screen.getByLabelText(`Status of ${name}`);

export function useHarness() {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
}
