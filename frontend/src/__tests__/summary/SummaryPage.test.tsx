/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SummaryPage } from "../../summary/SummaryPage";
import { NOT_SET_UP } from "../../lib/api";
import { mockApi, summary } from "./fixtures";

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderAt(url: string, api = mockApi()) {
  vi.stubGlobal("fetch", vi.fn(api.fetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <SummaryPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("SummaryPage", () => {
  it("opens on the newest year and shows its figures", async () => {
    const api = renderAt("/");
    expect(await screen.findByText("€61,400.00")).toBeInTheDocument();
    expect(api.calls.some((u) => u.pathname === "/api/summary" && u.searchParams.get("year") === "2026")).toBe(true);
  });

  it("moves to a month when its chip is pressed, and puts it in the URL", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("button", { name: "Feb" }));
    await waitFor(() => expect(location).toContain("month=2"));
    expect(api.calls.some((u) => u.searchParams.get("month") === "2")).toBe(true);
  });

  it("refetches with hidden tags included when toggled", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("switch", { name: /include hidden tags/i }));
    await waitFor(() => expect(api.calls.some((u) => u.searchParams.get("hidden") === "1")).toBe(true));
  });

  it("shows what the exclusion hides", async () => {
    renderAt("/?year=2026");
    expect(await screen.findByText(/excluding emergency/i)).toHaveTextContent("€1,240.00 hidden");
  });

  it("says so when there is no data at all", async () => {
    renderAt("/", mockApi({ periods: { years: [], sources: [] } }));
    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it("shows an error with a retry button when the API fails", async () => {
    renderAt("/?year=2026", mockApi({ status: 500 }));
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("filters sources, including selecting none", async () => {
    const api = renderAt("/?year=2026", mockApi({ summary: () => summary() }));
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("button", { name: /sources/i }));
    await userEvent.click(within(screen.getByRole("group", { name: /sources/i })).getByRole("button", { name: "None" }));
    await waitFor(() => expect(api.calls.some((u) =>
      u.searchParams.has("sources") && u.searchParams.getAll("sources").join() === "")).toBe(true));
    expect(location).toContain("sources=");
  });

  it("falls back to the newest year and the whole year for an unknown period", async () => {
    const api = renderAt("/?year=1999&month=6");
    await screen.findByText("€61,400.00");
    const asked = api.calls.filter((u) => u.pathname === "/api/summary");
    expect(asked.length).toBeGreaterThan(0);
    for (const u of asked) {
      expect(u.searchParams.get("year")).toBe("2026");
      expect(u.searchParams.has("month")).toBe(false);
    }
  });

  it("drops a month the year has no data for", async () => {
    const api = renderAt("/?year=2026&month=6");
    await screen.findByText("€61,400.00");
    expect(api.calls.filter((u) => u.pathname === "/api/summary").every((u) => !u.searchParams.has("month"))).toBe(true);
  });

  it("clears the month when the year changes", async () => {
    renderAt("/?year=2026&month=2");
    await screen.findByText("€61,400.00");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2025");
    await waitFor(() => expect(location).toContain("year=2025"));
    expect(location).not.toContain("month");
  });

  it("reports an account that is not set up, without a retry", async () => {
    renderAt("/?year=2026", mockApi({ status: 403 }));
    expect(await screen.findByText(NOT_SET_UP)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("keeps the hidden-tags switch reachable when the summary errors", async () => {
    const api = mockApi();
    renderAt("/?year=2026&hidden=1", {
      calls: api.calls,
      fetch: async (input: RequestInfo | URL) =>
        String(input).startsWith("/api/summary?")
          ? new Response(JSON.stringify({ error: "boom" }), { status: 500 })
          : api.fetch(input),
    });
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /include hidden tags/i })).toBeInTheDocument();
    expect(screen.queryByText(/no tags excluded/i)).not.toBeInTheDocument();
  });

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    });

    it("puts the filters behind one button with a count", async () => {
      const api = renderAt("/?year=2026&sources=Card");
      await screen.findByRole("region", { name: "Cash flow" }); // amounts are compact on a phone
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
      await userEvent.click(screen.getByRole("switch", { name: /include hidden tags/i }));
      await waitFor(() => expect(api.calls.some((u) => u.searchParams.get("hidden") === "1")).toBe(true));
      expect(location).toContain("hidden=1");
      expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
    });
  });

  it("lists ten merchants and reveals the rest on request", async () => {
    renderAt("/?year=2026");
    const merchants = await screen.findByRole("region", { name: "Top expense merchants" });
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(10);
    await userEvent.click(within(merchants).getByRole("button", { name: /show all 12/i }));
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(12);
  });

  it("shows the budget used, prorated to a month in a month view", async () => {
    renderAt("/?year=2026&month=2", mockApi({ summary: () => summary({ month: 2, monthlyTotals: null, monthly: null }) }));
    // 3,400,000 / 12 = 283,333.33 cents budget; 2,410,000 essential -> 851% used
    expect(await screen.findByText(/851% of €2,833\.33\/mo/)).toBeInTheDocument();
  });

  it("collapses the merchant list on a phone until it is tapped", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    renderAt("/?year=2026");
    const merchants = await screen.findByRole("region", { name: "Top expense merchants" });
    expect(within(merchants).queryAllByRole("listitem")).toHaveLength(0);
    await userEvent.click(within(merchants).getByRole("button", { name: /top expense merchants/i }));
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(10);
  });
});
