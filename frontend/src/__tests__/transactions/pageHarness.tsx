// Shared by the Transactions page tests. Not a test file: Vitest only collects *.test.*.
// A test file calls `useHarness()` once at the top level; it registers the matchMedia stub and
// the fake clock (2026-10-01) before each test, and after each test unmounts the page first,
// then restores the clock and the stubbed globals (a mounted page still reads matchMedia). Write routes are added per test through
// `api({ routes })`, keyed "METHOD /path".
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";

import type { PeriodsResponse, TransactionRow, TransactionsResponse } from "../../lib/types";
import { TransactionsPage } from "../../transactions/TransactionsPage";

export const URL_SEPT = "/transactions?from=2026-09-01&to=2026-09-30";

const periods: PeriodsResponse = { years: [{ year: 2026, months: [8, 9] }], sources: ["Bank A", "Card"] };

export const row = (id: number, date: string, cents: number, type: "expense" | "income" = "expense"): TransactionRow => ({
  id, date, merchant: `Shop ${id}`, merchantRaw: `SHOP ${id}`, amountCents: cents, type, category: "Groceries",
  merchantCategory: "Groceries", categoryOverridden: false, budget: "essential", tags: "", source: "Card",
});

export type Call = { path: string; method: string; body: unknown };
export type Route = (body: unknown, url: URL) => { status?: number; body: unknown };
export type ApiOptions = {
  rows?: TransactionRow[];
  /** Read on every call, so a test can change what the next refetch returns. */
  rowsRef?: { value: TransactionRow[] };
  /** Awaited before answering any POST or PATCH, never a GET. */
  gate?: Promise<void>;
  /** Answers for write routes, keyed "METHOD /path". An unlisted write gets `{}`. */
  routes?: Record<string, Route>;
};

export function api(opts: ApiOptions = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (method !== "GET") await opts.gate;
    const route = opts.routes?.[`${method} ${url.pathname}`];
    if (route) {
      const r = route(body, url);
      return json(r.body, r.status);
    }
    if (url.pathname === "/api/summary/periods") return json(periods);
    if (url.pathname === "/api/lookups") return json({ categories: ["Groceries"], tags: [], sources: periods.sources });
    if (url.pathname === "/api/transactions" && method === "GET") {
      const rows = opts.rowsRef?.value ?? opts.rows ?? [row(3, "2026-09-29", 100), row(2, "2026-09-28", 100)];
      const res: TransactionsResponse = {
        rows, count: rows.length,
        incomeCents: rows.filter((r) => r.type === "income").reduce((a, r) => a + r.amountCents, 0),
        expensesCents: rows.filter((r) => r.type === "expense").reduce((a, r) => a + r.amountCents, 0),
      };
      return json(res);
    }
    return json({});
  };
  return { fetch, calls };
}

export type Mock = ReturnType<typeof api>;

/** Bodies of the POSTs made to `path`, in order. */
export const posted = (mock: Mock, path: string) =>
  mock.calls.filter((c) => c.method === "POST" && c.path === path).map((c) => c.body);

export function renderAt(url: string, mock: Mock = api()) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TransactionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { mock, client };
}

export const bar = () => screen.getByRole("region", { name: "Selected transactions" });

let desktop = true;
export const setDesktop = (on: boolean) => { desktop = on; };

/** Registers the per-test setup: desktop layout, clock at 2026-10-01 09:00; unmount, then unstub after. */
export function useHarness() {
  beforeEach(() => {
    desktop = true;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T09:00:00"));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
}
