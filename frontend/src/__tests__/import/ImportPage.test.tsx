/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ImportMapping, ImportSource } from "../../lib/types";
import { addFiles, api, asNew, csvFile, renderImport, statusOf, useHarness } from "./harness";

useHarness();

const CARD_CSV = "Started Date,Description,Amount\n2026-09-01 10:00:00,Corner Shop,-6.55\n2026-09-02 09:00:00,Acme Payroll,100.00\n";
const CARD: ImportMapping = { date: "Started Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const SOURCES: ImportSource[] = [
  { name: "Bank", lastDate: null, mapping: null },
  { name: "Card", lastDate: "2026-08-31", mapping: CARD },
];
const pickSource = (file: string, source: string) => userEvent.selectOptions(screen.getByLabelText(`Source for ${file}`), source);

describe("the import list", () => {
  it("shows where each source left off", async () => {
    renderImport(api({ sources: SOURCES }));
    const section = await screen.findByRole("region", { name: "Where each source left off" });
    expect(within(section).getByText("Card").closest("li")).toHaveTextContent("Card 31 Aug 2026");
    expect(within(section).getByText("Bank").closest("li")).toHaveTextContent("Bank no transactions");
  });

  it("lists several files, and checks one once its source's mapping fits", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv"), csvFile(CARD_CSV, "b.csv")]);
    expect(statusOf("a.csv")).toHaveTextContent("Left out");
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new · 0 already there"));
    expect(statusOf("b.csv")).toHaveTextContent("Left out");
    expect(mock.imports(true)).toEqual([expect.objectContaining({ source: "Card", filename: "a.csv", dryRun: true })]);
    expect(mock.imports(false)).toEqual([]);
  });

  it("names the columns a file lacks and opens it", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile("Date,Description,Amount\n01/09/2026,Corner Shop,-6.55\n", "a.csv"), csvFile(CARD_CSV, "b.csv")]);
    await pickSource("a.csv", "Card");
    expect(statusOf("a.csv")).toHaveTextContent("Needs mapping: no 'Started Date' column");
    expect(screen.getByRole("group", { name: "Mapping" })).toBeInTheDocument();
  });

  it("checks a source without a saved mapping once its columns are confirmed", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "Bank");
    expect(statusOf("a.csv")).toHaveTextContent("Needs mapping: choose its columns");
    await userEvent.click(screen.getByRole("button", { name: "Use these columns" }));
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new"));
  });

  it("marks the same file added twice", async () => {
    renderImport(api({ sources: SOURCES }));
    const f = csvFile(CARD_CSV, "a.csv");
    await addFiles([f]);
    await addFiles([f]);
    const statuses = screen.getAllByLabelText("Status of a.csv");
    expect(statuses[1]).toHaveTextContent("Same file as above");
  });

  it("ignores a check answer for an older mapping, even one that lands after the newer check", async () => {
    // A holder, not a `let`: TypeScript narrows a let assigned only in a callback to never.
    const first: { resolve?: (r: { body: unknown }) => void } = {};
    const mock = renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => (first.resolve === undefined
          ? new Promise((resolve) => { first.resolve = resolve; })
          : asNew(body)),
      },
    }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(first.resolve).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(screen.getByLabelText("Type"), "expense");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new"));
    first.resolve?.({ body: { batchId: null, inserted: 99, duplicates: 0, suppressedDeleted: 0, newMerchants: [] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new");
    expect(statusOf("a.csv")).not.toHaveTextContent("99");
    expect(mock.imports(true)).toHaveLength(2);
  });

  it("refuses a file over the cap without checking it", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    const big = "Started Date,Description,Amount\n" + "2026-09-01 10:00:00,Corner Shop,-1.00\n".repeat(5001);
    await addFiles([csvFile(big, "big.csv")]);
    await pickSource("big.csv", "Card");
    expect(statusOf("big.csv")).toHaveTextContent("Too many rows (5001): split the file");
    await new Promise((r) => setTimeout(r, 500));
    expect(mock.imports(true)).toEqual([]);
  });

  it("reports a file it cannot read", async () => {
    renderImport(api({ sources: SOURCES }));
    const zone = (await screen.findByText("Drop statements here or choose files")).closest("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });
    await waitFor(() => expect(statusOf("notes.txt")).toHaveTextContent("Couldn't read: Choose a .csv, .xls or .xlsx file"));
  });

  it("gives a source named constructor no saved mapping", async () => {
    renderImport(api({ sources: [...SOURCES, { name: "constructor", lastDate: null, mapping: null }] }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "constructor");
    expect(statusOf("a.csv")).toHaveTextContent("Needs mapping: choose its columns");
  });

  it("removes a file", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv"), csvFile(CARD_CSV, "b.csv")]);
    await userEvent.click(screen.getByRole("button", { name: "Remove a.csv" }));
    expect(screen.queryByLabelText("Status of a.csv")).not.toBeInTheDocument();
    expect(statusOf("b.csv")).toBeInTheDocument();
  });

  it("retries a check that failed", async () => {
    let fail = true;
    renderImport(api({
      sources: SOURCES,
      routes: { "POST /api/import": (body) => (fail ? { status: 500, body: { error: "down" } } : asNew(body)) },
    }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Couldn't check"));
    fail = false;
    await userEvent.click(within(statusOf("a.csv")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new"));
  });

  it("keeps the raw view open when a source is chosen", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    const raw = (await screen.findByText("Show the file as read")).closest("details")!;
    await userEvent.click(screen.getByText("Show the file as read"));
    expect(raw).toHaveAttribute("open");
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready"));
    expect(screen.getByText("Show the file as read").closest("details")).toBe(raw);
    expect(raw).toHaveAttribute("open");
  });

  it("clears the file input so the same files can be chosen again", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await screen.findByLabelText("Status of a.csv");
    expect((screen.getByLabelText("Files") as HTMLInputElement).files).toHaveLength(0);
  });
});
