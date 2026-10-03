/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, patched, posted, renderAt, row, URL_SEPT, useHarness } from "./pageHarness";

useHarness();

const openShop3 = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Edit Shop 3" }));
  return screen.getByRole("dialog", { name: "Edit transaction" });
};

describe("editing one transaction", () => {
  it("sends only what changed, with a comma decimal", async () => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12,50");
    await userEvent.selectOptions(within(sheet).getByLabelText("Category"), "Eating out");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched(mock)).toEqual([{ id: 3, body: { amountCents: 1250, category: "Eating out" } }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("pre-fills the amount with dot decimals", async () => {
    renderAt(URL_SEPT, api({ rows: [row(3, "2026-09-29", 121136)] }));
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    expect(amount).toHaveValue("1211.36");
  });

  it.each(["0", "abc"])("refuses the amount %j without a request", async (typed) => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, typed);
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Enter an amount more than zero, like 12.50");
    expect(patched(mock)).toEqual([]);
  });

  it("refuses a minus-signed amount without a request", async () => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "-15");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Amounts are always positive; use Expense/Income for the direction");
    expect(patched(mock)).toEqual([]);
  });

  it("refuses a plus-signed amount without a request", async () => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openShop3();
    const amount = within(sheet).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "+15");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Amounts are always positive; use Expense/Income for the direction");
    expect(patched(mock)).toEqual([]);
  });

  it("clears an override by choosing From merchant", async () => {
    const { mock } = renderAt(URL_SEPT, api({ rows: [{ ...row(3, "2026-09-29", 100), category: "Eating out", categoryOverridden: true }] }));
    const sheet = await openShop3();
    const select = within(sheet).getByLabelText("Category");
    expect(select).toHaveValue("Eating out");
    expect(within(select).getByRole("option", { name: "From merchant (Groceries)" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Other" })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched(mock)).toEqual([{ id: 3, body: { category: null } }]));
  });

  it("keeps every typed value and shows the server's message on a 400", async () => {
    renderAt(URL_SEPT, api({ patch: () => ({ status: 400, body: { error: "Date must be between 1900-01-01 and 2027-10-03" } }) }));
    const sheet = await openShop3();
    const source = within(sheet).getByLabelText("Source");
    await userEvent.clear(source);
    await userEvent.type(source, "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Date must be between");
    expect(within(sheet).getByLabelText("Source")).toHaveValue("Bank A");
  });

  it("says when the transaction no longer exists, and refreshes the list", async () => {
    const rows = { value: [row(3, "2026-09-29", 100), row(2, "2026-09-28", 100)] };
    renderAt(URL_SEPT, api({ rowsRef: rows, patch: () => ({ status: 404, body: { error: "This transaction no longer exists." } }) }));
    const sheet = await openShop3();
    await userEvent.click(within(sheet).getByRole("button", { name: "Income" }));
    rows.value = [row(2, "2026-09-28", 100)];
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("This transaction no longer exists.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit Shop 3" })).not.toBeInTheDocument());
  });

  it("disables Save until something changes, and while saving", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mock } = renderAt(URL_SEPT, api({ gate }));
    const sheet = await openShop3();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Income" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByRole("button", { name: "Saving…" })).toBeDisabled();
    // A second press and a second submit while the first is held must not send again.
    await userEvent.click(within(sheet).getByRole("button", { name: "Saving…" }));
    fireEvent.submit(sheet.querySelector("form")!);
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patched(mock)).toHaveLength(1);
  });

  it("offers Retry after a network error, but not after a server refusal", async () => {
    let failed = false;
    const { mock } = renderAt(URL_SEPT, api({
      patch: () => { if (!failed) { failed = true; throw new Error("offline"); } return { body: { ok: true } }; },
    }));
    const sheet = await openShop3();
    await userEvent.click(within(sheet).getByRole("button", { name: "Income" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't save");
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patched(mock)).toHaveLength(2);
  });

  it("offers no Retry on a 400", async () => {
    renderAt(URL_SEPT, api({ patch: () => ({ status: 400, body: { error: "Nope" } }) }));
    const sheet = await openShop3();
    await userEvent.click(within(sheet).getByRole("button", { name: "Income" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Nope");
    expect(within(sheet).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("does not count stray spaces in the stored text as a change", async () => {
    renderAt(URL_SEPT, api({ rows: [{ ...row(3, "2026-09-29", 100), merchantRaw: "SHOP 3  ", source: "Card " }] }));
    const sheet = await openShop3();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("deletes from the sheet through the Undo flow", async () => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openShop3();
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/delete")).toEqual([{ ids: [3] }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 deleted");
  });

  it("shows how the statement text displays today", async () => {
    renderAt(URL_SEPT);
    const sheet = await openShop3();
    expect(within(sheet).getByLabelText("Statement text")).toHaveValue("SHOP 3");
    expect(sheet).toHaveTextContent("Shows as: Shop 3");
  });
});
