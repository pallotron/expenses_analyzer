/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, merchant, renderMerchants, setDesktop, useHarness } from "./harness";

useHarness();

const rows = [merchant(1, "Corner Shop"), merchant(2, "Cafe One", { category: null }), merchant(3, "Bakery")];
const bar = () => screen.getByRole("region", { name: "Selected merchants" });
const posts = (mock: ReturnType<typeof api>) => mock.calls.filter((c) => c.method === "POST").map((c) => c.body);

describe("selecting merchants", () => {
  it("sets a typed category on the selected merchants", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "POST /api/merchants/category": (b) => ({ body: { updated: (b as { ids: number[] }).ids.length } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Cafe One" }));
    expect(bar()).toHaveTextContent("2 selected");
    await userEvent.click(within(bar()).getByRole("button", { name: "Set category" }));
    const sheet = screen.getByRole("dialog", { name: "Set category on 2 merchants" });
    const box = within(sheet).getByRole("combobox", { name: "Category" });
    expect(box).toHaveFocus();
    await userEvent.type(box, "Food");
    await userEvent.click(within(sheet).getByRole("button", { name: "Set category" }));
    await waitFor(() => expect(posts(mock)).toEqual([{ ids: [1, 2], category: "Food" }]));
    await waitFor(() => expect(screen.getByText("Set Food on 2 merchants")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Selected merchants" })).not.toBeInTheDocument();
  });

  it("keeps the selection when only the sort changes", async () => {
    renderMerchants("/merchants", api(rows));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(screen.getByRole("button", { name: /Merchant/ }));
    expect(screen.getByRole("checkbox", { name: "Select Corner Shop" })).toBeChecked();
    expect(bar()).toHaveTextContent("1 selected");
  });

  it("clears the category on the selection", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "POST /api/merchants/category": () => ({ body: { updated: 1 } }),
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Clear category" }));
    await waitFor(() => expect(posts(mock)).toEqual([{ ids: [3], category: null }]));
    await waitFor(() => expect(screen.getByText("Cleared the category on 1 merchant")).toBeInTheDocument());
  });

  it("selects every filtered merchant", async () => {
    renderMerchants("/merchants?q=c", api(rows));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Corner Shop" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Select all 2" }));
    expect(bar()).toHaveTextContent("2 selected");
  });

  it("a checkbox click does not open the editor", async () => {
    renderMerchants("/merchants", api(rows));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selects on a phone in a 44px tap target", async () => {
    setDesktop(false);
    renderMerchants("/merchants", api(rows));
    const box = await screen.findByRole("checkbox", { name: "Select Bakery" });
    expect(box.closest("label")).toHaveClass("h-11");
    await userEvent.click(box);
    expect(bar()).toHaveTextContent("1 selected");
  });

  it("says 1 merchant, not 1 merchants, in the totals line", async () => {
    renderMerchants("/merchants", api([merchant(1, "Bakery")]));
    expect(await screen.findByText("1 merchant · 0 uncategorized")).toBeInTheDocument();
  });

  it("tapping the label padding on a phone selects without opening the editor", async () => {
    setDesktop(false);
    renderMerchants("/merchants", api(rows));
    const label = (await screen.findByRole("checkbox", { name: "Select Bakery" })).closest("label")!;
    await userEvent.click(label);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(bar()).toHaveTextContent("1 selected");
  });

  it("disables the sheet's submit while the category is empty", async () => {
    renderMerchants("/merchants", api(rows));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Bakery" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Set category" }));
    const sheet = screen.getByRole("dialog", { name: "Set category on 1 merchant" });
    expect(within(sheet).getByRole("button", { name: "Set category" })).toBeDisabled();
  });
});
