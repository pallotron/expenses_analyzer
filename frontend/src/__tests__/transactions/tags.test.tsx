/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { splitTags } from "../../transactions/edit/TagInput";
import { api, bar, posted, renderAt, row, URL_SEPT, useHarness } from "./pageHarness";

useHarness();

const page = () =>
  renderAt(URL_SEPT, api({
    rows: [{ ...row(3, "2026-09-29", 100), tags: "gift,travel" }, row(2, "2026-09-28", 100)],
    lookups: { tags: ["emergency", "travel"] },
  }));

describe("splitTags", () => {
  it("applies the Worker's tag rule", () => {
    expect(splitTags("Travel, Trip , ,travel")).toEqual(["travel", "trip"]);
    expect(splitTags("Road Trip!, trip:2026")).toEqual(["road-trip", "trip:2026"]);
  });
});

describe("tagging", () => {
  it("focuses the tag box when the sheet opens", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Tags" })).toHaveFocus();
  });

  it("turns a picked suggestion into a chip at once", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog");
    const box = within(sheet).getByRole("combobox", { name: "Tags" });
    // A datalist pick arrives as a plain change, not typed input.
    fireEvent.change(box, { target: { value: "emergency" } });
    expect(within(sheet).getByRole("list", { name: "Chosen tags" })).toHaveTextContent("emergency");
    expect(box).toHaveValue("");
  });

  it("does not chip a suggestion while it is still being typed", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog");
    const box = within(sheet).getByRole("combobox", { name: "Tags" });
    await userEvent.type(box, "emerg");
    expect(within(sheet).queryByRole("list", { name: "Chosen tags" })).not.toBeInTheDocument();
    expect(box).toHaveValue("emerg");
    // Typing the whole word letter by letter stays typing too.
    await userEvent.type(box, "ency");
    expect(within(sheet).queryByRole("list", { name: "Chosen tags" })).not.toBeInTheDocument();
  });

  it("offers Retry when tagging never got an answer", async () => {
    const { mock } = page();
    const real = mock.fetch;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && init?.method === "POST") throw new TypeError("Failed to fetch");
      return real(input, init);
    }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Tags" }), "trip{Enter}");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't save: Failed to fetch");
    fail = false;
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tagged 2"));
  });

  it("adds typed and chosen tags, including text not yet turned into a chip", async () => {
    const { mock } = page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog", { name: "Tag 2 transactions" });
    const box = within(sheet).getByRole("combobox", { name: "Tags" });
    await userEvent.type(box, "Holiday{Enter}Trip ");
    expect(within(sheet).getByText("holiday")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    await waitFor(() => expect(posted(mock, "/api/transactions/tags")).toEqual([{ ids: [3, 2], tags: ["holiday", "trip"], mode: "add" }]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tagged 2"));
    // Selection stays, so a mistake can be untagged at once.
    expect(bar()).toHaveTextContent("2 selected");
  });

  it("removes a chip with Backspace on an empty box", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    // The page filter is also a "Tags" combobox, so look inside the sheet.
    const box = within(screen.getByRole("dialog", { name: "Tag 1 transactions" })).getByRole("combobox", { name: "Tags" });
    await userEvent.type(box, "a,b,{Backspace}");
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("suggests only the tags the selection carries when untagging", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Untag" }));
    const sheet = screen.getByRole("dialog", { name: "Untag 2 transactions" });
    const options = Array.from(sheet.querySelectorAll("datalist option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["gift", "travel"]);
  });

  it("will not submit with no tags", async () => {
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Select Shop 3/ }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    expect(screen.getByRole("button", { name: "Add tags" })).toBeDisabled();
  });

  it("keeps the sheet and chips on a failure, and clears the alert on retry", async () => {
    let calls = 0;
    const routes = {
      "POST /api/transactions/tags": () => (++calls === 1 ? { status: 500, body: { error: "boom" } } : { body: { tagged: 2 } }),
    };
    renderAt(URL_SEPT, api({ routes }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog", { name: "Tag 2 transactions" });
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Tags" }), "holiday,");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("boom");
    expect(sheet).toHaveAttribute("open");
    expect(within(sheet).getByText("holiday")).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent("Tagged");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tagged 2"));
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds the sheet open while the request is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    renderAt(URL_SEPT, api({ gate }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.click(within(bar()).getByRole("button", { name: "Tag" }));
    const sheet = screen.getByRole("dialog", { name: "Tag 2 transactions" });
    await userEvent.type(within(sheet).getByRole("combobox", { name: "Tags" }), "holiday,");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add tags" }));
    const busy = await within(sheet).findByRole("button", { name: "Tagging 2…" });
    expect(busy).toBeDisabled();
    fireEvent(sheet, new Event("cancel", { cancelable: true }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(sheet).toHaveAttribute("open");
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tagged 2"));
  });
});
