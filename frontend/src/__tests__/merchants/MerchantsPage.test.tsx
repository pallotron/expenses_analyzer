/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, merchant, renderMerchants, setDesktop, useHarness } from "./harness";

useHarness();

const rows = [
  merchant(1, "Corner Shop", { totalCents: -1250, rules: [{ id: 7, pattern: "^CORNER" }] }),
  merchant(2, "Cafe One", { category: null, budget: "discretionary", totalCents: -400 }),
  merchant(3, "Pay", { category: "Salary", type: "income", totalCents: 300000, budget: "discretionary" }),
];

describe("the Merchants page", () => {
  it("lists merchants by total size, with the totals line", async () => {
    renderMerchants("/merchants", api(rows));
    const table = await screen.findByRole("table");
    const names = within(table).getAllByRole("button", { name: /^Edit / }).map((b) => b.textContent);
    expect(names).toEqual(["Pay", "Corner Shop", "Cafe One"]);
    expect(screen.getByText("3 merchants · 1 uncategorized")).toBeInTheDocument();
    expect(within(table).getByText("^CORNER")).toBeInTheDocument();
    expect(within(table).getByText("+€3,000.00")).toBeInTheDocument();
    expect(within(table).getByText("−€12.50")).toBeInTheDocument();
  });

  it("keeps filters in the URL", async () => {
    renderMerchants("/merchants", api(rows));
    await screen.findByRole("table");
    await userEvent.click(within(screen.getByRole("group", { name: "Needs attention" })).getByRole("button", { name: "Uncategorized" }));
    expect(screen.getByLabelText("location")).toHaveTextContent("attention=uncategorized");
    expect(screen.getAllByRole("button", { name: /^Edit / }).map((b) => b.textContent)).toEqual(["Cafe One"]);
  });

  it("sorts by a column header", async () => {
    renderMerchants("/merchants", api(rows));
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /Merchant/ }));
    expect(screen.getAllByRole("button", { name: /^Edit / }).map((b) => b.textContent)).toEqual(["Cafe One", "Corner Shop", "Pay"]);
  });

  it("links each merchant to its transactions, exact match", async () => {
    renderMerchants("/merchants", api(rows));
    const link = await screen.findByRole("link", { name: "Transactions for Corner Shop" });
    expect(link).toHaveAttribute("href", `/transactions?${new URLSearchParams({ merchant: '"Corner Shop"' })}`);
  });

  it("opens the editor on the merchant's rule", async () => {
    renderMerchants("/merchants", api(rows));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Corner Shop" }));
    const sheet = screen.getByRole("dialog", { name: "Merchant rule" });
    expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("^CORNER");
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("Corner Shop");
  });

  it("offers a choice when a merchant has several rules", async () => {
    renderMerchants("/merchants", api([merchant(1, "Corner Shop", { rules: [{ id: 7, pattern: "^CORNER" }, { id: 8, pattern: "CRNR" }] })]));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Corner Shop" }));
    const sheet = screen.getByRole("dialog", { name: "Merchant rule" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "CRNR" }));
    expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("CRNR");
    await userEvent.click(within(sheet).getByRole("radio", { name: "New rule" }));
    expect(within(sheet).getByRole("textbox", { name: "Pattern" })).toHaveValue("Corner\\s+Shop.*");
    expect(within(sheet).getByRole("textbox", { name: "Display name" })).toHaveValue("");
  });

  it("shows cards on a phone", async () => {
    setDesktop(false);
    renderMerchants("/merchants", api(rows));
    await waitFor(() => expect(screen.getByRole("list", { name: "Merchants" })).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
