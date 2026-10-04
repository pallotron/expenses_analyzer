import { describe, expect, it } from "vitest";

import type { ImportMapping } from "../../api/import";
import {
  columnNames, commaDecimalSample, findHeaderRow, missingColumns, processRows, type SkipReason,
} from "../../domain/importRows";
import rawVectors from "../fixtures/python_vectors.json";

interface Scenario {
  name: string; csv: string; date: string; merchant: string; amount: string; amountOut: string | null;
  typeMode: ImportMapping["typeMode"];
  expected: ({ skip: SkipReason } | { date: string; merchant: string; amountCents: number; type: "expense" | "income" })[];
}
const scenarios = (rawVectors as unknown as { import: { scenarios: Scenario[] } }).import.scenarios;

const grid = (csv: string) => csv.trimEnd().split("\n").map((line) => line.split(","));
const mapping = (over: Partial<ImportMapping> = {}): ImportMapping => ({
  date: "Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy", ...over,
});

describe("processRows matches the Python", () => {
  it.each(scenarios)("$name", (s) => {
    const parsed = processRows(grid(s.csv), mapping({
      date: s.date, merchant: s.merchant, amount: s.amount, typeMode: s.typeMode,
      ...(s.amountOut && { amountOut: s.amountOut }),
    }));
    s.expected.forEach((want, i) => {
      const line = i + 2; // header is line 1
      if ("skip" in want) {
        expect(parsed.skipped[want.skip]).toContain(line);
      } else {
        expect(parsed.rows.find((r) => r.line === line)).toEqual({ line, ...want });
      }
    });
    const skippedCount = Object.values(parsed.skipped).reduce((n, lines) => n + lines.length, 0);
    expect(parsed.rows.length + skippedCount).toBe(s.expected.length);
  });
});

describe("columnNames", () => {
  it("trims, blanks spacers and numbers repeats", () => {
    expect(columnNames([" Date ", "", "Description", "Amount", "Amount", "  ", "Amount"]))
      .toEqual(["Date", null, "Description", "Amount", "Amount (2)", null, "Amount (3)"]);
  });
});

describe("findHeaderRow", () => {
  const bank = [
    ["  General Details", ""],
    ["Account name", "Current"],
    ["", ""],
    ["Date", "", "Description", "Money In (€)", "Money Out (€)"],
    ["01/09/2026", "", "Corner Shop", "", "-71.35"],
  ];

  it("skips a summary above the table: first row with 3+ filled cells", () => {
    expect(findHeaderRow(bank)).toBe(3);
  });

  it("finds a saved mapping's header even when the summary grows", () => {
    const longer = [["Statement"], ["Filters", "All", "x"], ...bank];
    const saved = { date: "Date", merchant: "Description", amount: "Money In (€)", amountOut: "Money Out (€)" };
    // "Filters, All, x" has 3 cells but not the mapped names, so it is passed over.
    expect(findHeaderRow(longer, saved)).toBe(5);
  });

  it("honours a pinned row, and returns -1 when nothing looks like a header", () => {
    expect(findHeaderRow(bank, { headerRow: 1 })).toBe(1);
    expect(findHeaderRow([["a"], ["b", "c"]])).toBe(-1);
  });
});

describe("findHeaderRow with a pin", () => {
  const saved = { date: "Date", merchant: "Description", amount: "Money In (€)", amountOut: "Money Out (€)" };
  const table = [
    ["Date", "", "Description", "Money In (€)", "Money Out (€)"],
    ["01/09/2026", "", "Corner Shop", "", "-71.35"],
  ];

  it("ignores a stale pin and finds the moved header", () => {
    const moved = [["Statement"], ["Period", "Sept"], ["Printed", "x"], ...table];
    expect(findHeaderRow(moved, { ...saved, headerRow: 0 })).toBe(3);
  });

  it("lets a valid pin win over an earlier row that also has the names", () => {
    const twice = [...table, ...table];
    expect(findHeaderRow(twice, { ...saved, headerRow: 2 })).toBe(2);
  });

  it("keeps a pin in range when nothing is mapped", () => {
    expect(findHeaderRow(table, { headerRow: 1 })).toBe(1);
  });
});

