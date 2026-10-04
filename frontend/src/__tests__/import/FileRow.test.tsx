/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileRowView, statusText } from "../../import/FileRow";
import { importList, type Action, type FileRow, type RowStatus } from "../../import/importList";
import type { ImportMapping } from "../../lib/types";

afterEach(cleanup);

const GRID = [["Date", "Description", "Amount"], ["01/09/2026", "Corner Shop", "-6,55"]];
const MAP: ImportMapping = { date: "Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const result = { batchId: 1, inserted: 3, duplicates: 2, suppressedDeleted: 1, newMerchants: [] };
const counts = { inserted: 33, duplicates: 26, suppressedDeleted: 0, newMerchants: [] };

function rowAfter(actions: Action[]): FileRow {
  return actions.reduce(importList, [] as FileRow[])[0];
}
const base: Action[] = [
  { type: "add", files: [{ id: "f1", file: new File(["x"], "sept.csv") }, { id: "f2", file: new File(["y"], "other.csv") }] },
  { type: "read", id: "f1", grid: GRID, saved: { Card: MAP } },
];

describe("statusText", () => {
  it.each([
    [{ kind: "reading" }, "Reading…"],
    [{ kind: "readFailed", message: "Choose a .csv, .xls or .xlsx file" }, "Couldn't read: Choose a .csv, .xls or .xlsx file"],
    [{ kind: "sameFile" }, "Same file as above"],
    [{ kind: "leftOut" }, "Left out"],
    [{ kind: "needsMapping", missing: [] }, "Needs mapping: choose its columns"],
    [{ kind: "needsMapping", missing: ["Started Date"] }, "Needs mapping: no 'Started Date' column"],
    [{ kind: "needsMapping", missing: ["A", "B"] }, "Needs mapping: no 'A', 'B' columns"],
    [{ kind: "nothing" }, "Nothing to import"],
    [{ kind: "tooMany", rows: 5001 }, "Too many rows (5001): split the file"],
    [{ kind: "checking" }, "Checking…"],
    [{ kind: "ready", counts, skipped: 0 }, "Ready · 33 new · 26 already there"],
    [{ kind: "ready", counts: { ...counts, suppressedDeleted: 4 }, skipped: 1 }, "Ready · 33 new · 26 already there · 4 deleted · 1 skipped"],
    [{ kind: "checkFailed", message: "Request failed (500)" }, "Couldn't check: Request failed (500)"],
    [{ kind: "refused", message: "The file has rows the import refuses", errors: [] }, "Refused: The file has rows the import refuses"],
    [{ kind: "importing" }, "Importing…"],
    [{ kind: "imported", result }, "Imported 3 · 2 already there · 1 deleted"],
    [{ kind: "importFailed", message: "Request failed (500)", errors: [] }, "Failed: Request failed (500)"],
  ] as const)("%o", (status, text) => {
    expect(statusText(status as RowStatus)).toBe(text);
  });
});

describe("a file's row", () => {
  function show(row: FileRow, locked = false) {
    const dispatch = vi.fn();
    const onRetryCheck = vi.fn();
    const onRetryImport = vi.fn();
    render(<ul><FileRowView row={row} sources={["Card", "Cash"]} saved={{ Card: MAP }} locked={locked}
      dispatch={dispatch} onRetryCheck={onRetryCheck} onRetryImport={onRetryImport} /></ul>);
    return { dispatch, onRetryCheck, onRetryImport };
  }

  it("picks a source, removes, and opens", async () => {
    const { dispatch } = show(rowAfter(base));
    expect(screen.getByLabelText("Status of sept.csv")).toHaveTextContent("Left out");
    await userEvent.selectOptions(screen.getByLabelText("Source for sept.csv"), "Card");
    expect(dispatch).toHaveBeenCalledWith({ type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } });
    await userEvent.click(screen.getByRole("button", { name: "Remove sept.csv" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "remove", id: "f1" });
    await userEvent.click(screen.getByRole("button", { name: "Show sept.csv" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggle", id: "f1" });
  });

  it("asks to confirm the columns for a source without a saved mapping", async () => {
    const row = rowAfter([...base, { type: "choose", id: "f1", choice: "Cash", saved: { Card: MAP } }]);
    const { dispatch } = show(row);
    expect(screen.getByRole("group", { name: "Mapping" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use these columns" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm", id: "f1" });
  });

  it("warns about comma decimals on the row itself", () => {
    show(rowAfter([...base, { type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } }]));
    expect(screen.getByRole("alert")).toHaveTextContent(`Some amounts use a comma for decimals (e.g. "-6,55")`);
  });

  it("offers Retry for a failed check and a failed import", async () => {
    const chosen = rowAfter([...base, { type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } }]);
    const failedCheck = importList([chosen], { type: "checkFailed", id: "f1", version: chosen.version, message: "down", refused: false })[0];
    const a = show(failedCheck);
    await userEvent.click(within(screen.getByLabelText("Status of sept.csv")).getByRole("button", { name: "Retry" }));
    expect(a.onRetryCheck).toHaveBeenCalledWith("f1");
    cleanup();
    const failedImport = importList([chosen], { type: "importFailed", id: "f1", message: "The file has rows the import refuses", errors: ["Found 1 bad date"] })[0];
    const b = show(failedImport);
    expect(screen.getByText("Found 1 bad date")).toBeInTheDocument();
    await userEvent.click(within(screen.getByLabelText("Status of sept.csv")).getByRole("button", { name: "Retry" }));
    expect(b.onRetryImport).toHaveBeenCalledWith("f1");
  });

  it("locks its controls while importing", () => {
    show(rowAfter([...base, { type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } }]), true);
    expect(screen.getByLabelText("Source for sept.csv")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove sept.csv" })).toBeDisabled();
  });
});
