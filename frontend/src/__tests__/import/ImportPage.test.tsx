/** @vitest-environment jsdom */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ImportMapping } from "../../lib/types";
import { csvGrid, readGrid } from "../../import/grid";
import { api, csvFile, renderImport, useHarness } from "./harness";

// readGrid stays real unless a test hands it a pending read.
vi.mock("../../import/grid", async (orig) => {
  const actual = await orig<typeof import("../../import/grid")>();
  return { ...actual, readGrid: vi.fn(actual.readGrid) };
});

useHarness();

const CARD_CSV =
  "Type,Completed Date,Description,Amount,State\n"
  + "Card Payment,2026-09-01 12:34:19,Corner Shop,-6.55,COMPLETED\n"
  + "Card Payment,2026-09-02 08:00:00,Cafe One,-3.00,PENDING\n"
  + "Topup,2026-09-03 09:00:00,Acme Payroll,100.00,COMPLETED\n"
  + "Card Payment,2026-09-04 09:00:00,,-1.00,COMPLETED\n";
const SAVED: ImportMapping = {
  date: "Completed Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy",
  filter: { column: "State", value: "COMPLETED" },
};

async function pick(file: File, source = "Card") {
  await userEvent.upload(screen.getByLabelText("File"), file);
  await userEvent.selectOptions(screen.getByLabelText("Source"), source);
}

