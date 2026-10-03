/** @vitest-environment jsdom */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PAGE_SIZE } from "../../transactions/TransactionsPage";
import { api, bar, renderAt, row, setDesktop, URL_SEPT, useHarness } from "./pageHarness";

useHarness();

describe("selecting transactions", () => {
  it("shows the action bar once a row is ticked, and hides it on Cancel", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    expect(bar()).toHaveTextContent("1 selected");
    await userEvent.click(within(bar()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
  });

  it("ticks every shown row from the header, and every filtered row from the bar", async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row(i + 1, "2026-09-10", 100));
    renderAt(URL_SEPT, api({ rows: many }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    expect(bar()).toHaveTextContent(`${PAGE_SIZE} selected`);
    await userEvent.click(within(bar()).getByRole("button", { name: `Select all ${PAGE_SIZE + 5}` }));
    expect(bar()).toHaveTextContent(`${PAGE_SIZE + 5} selected`);
  });

  it("clears the selection when the filters change", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
  });

  it("counts only selected rows still in the list after a refetch", async () => {
    // A row deleted elsewhere drops out of the selection.
    const rows = { value: [row(3, "2026-09-29", 100), row(2, "2026-09-28", 100)] };
    const { client } = renderAt(URL_SEPT, api({ rowsRef: rows }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    rows.value = [row(3, "2026-09-29", 100)];
    await act(() => client.invalidateQueries({ queryKey: ["transactions"] }));
    await waitFor(() => expect(bar()).toHaveTextContent("1 selected"));
  });

  it("opens a row by clicking it, but not by ticking it", async () => {
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    expect(screen.getByTestId("open-row")).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole("button", { name: "Edit Shop 3" }));
    // The sheet itself arrives in a later task; here the page records the open row.
    expect(screen.getByTestId("open-row")).toHaveTextContent("3");
  });

  it("offers the same on a phone", async () => {
    setDesktop(false);
    renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    expect(bar()).toHaveTextContent("1 selected");
  });
});
