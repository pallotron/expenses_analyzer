/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, posted, renderAt, row, URL_SEPT, useHarness, type Route } from "./pageHarness";

useHarness();

const preview: Route = (_b, url) => ({
  body: url.searchParams.get("pattern")?.startsWith("[")
    ? { matched: 0, totalCents: 0, currentCategories: {}, merchants: {}, error: "bad" }
    : { matched: 2, totalCents: 700, currentCategories: { Groceries: 2 }, merchants: { "SHOP 3": 1, "SHOP 2": 1 } },
});

function page(rule: Route = () => ({ body: { rule: null, merchant: "SHOP 3", category: null } }), extra: Record<string, Route> = {},
  getGate?: () => Promise<void> | undefined) {
  return renderAt(URL_SEPT, api({
    getGate,
    rows: [row(3, "2026-09-29", 100), row(2, "2026-09-28", 100)],
    lookups: { essentialCategories: ["Groceries"] },
    routes: {
      "GET /api/merchants/rule": rule,
      "GET /api/merchants/preview": preview,
      "POST /api/merchants/decision": () => ({ body: { repointed: 1, tagged: 2 } }),
      ...extra,
    },
  }));
}

async function openEditor() {
  await userEvent.click(await screen.findByRole("button", { name: "Edit Shop 3" }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "Edit transaction" })).getByRole("button", { name: "Merchant rule…" }));
  return screen.getByRole("dialog", { name: "Merchant rule" });
}