describe("the import page", () => {
  it("starts with no source chosen, and shows no mapping or preview until one is", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    expect(screen.getByLabelText("Source")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose a source…" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "New source…" })).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("table", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mapping" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    expect(await screen.findByRole("table", { name: "Preview" })).toBeInTheDocument();
  });

  it("puts Source before File and explains the page", async () => {
    renderImport(api());
    const source = await screen.findByLabelText("Source");
    const file = screen.getByLabelText("File");
    expect(source.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Pick the account, then its statement. Nothing is saved until you press Import.")).toBeInTheDocument();
  });

  it("reads a file dropped on the drop zone, the same as a chosen one", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    expect(screen.getByText(".csv, .xls or .xlsx")).toBeInTheDocument();
    const zone = screen.getByText("Drop a statement here or choose a file").closest("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [csvFile(CARD_CSV)] } });
    expect(await screen.findByText(/Date ← Completed Date/)).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Preview" })).getByText("Corner Shop")).toBeInTheDocument();
  });

  it("uses a saved mapping that fits, collapsed, and previews the parsed rows", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV));
    expect(await screen.findByText(/Date ← Completed Date/)).toBeInTheDocument();
    expect(screen.getByText(/State = COMPLETED/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mapping" })).not.toBeInTheDocument();

    const preview = screen.getByRole("table", { name: "Preview" });
    expect(within(preview).getAllByRole("row")).toHaveLength(3); // header + 2 rows
    expect(within(preview).getByText("Corner Shop")).toBeInTheDocument();
    expect(screen.getByText("2 to import (1 expense, 1 income)")).toBeInTheDocument();
    expect(screen.getByText("1 not COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("1 empty merchant")).toBeInTheDocument();
  });

  it("lists the line numbers behind a skip reason", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV));
    await userEvent.click(await screen.findByText("1 not COMPLETED"));
    expect(screen.getByText("Rows 3")).toBeInTheDocument();
  });

  it("opens the form, pre-filled, and names a missing column when the saved mapping no longer fits", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV.replace("Completed Date", "Date Completed")));
    expect(await screen.findByText("This file has no 'Completed Date' column")).toBeInTheDocument();
    const form = screen.getByRole("group", { name: "Mapping" });
    expect(within(form).getByLabelText("Date")).toHaveValue("Date Completed");
    expect(within(form).getByLabelText("Merchant")).toHaveValue("Description");
  });

  it("re-parses as the mapping changes, and Edit opens the form for a fitting mapping", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("group", { name: "Mapping" });
    await userEvent.clear(within(form).getByLabelText("Only rows where value is"));
    await userEvent.selectOptions(within(form).getByLabelText("Only rows where"), "");
    expect(await screen.findByText("3 to import (2 expenses, 1 income)")).toBeInTheDocument();
  });

  it("offers a new source by name, defaulting to CSV Import", async () => {
    renderImport(api({ sources: ["Card"] }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV), "New source…");
    expect(screen.getByLabelText("New source name")).toHaveValue("CSV Import");
  });

  it("does not mistake an Object.prototype name for a saved mapping", async () => {
    renderImport(api({ sources: ["constructor"], mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV), "constructor");
    const form = await screen.findByRole("group", { name: "Mapping" });
    expect(within(form).getByLabelText("Date")).toBeInTheDocument();
    expect(screen.queryByText(/no '.*' column/)).not.toBeInTheDocument();
  });

  it("drops a slow read that lands after a later pick", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    let land!: () => void;
    vi.mocked(readGrid).mockImplementationOnce(
      () => new Promise((resolve) => { land = () => resolve(csvGrid(CARD_CSV.replace("Corner Shop", "First Shop"))); }),
    );
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV, "first.csv"));
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV.replace("Corner Shop", "Second Shop"), "second.csv"));
    expect(await within(await screen.findByRole("table", { name: "Preview" })).findByText("Second Shop")).toBeInTheDocument();
    land();
    await new Promise((r) => setTimeout(r, 20));
    expect(within(screen.getByRole("table", { name: "Preview" })).getByText("Second Shop")).toBeInTheDocument();
    expect(screen.queryByText("First Shop")).not.toBeInTheDocument();
  });

  it("applies the saved mapping of a source chosen while the file is still reading", async () => {
    renderImport(api({ sources: ["Card", "Other"], mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Other");
    let land!: () => void;
    vi.mocked(readGrid).mockImplementationOnce(
      () => new Promise((resolve) => { land = () => resolve(csvGrid(CARD_CSV)); }),
    );
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV));
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    land();
    expect(await screen.findByText(/State = COMPLETED/)).toBeInTheDocument();
  });

  it("keeps an edited mapping when the new source name is blurred unchanged", async () => {
    renderImport(api());
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV), "New source…");
    const form = await screen.findByRole("group", { name: "Mapping" });
    await userEvent.selectOptions(within(form).getByLabelText("Only rows where"), "State");
    await userEvent.click(screen.getByLabelText("New source name"));
    await userEvent.tab();
    expect(within(screen.getByRole("group", { name: "Mapping" })).getByLabelText("Only rows where")).toHaveValue("State");
  });

  it("refuses a file it cannot read", async () => {
    renderImport(api());
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), new File(["x"], "statement.pdf"), { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a .csv, .xls or .xlsx file");
  });

  it("warns above the preview when amounts use a comma for decimals", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV.replace("-6.55", '"-12,50"')));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Some amounts use a comma for decimals (e.g. "-12,50"); they would import 100 times too large. Fix the file\'s number format before importing.',
    );
  });

  it("does not warn about dot decimals", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV));
    await screen.findByText(/Date ← Completed Date/);
    expect(screen.queryByText(/comma for decimals/)).not.toBeInTheDocument();
  });

  it("clears the file input so the same file can be picked again", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV));
    await screen.findByText(/Date ← Completed Date/);
    expect((screen.getByLabelText("File") as HTMLInputElement).files).toHaveLength(0);
  });

  describe("the header row field", () => {
    async function openForm(csv = CARD_CSV) {
      renderImport(api({ mappings: { Card: SAVED } }));
      await screen.findByLabelText("Source");
      await pick(csvFile(csv));
      await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
      return screen.getByLabelText("Header row") as HTMLInputElement;
    }

    it("leaves the mapping alone for empty or non-numeric input", async () => {
      const input = await openForm();
      expect(input).toHaveValue(1);
      fireEvent.change(input, { target: { value: "" } });
      expect(input).toHaveValue(1);
      expect(screen.getByText("2 to import (1 expense, 1 income)")).toBeInTheDocument();
    });

    it("clamps to the rows the file has", async () => {
      const input = await openForm();
      fireEvent.change(input, { target: { value: "99" } });
      expect(input).toHaveValue(csvGrid(CARD_CSV).length);
      fireEvent.change(input, { target: { value: "0" } });
      expect(input).toHaveValue(1);
    });

    it("is empty, not 0, when no header was found", async () => {
      renderImport(api());
      await screen.findByLabelText("Source");
      await pick(csvFile("a,b\n1,2\n"));
      expect(await screen.findByLabelText("Header row")).toHaveValue(null);
    });
  });
});

