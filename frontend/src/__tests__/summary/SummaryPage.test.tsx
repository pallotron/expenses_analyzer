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
    expect(await screen.findByText(/excluding emergency/i)).toHaveTextContent("€1,240.00 expenses hidden");
  });

  it("names hidden income, which the totals also leave out", async () => {
    renderAt("/?year=2026", mockApi({ summary: () => summary({ hiddenCents: 0, hiddenIncomeCents: 9_063_334 }) }));
    expect(await screen.findByText(/excluding emergency/i)).toHaveTextContent("€90,633.34 income hidden");
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
    // On desktop the sources are inline checkboxes: nothing to open first.
    await userEvent.click(within(screen.getByRole("group", { name: /sources/i })).getByRole("button", { name: "None" }));
    await waitFor(() => expect(api.calls.some((u) =>
      u.searchParams.has("sources") && u.searchParams.getAll("sources").join() === "")).toBe(true));
    expect(location).toContain("sources=");
  });

  it("narrows to the remaining sources when one is unticked", async () => {
    const api = renderAt("/?year=2026", mockApi({ summary: () => summary() }));
    await screen.findByText("€61,400.00");
    const sources = screen.getByRole("group", { name: /sources/i });
    expect(within(sources).getAllByRole("checkbox")).toHaveLength(2);
    await userEvent.click(within(sources).getByRole("checkbox", { name: "Card" }));
    await waitFor(() => expect(api.calls.some((u) =>
      u.searchParams.getAll("sources").join() === "Bank A")).toBe(true));
    expect(within(sources).getByRole("checkbox", { name: "Card" })).not.toBeChecked();
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
      ...api,
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

  it("splits the dashboard into tabs kept in the URL", async () => {
    renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    expect(screen.getByRole("tab", { name: "Expenses" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Expense categories" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Monthly expenses" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    await waitFor(() => expect(location).toContain("tab=monthly"));
    expect(screen.getByRole("region", { name: "Monthly expenses" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Expense categories" })).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(location).toContain("tab=income"));
    expect(screen.getByRole("region", { name: "Income categories" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Income" })).toHaveFocus();
  });

  it("keeps the tiles above the tabs whichever is open", async () => {
    renderAt("/?year=2026&tab=income");
    await screen.findByText("€61,400.00");
    expect(screen.getByRole("region", { name: "Cash flow" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Income" })).toHaveAttribute("aria-selected", "true");
  });

  it("has no Monthly tab in a month view, and falls back to Expenses", async () => {
    renderAt("/?year=2026&month=2&tab=monthly", mockApi({ summary: () => summary({ month: 2, monthlyTotals: null, monthly: null }) }));
    await screen.findByRole("region", { name: "Cash flow" });
    expect(screen.queryByRole("tab", { name: "Monthly" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Expenses" })).toHaveAttribute("aria-selected", "true");
  });

  it("does not refetch when only the tab changes", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    const before = api.calls.filter((u) => u.pathname === "/api/summary").length;
    await userEvent.click(screen.getByRole("tab", { name: "Income" }));
    await screen.findByRole("region", { name: "Income categories" });
    expect(api.calls.filter((u) => u.pathname === "/api/summary").length).toBe(before);
  });

  it("lists ten merchants and reveals the rest on request", async () => {
    renderAt("/?year=2026");
    const merchants = await screen.findByRole("region", { name: "Top expense merchants" });
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(10);
    await userEvent.click(within(merchants).getByRole("button", { name: /show all 12/i }));
    expect(within(merchants).getAllByRole("listitem")).toHaveLength(12);
  });

  it("lists ten expense categories and reveals the rest on request", async () => {
    const expenseCategories = Array.from({ length: 12 }, (_, i) => ({
      category: `Category ${i + 1}`, spendingType: "essential" as const, amountCents: 100_000 - i * 1_000,
    }));
    renderAt("/?year=2026", mockApi({ summary: () => summary({ expenseCategories }) }));
    const list = await screen.findByRole("region", { name: "Expense categories" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    await userEvent.click(within(list).getByRole("button", { name: /show all 12/i }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
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

  it("freezes the pickers, filters, tiles and split, but not the tabs", async () => {
    renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    const controls = within(screen.getByRole("region", { name: "Summary controls" }));
    expect(controls.getByLabelText("Year")).toBeInTheDocument();
    expect(controls.getByRole("switch", { name: /include hidden tags/i })).toBeInTheDocument();
    expect(controls.getByText("€61,400.00")).toBeInTheDocument();
    expect(controls.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("links a category to its transactions with the Summary's scope", async () => {
    renderAt("/?year=2026&sources=Card");
    await screen.findByText("€61,400.00");
    const link = within(screen.getByRole("region", { name: "Expense categories" })).getByRole("link", { name: "Groceries" });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("from")).toBe("2026-01-01");
    expect(url.searchParams.get("to")).toBe("2026-12-31");
    expect(url.searchParams.get("type")).toBe("expense");
    expect(url.searchParams.get("category")).toBe('"Groceries"');
    expect(url.searchParams.get("budget")).toBe("essential");
    expect(url.searchParams.getAll("sources")).toEqual(["Card"]);
    expect(url.searchParams.get("excludeHidden")).toBe("1"); // the fixture excludes "emergency"
    expect(url.searchParams.has("tab")).toBe(false);
  });

  it("links a merchant without a budget, and a month view to that month", async () => {
    renderAt("/?year=2026&month=2", mockApi({ summary: () => summary({ month: 2, monthlyTotals: null, monthly: null }) }));
    const merchants = await screen.findByRole("region", { name: "Top expense merchants" });
    const url = new URL(within(merchants).getByRole("link", { name: "Shop 1" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("merchant")).toBe('"Shop 1"');
    expect(url.searchParams.get("from")).toBe("2026-02-01");
    expect(url.searchParams.get("to")).toBe("2026-02-28");
    expect(url.searchParams.has("budget")).toBe(false);
  });

  it("does not exclude hidden tags in links when the Summary includes them", async () => {
    renderAt("/?year=2026&hidden=1&tab=income");
    const sources = await screen.findByRole("region", { name: "Top income sources" });
    const url = new URL(within(sources).getByRole("link", { name: "Employer" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("type")).toBe("income");
    expect(url.searchParams.has("excludeHidden")).toBe(false);
  });

  it("links the monthly grid's cells with the category's budget", async () => {
    renderAt("/?year=2026&tab=monthly");
    const grid = await screen.findByRole("region", { name: "Monthly expenses" });
    const march = within(grid).getAllByRole("link").map((a) => new URL(a.getAttribute("href")!, "http://localhost"))
      .find((u) => u.searchParams.get("from") === "2026-03-01" && u.searchParams.has("category"))!;
    expect(march.searchParams.get("category")).toBe('"Groceries"');
    expect(march.searchParams.get("budget")).toBe("essential");
    expect(march.searchParams.get("type")).toBe("expense");
  });
});

describe("budgets sheet", () => {
  it("opens the budget editor from the essential/discretionary card, with a link to its page", async () => {
    renderAt("/?year=2026");
    await userEvent.click(await screen.findByRole("button", { name: "Edit budgets" }));
    const sheet = await screen.findByRole("dialog", { name: "Budgets" });
    const groceries = await within(sheet).findByRole("group", { name: "Groceries type" });
    expect(within(groceries).getByRole("button", { pressed: true })).toHaveTextContent("Essential");
    expect(within(sheet).getByLabelText("Essential, per year (€)")).toHaveValue("53000");
    expect(within(sheet).getByRole("link", { name: "Open the Budgets page" })).toHaveAttribute("href", "/budgets");
  });
});

describe("hidden-tag editor", () => {
  it("saves the ticked patterns, turns the exclusion on, and says so", async () => {
    const api = renderAt("/?year=2026&hidden=1", mockApi({ tags: ["emergency", "trip:rome"] }));
    await userEvent.click(await screen.findByRole("button", { name: /edit hidden tags/i }));
    const sheet = await screen.findByRole("dialog", { name: /hidden tags/i });
    expect(await within(sheet).findByRole("checkbox", { name: "emergency" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "trip:rome" })).not.toBeChecked();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "trip:*" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saved).toEqual([{ patterns: ["trip:*", "emergency"] }]));
    expect(await screen.findByText("Hiding 2 tag patterns")).toBeInTheDocument();
    await waitFor(() => expect(location).not.toContain("hidden=1"));
  });

  it("can clear every pattern", async () => {
    const api = renderAt("/?year=2026", mockApi({ tags: ["emergency"] }));
    await userEvent.click(await screen.findByRole("button", { name: /edit hidden tags/i }));
    const sheet = await screen.findByRole("dialog", { name: /hidden tags/i });
    await userEvent.click(await within(sheet).findByRole("checkbox", { name: "emergency" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saved).toEqual([{ patterns: [] }]));
    expect(await screen.findByText("No tags hidden")).toBeInTheDocument();
  });

  it("says when no tag is in use", async () => {
    renderAt("/?year=2026", mockApi({ summary: () => summary({ excludedPatterns: [], hiddenCents: 0 }) }));
    await userEvent.click(await screen.findByRole("button", { name: /edit hidden tags/i }));
    const sheet = await screen.findByRole("dialog", { name: /hidden tags/i });
    expect(await within(sheet).findByText("No tags in use")).toBeInTheDocument();
  });

  it("keeps the sheet open with the Worker's message when the save fails", async () => {
    renderAt("/?year=2026", mockApi({ tags: ["emergency"], saveStatus: 400 }));
    await userEvent.click(await screen.findByRole("button", { name: /edit hidden tags/i }));
    const sheet = await screen.findByRole("dialog", { name: /hidden tags/i });
    await within(sheet).findByRole("checkbox", { name: "emergency" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Nope");
  });
});