describe("the merchant editor from a transaction", () => {
  it("starts from a suggested pattern when no rule decides the name", async () => {
    page();
    const sheet = await openEditor();
    expect(within(sheet).getByText(/SHOP 3/)).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("SHOP.*"));
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("");
    expect(within(sheet).queryByRole("button", { name: "Delete rule" })).not.toBeInTheDocument();
  });

  it("starts from the rule in force, with its merchant and category", async () => {
    page(() => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: "Groceries" } }));
    const sheet = await openEditor();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^SHOP"));
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("Shop");
    expect(within(sheet).getByRole("combobox", { name: "Category" })).toHaveValue("Groceries");
    const budget = await within(sheet).findByRole("group", { name: "Groceries type" });
    expect(within(budget).getByRole("button", { pressed: true })).toHaveTextContent("Essential");
  });

  it("changes the category's budget type on the spot, without saving the rule", async () => {
    const { mock } = page(() => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: "Groceries" } }),
      { "POST /api/budget-types/category": () => ({ body: { ok: true } }) });
    const sheet = await openEditor();
    const budget = await within(sheet).findByRole("group", { name: "Groceries type" });
    expect(sheet).toHaveTextContent("for every merchant in Groceries");
    await userEvent.click(within(budget).getByRole("button", { name: "Discretionary" }));
    await waitFor(() => expect(posted(mock, "/api/budget-types/category")).toEqual([
      { name: "Groceries", spendingType: "discretionary" },
    ]));
    expect(posted(mock, "/api/merchants/decision")).toEqual([]);
  });

  it("shows a new category's type read-only, as there is nothing saved to change", async () => {
    page(() => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: "Groceries" } }));
    const sheet = await openEditor();
    await within(sheet).findByRole("group", { name: "Groceries type" });
    const category = within(sheet).getByRole("combobox", { name: "Category" });
    await userEvent.clear(category);
    await userEvent.type(category, "Brand new");
    expect(sheet).toHaveTextContent("Budget: Discretionary (from category)");
    expect(within(sheet).queryByRole("group", { name: /type$/ })).toBeNull();
  });

  it("previews what the pattern claims", async () => {
    page();
    const sheet = await openEditor();
    const section = await within(sheet).findByRole("region", { name: "Preview" });
    await waitFor(() => expect(section).toHaveTextContent("Matches 2 transactions · €7.00"));
    expect(section).toHaveTextContent("Currently 2 Groceries");
    expect(section).toHaveTextContent("Claims: SHOP 2, SHOP 3");
  });

  it("refuses a pattern that does not compile, at once", async () => {
    page();
    const sheet = await openEditor();
    const box = within(sheet).getByRole("textbox", { name: "Pattern" });
    await waitFor(() => expect(box).toHaveValue("SHOP.*"));
    await userEvent.clear(box);
    await userEvent.type(box, "[[bad");
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Invalid pattern");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves tags still in the box, with the category, and says what moved", async () => {
    const { mock } = page();
    const sheet = await openEditor();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("SHOP.*"));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Display name" }), "Shop");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Category" }), "Groceries");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Tags to add" }), "weekly");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(mock, "/api/merchants/decision")).toEqual([
      { pattern: "SHOP.*", alias: "Shop", category: "Groceries", tags: ["weekly"] },
    ]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved Shop: re-pointed 1, tagged 2"));
    expect(screen.queryByRole("dialog", { name: "Merchant rule" })).not.toBeInTheDocument();
  });

  it("asks for a display name before saving", async () => {
    const { mock } = page();
    const sheet = await openEditor();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("SHOP.*"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Enter a display name");
    expect(posted(mock, "/api/merchants/decision")).toEqual([]);
  });

  it("deletes the rule in force after a confirm", async () => {
    const { mock } = page(
      () => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: null } }),
      { "POST /api/merchants/rules/4/delete": () => ({ body: { repointed: 3 } }) },
    );
    const sheet = await openEditor();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Delete rule" }));
    expect(sheet).toHaveTextContent("Matching rows go back to their own names or the next rule.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(posted(mock, "/api/merchants/rules/4/delete")).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Rule deleted: re-pointed 3"));
  });

  it("Save waits for the rule lookup", async () => {
    let release!: () => void;
    const getGate = new Promise<void>((r) => { release = r; });
    renderAt(URL_SEPT, api({
      rows: [row(3, "2026-09-29", 100)],
      getGate,
      routes: { "GET /api/merchants/rule": () => ({ body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: null } }) },
    }));
    const sheet = await openEditor();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    release();
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^SHOP"));
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps what you typed when the page re-renders", async () => {
    page();
    const sheet = await openEditor();
    const box = within(sheet).getByRole("textbox", { name: "Pattern" });
    await waitFor(() => expect(box).toHaveValue("SHOP.*"));
    await userEvent.type(box, "X");
    // The sheet is modal, so re-render the page through the DOM beneath it.
    const checkbox = document.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(checkbox).not.toBeNull();
    checkbox?.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(box).toHaveValue("SHOP.*X");
  });

  it("says when the rule cannot be loaded and retries", async () => {
    let fail = true;
    page(() => (fail ? { status: 500, body: { error: "boom" } } : { body: { rule: { id: 4, pattern: "^SHOP" }, merchant: "Shop", category: null } }));
    const sheet = await openEditor();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't load the rule for this merchant.");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    fail = false;
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^SHOP"));
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("waits for a fresh rule when reopened from the cache, never showing the stale one", async () => {
    let name = "A";
    let hold: Promise<void> | undefined;
    const { client } = page(
      () => ({ body: { rule: { id: 4, pattern: `^${name}` }, merchant: name, category: null } }),
      {}, () => hold,
    );
    let sheet = await openEditor();
    const patternBox = () => within(sheet).getByRole("textbox", { name: "Pattern" });
    await waitFor(() => expect(patternBox()).toHaveValue("^A"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    const edit = screen.queryByRole("dialog", { name: "Edit transaction" });
    if (edit) await userEvent.click(within(edit).getByRole("button", { name: "Close" }));

    // Another tab renamed the rule; a merchant write here would invalidate the lookup.
    name = "B";
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    await client.invalidateQueries({ queryKey: ["merchant-rule"], refetchType: "none" });
    sheet = await openEditor();
    expect(patternBox()).not.toHaveValue("^A");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    release();
    await waitFor(() => expect(patternBox()).toHaveValue("^B"));
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("sends the pattern as typed, trailing space included", async () => {
    const { mock } = page();
    const sheet = await openEditor();
    const box = within(sheet).getByRole("textbox", { name: "Pattern" });
    await waitFor(() => expect(box).toHaveValue("SHOP.*"));
    await userEvent.clear(box);
    await userEvent.type(box, "SHOP ");
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Display name" }), "Shop");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(mock, "/api/merchants/decision")).toEqual([{ pattern: "SHOP ", alias: "Shop" }]));
  });

  it("stops previewing once the sheet closes", async () => {
    const { client } = page();
    const sheet = await openEditor();
    await within(sheet).findByRole("region", { name: "Preview" });
    const active = () => client.getQueryCache().findAll({ queryKey: ["alias-preview"] }).filter((q) => q.isActive()).length;
    expect(active()).toBe(1);
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(active()).toBe(0));
  });

  it("shows the pattern shorthand in code elements", async () => {
    page();
    const sheet = await openEditor();
    expect(Array.from(sheet.querySelectorAll("code")).map((c) => c.textContent)).toEqual([".*", "\\d", "\\s"]);
  });
});