describe("commaDecimalSample", () => {
  const sample = (...cells: string[]) =>
    commaDecimalSample([["Date", "Description", "Amount"], ...cells.map((c) => ["01/09/2026", "Shop", c])], mapping());

  it("returns the first cell that uses a comma for decimals", () => {
    expect(sample("-71.35", "-12,50", "3,5")).toBe("-12,50");
    expect(sample("€1.234,56")).toBe("€1.234,56");
    expect(sample("(12,50)")).toBe("(12,50)");
  });

  it("leaves dot decimals, thousands separators and blanks alone", () => {
    expect(sample("1,234.56", "1,234", "-71.35", "", "  ")).toBeNull();
  });

  it("reads both columns of a two-column mapping, below the header only", () => {
    const grid = [["Amount", "Out", "x"], ["1.00", "-2,50", ""]];
    expect(commaDecimalSample(grid, mapping({ amount: "Amount", amountOut: "Out", date: "x", merchant: "x" }))).toBe("-2,50");
    expect(commaDecimalSample([["Amount,5"], ["1"]], mapping())).toBeNull();
  });
});

describe("missingColumns", () => {
  it("names each mapped column the header lacks", () => {
    expect(missingColumns(["Date", "Description", "Amount"], {
      date: "Completed Date", merchant: "Description", amount: "Amount", filter: { column: "State", value: "COMPLETED" },
    })).toEqual(["Completed Date", "State"]);
  });
});

describe("processRows beyond the Python", () => {
  const card = grid(
    "Type,Completed Date,Description,Amount,State\n"
    + "Card Payment,2026-09-01 12:34:19,Corner Shop,-6.55,COMPLETED\n"
    + "Card Payment,2026-09-02 08:00:00,Cafe One,-3.00,pending\n"
    + ",,,,\n"
    + "Topup,2026-09-03 09:00:00,Acme Payroll,100.00, completed \n",
  );

  it("filters on a column, ignoring case and spaces, and ignores blank rows", () => {
    const parsed = processRows(card, mapping({ date: "Completed Date", filter: { column: "State", value: "COMPLETED" } }));
    expect(parsed.rows.map((r) => [r.line, r.date, r.merchant, r.amountCents, r.type])).toEqual([
      [2, "2026-09-01", "Corner Shop", 655, "expense"],
      [5, "2026-09-03", "Acme Payroll", 10000, "income"],
    ]);
    expect(parsed.skipped.filtered).toEqual([3]);
    expect(parsed.header).toEqual(["Type", "Completed Date", "Description", "Amount", "State"]);
  });

  it("reads a bank export below its summary, spacer columns and all", () => {
    const parsed = processRows([
      ["  General Details"],
      ["Account name", "Current"],
      ["Date", "", "Description", "Money In (€)", "Money Out (€)", "", "Balance (€)"],
      ["01/09/2026", "", "Corner Shop", "", "-71.35", "", "100.00"],
      ["02/09/2026", "", "Acme Payroll", "250", "", "", "350.00"],
      ["", "spill-over text", "", "", "", "", ""],
    ], mapping({ amount: "Money In (€)", amountOut: "Money Out (€)" }));
    expect(parsed.headerRow).toBe(2);
    expect(parsed.header).toEqual(["Date", "Description", "Money In (€)", "Money Out (€)", "Balance (€)"]);
    expect(parsed.rows.map((r) => [r.merchant, r.amountCents, r.type])).toEqual([
      ["Corner Shop", 7135, "expense"], ["Acme Payroll", 25000, "income"],
    ]);
    expect(parsed.skipped.invalidDate).toEqual([6]);
  });

  it("reads month-first dates when asked", () => {
    const parsed = processRows(grid("Date,Description,Amount\n09/01/2026,Shop,-1.00\n"), mapping({ dateOrder: "mdy" }));
    expect(parsed.rows[0].date).toBe("2026-09-01");
  });

  it("treats a filter with a blank value as no filter", () => {
    const g = grid("Date,Description,Amount,State\n01/09/2026,Shop,-1.00,A\n02/09/2026,Cafe,-2.00,B\n");
    for (const value of ["", "   "]) {
      const parsed = processRows(g, mapping({ filter: { column: "State", value } }));
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.skipped.filtered).toEqual([]);
    }
  });

  it("returns nothing when no header is found or a mapped column is missing", () => {
    expect(processRows([["a"]], mapping()).rows).toEqual([]);
    expect(processRows(grid("Date,Description,Total\n01/09/2026,Shop,-1\n"), mapping()).rows).toEqual([]);
  });
});
