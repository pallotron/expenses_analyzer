/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, bar, posted, renderAt, row, URL_SEPT, useHarness } from "./pageHarness";

useHarness();

const many = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1, "2026-09-10", 100));

describe("deleting", () => {
  it("deletes a few rows at once and offers Undo", async () => {
    const { mock } = renderAt(URL_SEPT);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 deleted"));
    expect(posted(mock, "/api/transactions/delete")).toEqual([{ ids: [3] }]);
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/restore")).toEqual([{ ids: [3] }]));
  });

  it("asks first above twenty rows, with the count and the total", async () => {
    const { mock } = renderAt(URL_SEPT, api({ rows: many(21) }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    const sheet = screen.getByRole("dialog", { name: "Delete 21 transactions?" });
    expect(sheet).toHaveTextContent("€21.00");
    expect(posted(mock, "/api/transactions/delete")).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete 21" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("21 deleted"));
  });

  it("does not ask for exactly twenty", async () => {
    renderAt(URL_SEPT, api({ rows: many(20) }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends one request however often Delete is pressed while it runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mock } = renderAt(URL_SEPT, api({ rows: many(21), gate }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete 21" }));
    const busy = within(screen.getByRole("dialog")).getByRole("button", { name: /Deleting 21/ });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("21 deleted"));
    expect(posted(mock, "/api/transactions/delete")).toHaveLength(1);
  });

  it("restores once however often Undo is pressed, and shows progress meanwhile", async () => {
    // Holds every POST after the first (the delete) until released.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let posts = 0;
    const gate = { then: (ok: () => void, bad?: () => void) => (posts++ === 0 ? Promise.resolve() : held).then(ok, bad) } as unknown as Promise<void>;
    const { mock } = renderAt(URL_SEPT, api({ rows: many(2), gate }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    const undo = within(await screen.findByRole("status")).getByRole("button", { name: "Undo" });
    await userEvent.click(undo);
    expect(screen.getByRole("status")).toHaveTextContent("Restoring…");
    expect(within(screen.getByRole("status")).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 restored"));
    expect(posted(mock, "/api/transactions/restore")).toEqual([{ ids: [1, 2] }]);
  });

  it("says when some were already gone", async () => {
    renderAt(URL_SEPT, api({ deletedCount: 1 }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 2 deleted (1 was already gone)"));
  });

  it("offers Retry when Undo fails", async () => {
    renderAt(URL_SEPT, api({ restoreFails: true }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(await screen.findByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't restore"));
    expect(within(screen.getByRole("status")).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
