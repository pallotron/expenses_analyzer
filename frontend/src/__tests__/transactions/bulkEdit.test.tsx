/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { api, bar, posted, renderAt, URL_SEPT, useHarness } from "./pageHarness";

useHarness();

describe("bulk editing", () => {
  const openBulk = async () => {
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Edit" }));
    return screen.getByRole("dialog", { name: "Edit 2 transactions" });
  };

  it("sends only the fields changed from 'Leave unchanged'", async () => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openBulk();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.selectOptions(within(sheet).getByLabelText("Category"), "");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/bulk-edit")).toEqual([
      { ids: [3, 2], edit: { source: "Bank A", category: null } },
    ]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Updated 2"));
    expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
  });

  it("sets the type for all of them", async () => {
    const { mock } = renderAt(URL_SEPT);
    const sheet = await openBulk();
    await userEvent.selectOptions(within(sheet).getByLabelText("Type"), "income");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect((posted(mock, "/api/transactions/bulk-edit")[0] as { edit: unknown }).edit).toEqual({ type: "income" }));
  });

  it("says when some were already gone", async () => {
    renderAt(URL_SEPT, api({ updatedCount: 1 }));
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Updated 1 of 2 (1 was already gone)"));
  });

  it("treats a box of spaces as unchanged", async () => {
    renderAt(URL_SEPT);
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Statement text"), "   ");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows a server message with no Retry", async () => {
    const routes = { "POST /api/transactions/bulk-edit": () => ({ status: 400, body: { error: "Nope" } }) };
    renderAt(URL_SEPT, api({ routes }));
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Nope");
    expect(within(sheet).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers Retry after a network error, and the retry succeeds", async () => {
    let calls = 0;
    const routes = {
      "POST /api/transactions/bulk-edit": (b: unknown) => {
        if (++calls === 1) throw new TypeError("offline");
        return { body: { updated: (b as { ids: number[] }).ids.length } };
      },
    };
    renderAt(URL_SEPT, api({ routes }));
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await userEvent.click(await within(sheet).findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Updated 2"));
    expect(calls).toBe(2);
  });

  it("sends one request when Save is pressed twice while pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mock } = renderAt(URL_SEPT, api({ gate }));
    const sheet = await openBulk();
    await userEvent.type(within(sheet).getByLabelText("Source"), "Bank A");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    const busy = await within(sheet).findByRole("button", { name: "Saving 2…" });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    fireEvent.submit(sheet.querySelector("form")!);
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Updated 2"));
    expect(posted(mock, "/api/transactions/bulk-edit")).toHaveLength(1);
  });
});
