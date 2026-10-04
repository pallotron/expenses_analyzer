/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, merchant, renderMerchants, useHarness } from "./harness";

useHarness();

const lookups = (gemini: boolean) => () => ({
  body: { categories: ["Groceries", "Hardware"], tags: [], sources: [], essentialCategories: [], gemini },
});
const rows = [
  merchant(1, "Corner Shop", { category: "Hardware" }),
  merchant(2, "Cafe One", { category: null }),
  merchant(3, "Bakery", { category: "Groceries" }),
  merchant(4, "Mystery Ltd", { category: "Groceries" }),
];
const opinion = {
  answers: [
    { id: 3, name: "Bakery", current: "Groceries", suggested: "groceries", isNew: false },
    { id: 2, name: "Cafe One", current: null, suggested: "Coffee", isNew: true },
    { id: 1, name: "Corner Shop", current: "Hardware", suggested: "Groceries", isNew: false },
  ],
  unanswered: 1,
};
const bar = () => screen.getByRole("region", { name: "Selected merchants" });
const posts = (mock: ReturnType<typeof api>, path: string) =>
  mock.calls.filter((c) => c.method === "POST" && c.path === path).map((c) => c.body);

async function selectAll() {
  for (const name of ["Corner Shop", "Cafe One", "Bakery", "Mystery Ltd"]) {
    await userEvent.click(await screen.findByRole("checkbox", { name: `Select ${name}` }));
  }
}

describe("asking Gemini about selected merchants", () => {
  it("is not offered when Gemini is not set up", async () => {
    renderMerchants("/merchants", api(rows, { "GET /api/lookups": lookups(false) }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    expect(within(bar()).queryByRole("button", { name: "Ask Gemini" })).not.toBeInTheDocument();
  });

  it("shows disagreements to tick, agreements folded away, and applies only the ticked ones", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/ask": () => ({ body: opinion }),
      "POST /api/merchants/categories": (b) => ({ body: { updated: (b as { changes: unknown[] }).changes.length } }),
    }));
    await selectAll();
    await userEvent.click(within(bar()).getByRole("button", { name: "Ask Gemini" }));
    await waitFor(() => expect(posts(mock, "/api/merchants/ask")).toEqual([{ ids: [1, 2, 3, 4] }]));

    const sheet = await screen.findByRole("dialog", { name: "Gemini's opinion on 4 merchants" });
    const corner = within(sheet).getByRole("checkbox", { name: "Corner Shop: Hardware → Groceries" });
    const cafe = within(sheet).getByRole("checkbox", { name: "Cafe One: Uncategorized → Coffee (new)" });
    expect(corner).not.toBeChecked();
    expect(cafe).not.toBeChecked();
    // Same category in another case is agreement, not a change.
    expect(within(sheet).queryByRole("checkbox", { name: /^Bakery/ })).not.toBeInTheDocument();
    expect(within(sheet).getByText("Agrees on 1")).toBeInTheDocument();
    expect(within(sheet).getByText("No answer for 1")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Apply (0)" })).toBeDisabled();

    await userEvent.click(cafe);
    await userEvent.click(within(sheet).getByRole("button", { name: "Apply (1)" }));
    await waitFor(() => expect(posts(mock, "/api/merchants/categories")).toEqual([{ changes: [{ id: 2, category: "Coffee" }] }]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changed 1 merchant"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected merchants" })).not.toBeInTheDocument();
  });

  it("says so when Gemini agrees with everything", async () => {
    renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/ask": () => ({ body: { answers: [opinion.answers[0]], unanswered: 0 } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Ask Gemini" }));
    const sheet = await screen.findByRole("dialog", { name: "Gemini's opinion on 1 merchant" });
    expect(within(sheet).getByText("Gemini agrees with every category.")).toBeInTheDocument();
  });

  it("closing the sheet changes nothing", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/ask": () => ({ body: opinion }),
    }));
    await selectAll();
    await userEvent.click(within(bar()).getByRole("button", { name: "Ask Gemini" }));
    const sheet = await screen.findByRole("dialog", { name: /Gemini's opinion/ });
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Corner Shop/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(posts(mock, "/api/merchants/categories")).toEqual([]);
    expect(bar()).toHaveTextContent("4 selected");
  });

  it("keeps the selection and offers Retry when the ask fails, disabling the bar meanwhile", async () => {
    let attempts = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = api(rows, { "GET /api/lookups": lookups(true) });
    renderMerchants("/merchants", {
      ...mock,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/merchants/ask")) {
          attempts++;
          if (attempts === 2) await gate;
          return new Response(JSON.stringify(attempts === 1 ? { error: "Gemini didn't answer (HTTP 429)" } : opinion),
            { status: attempts === 1 ? 502 : 200, headers: { "content-type": "application/json" } });
        }
        return mock.fetch(input, init);
      },
    });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Ask Gemini" }));
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent("Gemini didn't answer (HTTP 429)"));
    expect(bar()).toHaveTextContent("1 selected");
    await userEvent.click(within(toast).getByRole("button", { name: "Retry" }));
    expect(await within(bar()).findByRole("button", { name: "Asking Gemini…" })).toBeDisabled();
    expect(within(bar()).getByRole("button", { name: "Set category" })).toBeDisabled();
    release();
    expect(await screen.findByRole("dialog", { name: /Gemini's opinion/ })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps the sheet open with the Worker's message when Apply fails", async () => {
    renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/ask": () => ({ body: opinion }),
      "POST /api/merchants/categories": () => ({ status: 500, body: { error: "Database is busy" } }),
    }));
    await selectAll();
    await userEvent.click(within(bar()).getByRole("button", { name: "Ask Gemini" }));
    const sheet = await screen.findByRole("dialog", { name: /Gemini's opinion/ });
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Corner Shop/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Apply (1)" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Database is busy");
  });
});
