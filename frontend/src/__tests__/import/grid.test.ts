import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { csvGrid, readGrid, sheetGrid, UnsupportedFileError } from "../../import/grid";

describe("csvGrid", () => {
  it("handles a BOM, quotes, embedded commas and newlines", () => {
    expect(csvGrid('﻿Date,Description,Amount\n01/09/2026,"Shop, The",-1.00\n02/09/2026,"Two\nlines",2\n')).toEqual([
      ["Date", "Description", "Amount"],
      ["01/09/2026", "Shop, The", "-1.00"],
      ["02/09/2026", "Two\nlines", "2"],
    ]);
  });

  it("trims trailing blank rows but keeps interior ones", () => {
    expect(csvGrid("a,b\n\nc,d\n\n\n")).toEqual([["a", "b"], [""], ["c", "d"]]);
  });

  it("detects semicolon-separated exports", () => {
    expect(csvGrid("Date;Description;Amount\n01/09/2026;Shop;-1,00\n")[1]).toEqual(["01/09/2026", "Shop", "-1,00"]);
  });
});

function workbook(bookType: "xls" | "xlsx"): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["  General Details"],
    ["Account name", "Current"],
    [],
    ["Date", "", "Description", "Money In (€)", "Money Out (€)"],
    ["01/09/2026", "", "Corner Shop", "", -71.35],
    [new Date(Date.UTC(2026, 8, 2)), "", "Acme Payroll", 250, ""],
  ], { cellDates: true, UTC: true });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Transactions");
  return XLSX.write(book, { type: "array", bookType });
}

describe("sheetGrid", () => {
  it.each(["xls", "xlsx"] as const)("reads a %s export: text, numbers and dates as text cells", async (bookType) => {
    const grid = await sheetGrid(workbook(bookType));
    expect(grid[3]).toEqual(["Date", "", "Description", "Money In (€)", "Money Out (€)"]);
    expect(grid[4]).toEqual(["01/09/2026", "", "Corner Shop", "", "-71.35"]);
    expect(grid[5]).toEqual(["2026-09-02", "", "Acme Payroll", "250", ""]);
    expect(grid[2].every((c) => c === "")).toBe(true);
  });
});

describe("sheetGrid offsets", () => {
  it.each([["A3", 2, 0], ["C3", 2, 2]])("keeps line and column numbers when the sheet starts at %s", async (origin, row, col) => {
    const sheet = XLSX.utils.sheet_add_aoa({}, [["Date", "Description"], ["01/09/2026", "Shop"]], { origin });
    // aoa_to_sheet always starts the range at A1; real files start where their data does.
    sheet["!ref"] = XLSX.utils.encode_range({ s: { r: row, c: col }, e: { r: row + 1, c: col + 1 } });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "S");
    const grid = await sheetGrid(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    expect(grid[row][col]).toBe("Date");
    expect(grid[row + 1][col + 1]).toBe("Shop");
    expect(grid.slice(0, row).every((r) => r.every((c) => c === ""))).toBe(true);
  });
});

describe("readGrid", () => {
  it("reads by extension, ignoring case", async () => {
    expect(await readGrid(new File(["a,b,c\n1,2,3"], "Sept.CSV"))).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    const xls = await readGrid(new File([workbook("xls")], "bank.xls"));
    expect(xls[3][2]).toBe("Description");
  });

  it("refuses other files", async () => {
    await expect(readGrid(new File(["x"], "statement.pdf"))).rejects.toThrow(UnsupportedFileError);
    await expect(readGrid(new File(["x"], "statement.pdf"))).rejects.toThrow("Choose a .csv, .xls or .xlsx file");
  });
});
