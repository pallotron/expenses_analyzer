/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeriodsResponse, TransactionRow, TransactionsResponse } from "../../lib/types";
import { PAGE_SIZE, TransactionsPage } from "../../transactions/TransactionsPage";

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

const periods: PeriodsResponse = { years: [{ year: 2026, months: [8, 9] }], sources: ["Bank A", "Card"] };
const row = (id: number, date: string, cents: number, type: "expense" | "income" = "expense"): TransactionRow => ({
  id, date, merchant: `Shop ${id}`, merchantRaw: `SHOP ${id}`, amountCents: cents, type, category: "Groceries", budget: "essential", tags: "", source: "Card",
});

function api(opts: { periodsFail?: { value: boolean }; rows?: TransactionRow[]; error?: { status: number; body: unknown } } = {}) {
  const calls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/summary/periods") return opts.periodsFail?.value ? json({ error: "periods down" }, 500) : json(periods);
    if (url.pathname === "/api/lookups") return json({ categories: ["Groceries"], tags: [], sources: periods.sources });
    if (opts.error) return json(opts.error.body, opts.error.status);
    const rows = opts.rows ?? [row(2, "2026-09-29", 5420), row(1, "2026-09-27", 500000, "income")];
    const body: TransactionsResponse = {
      rows, count: rows.length,
      incomeCents: rows.filter((r) => r.type === "income").reduce((a, r) => a + r.amountCents, 0),
      expensesCents: rows.filter((r) => r.type === "expense").reduce((a, r) => a + r.amountCents, 0),
    };
    return json(body);
  };
  return { fetch, calls };
}

function renderAt(url: string, mock = api()) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TransactionsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

let desktop = true;
beforeEach(() => {
  desktop = true;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T09:00:00"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("TransactionsPage", () => {
  it("opens on the previous month while the current one is empty", async () => {
    const mock = renderAt("/transactions");
    await waitFor(() => expect(location).toBe("?from=2026-09-01&to=2026-09-30"));
    expect(await screen.findByText("September 2026")).toBeInTheDocument();
    await waitFor(() => expect(mock.calls.some((u) => u.pathname === "/api/transactions" && u.searchParams.get("from") === "2026-09-01")).toBe(true));
  });

  it("shows the count and both totals, and steps months", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    const totals = within(await screen.findByRole("region", { name: "Totals" }));
    expect(totals.getByText("2 transactions")).toBeInTheDocument();
    expect(totals.getByText("€5,000.00")).toBeInTheDocument();
    expect(totals.getByText("€54.20")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(location).toBe("?from=2026-08-01&to=2026-08-31"));
  });

  it("keeps a drill-down's filters as given", async () => {
    const mock = renderAt('/transactions?from=2026-01-01&to=2026-12-31&category=%22Groceries%22&type=expense&excludeHidden=1');
    await waitFor(() => expect(mock.calls.some((u) => u.pathname === "/api/transactions" && u.searchParams.get("excludeHidden") === "1")).toBe(true));
    expect(location).toContain("category=");
    expect(screen.getByText("2026-01-01 – 2026-12-31")).toBeInTheDocument();
  });

  it("shows a 400 message under the filters", async () => {
    renderAt("/transactions?from=2026-09-01", api({ error: { status: 400, body: { error: "min must be a number" } } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("min must be a number");
  });

  it("says when nothing matches", async () => {
    renderAt("/transactions?merchant=zzz", api({ rows: [] }));
    expect(await screen.findByText("No transactions match these filters.")).toBeInTheDocument();
  });

  it("shows rows a page at a time", async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row(i + 1, "2026-09-10", 100));
    renderAt("/transactions?from=2026-09-01&to=2026-09-30", api({ rows: many }));
    await screen.findByText(`${PAGE_SIZE + 5} transactions`, { exact: false });
    expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 1); // + header
    await userEvent.click(screen.getByRole("button", { name: "Show more (5 left)" }));
    expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 6);
  });

  it("uses day groups on a phone", async () => {
    desktop = false;
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    expect(await screen.findByRole("heading", { name: "Tue 29 Sep" })).toBeInTheDocument();
  });

  it("offers a retry when the periods fail on a bare URL", async () => {
    const fail = { value: true };
    renderAt("/transactions", api({ periodsFail: fail }));
    expect(await screen.findByText("periods down")).toBeInTheDocument();
    fail.value = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(location).toBe("?from=2026-09-01&to=2026-09-30"));
  });

  it("returns to the default month when filters are cleared", async () => {
    renderAt("/transactions?merchant=zzz", api({ rows: [] }));
    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(location).toBe("?from=2026-09-01&to=2026-09-30"));
  });

  it("says transaction for a single row", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30", api({ rows: [row(1, "2026-09-10", 100)] }));
    expect(within(await screen.findByRole("region", { name: "Totals" })).getByText("1 transaction")).toBeInTheDocument();
  });

  it("freezes the header, filters and totals, but not the table", async () => {
    renderAt("/transactions?from=2026-09-01&to=2026-09-30");
    await screen.findByRole("region", { name: "Totals" });
    const controls = screen.getByRole("region", { name: "Transaction controls" });
    expect(within(controls).getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(within(controls).getByRole("region", { name: "Totals" })).toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(within(controls).queryByRole("table")).not.toBeInTheDocument();
  });
});
