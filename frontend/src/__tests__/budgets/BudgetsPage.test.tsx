/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetsPage } from "../../budgets/BudgetsPage";
import type { BudgetTypesResponse } from "../../lib/types";

type Call = { path: string; method: string; body: unknown };

function api(opts: { status?: number; saveStatus?: number } = {}) {
  const state: BudgetTypesResponse = {
    categories: [
      { name: "Groceries", spendingType: "essential", expenseCount: 12 },
      { name: "Movies", spendingType: "discretionary", expenseCount: 1 },
      { name: "Unused", spendingType: "discretionary", expenseCount: 0 },
    ],
    essentialBudgetCents: 5_300_000,
    discretionaryBudgetCents: null,
  };
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (opts.status) return json({ error: "boom" }, opts.status);
    if (method === "POST" && opts.saveStatus) return json({ error: "Nope" }, opts.saveStatus);
    if (url.pathname === "/api/budget-types/category") {
      const c = state.categories.find((x) => x.name === body.name);
      if (c) c.spendingType = body.spendingType;
      return json({ ok: true });
    }
    if (url.pathname === "/api/budget-types/budget") {
      if (body.spendingType === "essential") state.essentialBudgetCents = body.annualBudgetCents;
      else state.discretionaryBudgetCents = body.annualBudgetCents;
      return json({ ok: true });
    }
    if (url.pathname === "/api/budget-types") return json(structuredClone(state));
    return json({});
  };
  return { fetch, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

function renderPage(mock = api()) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BudgetsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const pressed = (group: HTMLElement) => within(group).getByRole("button", { pressed: true }).textContent;

describe("the Budgets page", () => {
  it("lists each category with its type and use, and both budgets", async () => {
    renderPage();
    const groceries = await screen.findByRole("group", { name: "Groceries type" });
    expect(pressed(groceries)).toBe("Essential");
    expect(pressed(screen.getByRole("group", { name: "Movies type" }))).toBe("Discretionary");
    expect(screen.getByText("12 rows")).toBeInTheDocument();
    const folded = screen.getByText("1 unused category").closest("details")!;
    expect(folded).not.toHaveAttribute("open");
    expect(folded).toContainElement(screen.getByRole("group", { name: "Unused type" }));
    expect(folded).not.toContainElement(groceries);
    expect(folded).not.toContainElement(screen.getByRole("group", { name: "Movies type" }));
    expect(screen.getByText(/1 essential, 2 discretionary/)).toBeInTheDocument();
    expect(screen.getByLabelText("Essential, per year (€)")).toHaveValue("53000");
    expect(screen.getByLabelText("Discretionary, per year (€)")).toHaveValue("");
    expect(screen.getByText("€4,416.67 a month")).toBeInTheDocument();
  });

  it("narrows the list to matching names, unused ones included, and says when none match", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Groceries type" });
    const search = screen.getByRole("searchbox", { name: "Search categories" });
    await userEvent.type(search, "U");
    expect(screen.queryByRole("group", { name: "Groceries type" })).toBeNull();
    const unused = screen.getByRole("group", { name: "Unused type" });
    expect(unused.closest("details")).toBeNull();
    expect(screen.queryByText(/unused categor/)).toBeNull();
    await userEvent.type(search, "zz");
    expect(screen.getByText('No category matches "Uzz"')).toBeInTheDocument();
    await userEvent.clear(search);
    expect(screen.getByRole("group", { name: "Groceries type" })).toBeInTheDocument();
    expect(screen.getByText("1 unused category")).toBeInTheDocument();
  });

  it("saves a category's type when its switch is pressed", async () => {
    const mock = renderPage();
    const movies = await screen.findByRole("group", { name: "Movies type" });
    await userEvent.click(within(movies).getByRole("button", { name: "Essential" }));
    await waitFor(() => expect(pressed(movies)).toBe("Essential"));
    expect(mock.posts()).toEqual([
      { path: "/api/budget-types/category", method: "POST", body: { name: "Movies", spendingType: "essential" } },
    ]);
    expect(screen.getByText(/2 essential, 1 discretionary/)).toBeInTheDocument();
  });

  it("does not save when the pressed side is pressed again", async () => {
    const mock = renderPage();
    const groceries = await screen.findByRole("group", { name: "Groceries type" });
    await userEvent.click(within(groceries).getByRole("button", { name: "Essential" }));
    expect(mock.posts()).toEqual([]);
  });

  it("keeps the saved type and says why when a save fails", async () => {
    renderPage(api({ saveStatus: 500 }));
    const movies = await screen.findByRole("group", { name: "Movies type" });
    await userEvent.click(within(movies).getByRole("button", { name: "Essential" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save Movies: Nope");
    expect(pressed(movies)).toBe("Discretionary");
  });

  it("saves a budget in cents, and blank as no budget", async () => {
    const mock = renderPage();
    const discretionary = await screen.findByLabelText("Discretionary, per year (€)");
    const form = discretionary.closest("form")!;
    expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(discretionary, "€37,000.5{Enter}");
    await waitFor(() => expect(mock.posts()).toHaveLength(1));
    expect(mock.posts()[0].body).toEqual({ spendingType: "discretionary", annualBudgetCents: 3_700_050 });

    const essential = screen.getByLabelText("Essential, per year (€)");
    await userEvent.clear(essential);
    await userEvent.click(within(essential.closest("form")!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.posts()).toHaveLength(2));
    expect(mock.posts()[1].body).toEqual({ spendingType: "essential", annualBudgetCents: null });
  });

  it("refuses an amount it can't read", async () => {
    const mock = renderPage();
    const essential = await screen.findByLabelText("Essential, per year (€)");
    await userEvent.clear(essential);
    await userEvent.type(essential, "lots{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount in euros");
    expect(within(essential.closest("form")!).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(mock.posts()).toEqual([]);
  });

  it("offers a retry when the budgets can't load", async () => {
    renderPage(api({ status: 500 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the budgets");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