describe("the chosen file, the file as read, and every parsed row", () => {
  const MANY = "Date,Description,Amount\n"
    + Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")},Shop ${i + 1},-${i + 1}.00`).join("\n") + "\n";

  it("shows the file name and its row count, with Choose another", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    expect(screen.queryByRole("button", { name: "Choose another" })).not.toBeInTheDocument();
    await pick(csvFile(CARD_CSV, "sept.csv"));
    expect(await screen.findByText("sept.csv · 5 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another" })).toBeInTheDocument();
    expect(screen.getByLabelText("File")).toHaveClass("sr-only");
    expect(screen.queryByText("Drop a statement here or choose a file")).not.toBeInTheDocument();
  });

  it("shows Reading <name>… while the file is read", async () => {
    let release!: (g: string[][]) => void;
    vi.mocked(readGrid).mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV, "slow.csv"));
    expect(await screen.findByText("Reading slow.csv…")).toBeInTheDocument();
    release(csvGrid(CARD_CSV));
    expect(await screen.findByText("slow.csv · 5 rows")).toBeInTheDocument();
  });

  it("shows the file as read with line numbers, and the total beyond 20 rows", async () => {
    const long = "Notes\n\n" + "Date,Description,Amount\n"
      + Array.from({ length: 22 }, (_, i) => `2026-09-01,Shop ${i},-1.00`).join("\n");
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(long));
    await screen.findByText("sept.csv · 25 rows");
    const raw = screen.getByText("Show the file as read").closest("details")!;
    expect(raw).not.toHaveAttribute("open");
    const rows = within(within(raw).getByRole("table", { name: "File as read" })).getAllByRole("row");
    expect(rows).toHaveLength(20);
    expect(within(rows[0]).getByText("1")).toBeInTheDocument();
    expect(within(rows[19]).getByText("20")).toBeInTheDocument();
    expect(within(raw).getByText("First 20 of 25 rows")).toBeInTheDocument();
  });

  it("keeps the raw view open when a source is chosen", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV));
    const raw = (await screen.findByText("Show the file as read")).closest("details")!;
    await userEvent.click(screen.getByText("Show the file as read"));
    expect(raw).toHaveAttribute("open");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    await screen.findByText(/Date ← Completed Date/);
    expect(screen.getByText("Show the file as read").closest("details")).toBe(raw);
    expect(raw).toHaveAttribute("open");
  });

  it("shows the plain file name, not Reading, after a failed read", async () => {
    vi.mocked(readGrid).mockImplementationOnce(() => Promise.reject(new Error("Cannot read it")));
    renderImport(api());
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV, "bad.csv"));
    expect(await screen.findByText("Cannot read it")).toBeInTheDocument();
    expect(screen.getByText("bad.csv")).toBeInTheDocument();
    expect(screen.queryByText(/Reading/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another" })).toBeInTheDocument();
  });

  it("marks the header row, shown before any source is chosen", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CARD_CSV));
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    await screen.findByText(/Date ← Completed Date/);
    const table = screen.getByRole("table", { name: "File as read" });
    const current = within(table).getAllByRole("row").filter((r) => r.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText("Completed Date")).toBeInTheDocument();
    expect(screen.queryByText(/^First 20 of/)).not.toBeInTheDocument();
  });

  it("shows the raw view even when no header is found", async () => {
    renderImport(api());
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile("1,2\n3,4\n"));
    expect(await screen.findByRole("table", { name: "File as read" })).toBeInTheDocument();
  });

  it("shows all parsed rows on request and collapses again", async () => {
    renderImport(api());
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(MANY));
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    const preview = await screen.findByRole("table", { name: "Preview" });
    expect(within(preview).getAllByRole("row")).toHaveLength(11);
    await userEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(within(preview).getAllByRole("row")).toHaveLength(13);
    await userEvent.click(screen.getByRole("button", { name: "Show first 10" }));
    expect(within(preview).getAllByRole("row")).toHaveLength(11);
  });

  it("offers no Show all for 10 rows or fewer", async () => {
    renderImport(api({ mappings: { Card: SAVED } }));
    await screen.findByLabelText("Source");
    await pick(csvFile(CARD_CSV));
    await screen.findByRole("table", { name: "Preview" });
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });
});
