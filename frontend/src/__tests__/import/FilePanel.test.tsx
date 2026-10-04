/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { FilePanel } from "../../import/FilePanel";
import { FileRowView } from "../../import/FileRow";
import { csvGrid } from "../../import/grid";
import { importList, type Action, type FileRow } from "../../import/importList";
import type { ImportMapping } from "../../lib/types";

afterEach(cleanup);

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
const MANY = "Date,Description,Amount\n"
  + Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")},Shop ${i + 1},-${i + 1}.00`).join("\n") + "\n";

function rowFor(csv: string, source: string): FileRow {
  const actions: Action[] = [
    { type: "add", files: [{ id: "f1", file: new File([csv], "sept.csv") }] },
    { type: "read", id: "f1", grid: csvGrid(csv), saved: { Card: SAVED } },
    { type: "choose", id: "f1", choice: source, saved: { Card: SAVED } },
  ];
  return actions.reduce(importList, [] as FileRow[])[0];
}

/** The panel with a live reducer behind it, so edits re-parse as on the page. */
function Live(props: { initial: FileRow }) {
  const [rows, dispatch] = useReducer(importList, [props.initial]);
  return <FilePanel row={rows[0]} locked={false} dispatch={dispatch} />;
}
const showPanel = (csv: string, source = "Card") => render(<Live initial={rowFor(csv, source)} />);

describe("the raw view", () => {
  it("shows the file as read with line numbers, and the total beyond 20 rows", () => {
    const long = "Notes\n\n" + "Date,Description,Amount\n"
      + Array.from({ length: 22 }, (_, i) => `2026-09-01,Shop ${i},-1.00`).join("\n");
    showPanel(long);
    const raw = screen.getByText("Show the file as read").closest("details")!;
    expect(raw).not.toHaveAttribute("open");
    const rows = within(within(raw).getByRole("table", { name: "File as read" })).getAllByRole("row");
    expect(rows).toHaveLength(20);
    expect(within(rows[0]).getByText("1")).toBeInTheDocument();
    expect(within(rows[19]).getByText("20")).toBeInTheDocument();
    expect(within(raw).getByText("First 20 of 25 rows")).toBeInTheDocument();
  });

  it("marks the header row", () => {
    showPanel(CARD_CSV);
    const table = screen.getByRole("table", { name: "File as read" });
    const current = within(table).getAllByRole("row").filter((r) => r.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText("Completed Date")).toBeInTheDocument();
    expect(screen.queryByText(/^First 20 of/)).not.toBeInTheDocument();
  });

  it("is shown, with nothing marked, when no header is found", () => {
    showPanel("1,2\n3,4\n", "Bank");
    const table = screen.getByRole("table", { name: "File as read" });
    expect(within(table).getAllByRole("row").filter((r) => r.getAttribute("aria-current") === "true")).toHaveLength(0);
  });
});

describe("the preview", () => {
  it("shows all parsed rows on request and collapses again", async () => {
    showPanel(MANY, "Bank");
    await userEvent.click(screen.getByRole("button", { name: "Use these columns" }));
    const preview = screen.getByRole("table", { name: "Preview" });
    expect(within(preview).getAllByRole("row")).toHaveLength(11);
    await userEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(within(preview).getAllByRole("row")).toHaveLength(13);
    await userEvent.click(screen.getByRole("button", { name: "Show first 10" }));
    expect(within(preview).getAllByRole("row")).toHaveLength(11);
  });

  it("offers no Show all for 10 rows or fewer", () => {
    showPanel(CARD_CSV);
    expect(screen.getByRole("table", { name: "Preview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("lists the line numbers behind a skip reason", async () => {
    showPanel(CARD_CSV);
    await userEvent.click(screen.getByText("1 not COMPLETED"));
    expect(screen.getByText("Rows 3")).toBeInTheDocument();
  });

  it("re-parses as the mapping changes, and Edit opens the form for a fitting mapping", async () => {
    showPanel(CARD_CSV);
    expect(screen.queryByRole("group", { name: "Mapping" })).not.toBeInTheDocument();
    expect(screen.getByText("2 to import (1 expense, 1 income)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("group", { name: "Mapping" });
    await userEvent.clear(within(form).getByLabelText("Only rows where value is"));
    await userEvent.selectOptions(within(form).getByLabelText("Only rows where"), "");
    expect(await screen.findByText("3 to import (2 expenses, 1 income)")).toBeInTheDocument();
  });
});

describe("the header row field", () => {
  async function openForm() {
    showPanel(CARD_CSV);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
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

  it("is empty, not 0, when no header was found", () => {
    showPanel("a,b\n1,2\n", "Bank");
    expect(screen.getByLabelText("Header row")).toHaveValue(null);
  });
});

describe("the row's warning", () => {
  const showRow = (csv: string) => {
    const row = rowFor(csv, "Card");
    render(<ul><FileRowView row={row} sources={["Card"]} saved={{ Card: SAVED }} locked={false} lastDates={{}}
      dispatch={() => {}} onRetryCheck={() => {}} onRetryImport={() => {}} /></ul>);
  };

  it("does not warn about dot decimals", () => {
    showRow(CARD_CSV);
    expect(screen.getByLabelText("Status of sept.csv")).toBeInTheDocument();
    expect(screen.queryByText(/comma for decimals/)).not.toBeInTheDocument();
  });

  it("warns for comma decimals", () => {
    showRow(CARD_CSV.replace("-6.55", '"-12,50"'));
    expect(screen.getByText(/comma for decimals/)).toBeInTheDocument();
  });
});
