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

function page(rule: Route = () => ({ body: { rule: null, merchant: "SHOP 3", category: null } }), extra: Record<string, Route> = {}) {
  return renderAt(URL_SEPT, api({
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
    expect(sheet).toHaveTextContent("Budget: Essential (from category)");
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
});
