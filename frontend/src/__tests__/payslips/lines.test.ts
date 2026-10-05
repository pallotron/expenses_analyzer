import { describe, expect, it } from "vitest";

import { groupItemsIntoLines } from "../../payslips/pdf";
import { parseLines } from "../../payslips/parser";

type Item = Parameters<typeof groupItemsIntoLines>[0][number];

const item = (str: string, x: number, y: number, hasEOL = false): Item =>
  ({ str, transform: [1, 0, 0, 1, x, y], hasEOL }) as unknown as Item;

describe("groupItemsIntoLines", () => {
  it("keeps columns written at different baselines as separate lines", () => {
    const lines = groupItemsIntoLines([
      item("PRSI", 10, 500),
      item("711.85", 100, 500),
      item("4731.59", 200, 500),
      item("Total Tax & PRSI", 10, 300),
      item("6900.76", 200, 300),
    ]);
    expect(lines).toEqual(["PRSI 711.85 4731.59", "Total Tax & PRSI 6900.76"]);
  });

  it("joins a label and its amounts on one baseline", () => {
    expect(
      groupItemsIntoLines([item("Salary", 10, 500), item("13458.33", 200, 500)]),
    ).toEqual(["Salary 13458.33"]);
  });

  it("ends a line at hasEOL even without a baseline change", () => {
    expect(
      groupItemsIntoLines([item("Bonus", 10, 500, true), item("2614.00", 200, 500)]),
    ).toEqual(["Bonus", "2614.00"]);
  });

  it("treats sub-pixel drift as one line and skips blank items", () => {
    expect(
      groupItemsIntoLines([
        item("Salary", 10, 500.0),
        item("   ", 50, 500.2),
        item("13458.33", 200, 500.4),
      ]),
    ).toEqual(["Salary 13458.33"]);
  });
});

describe("parseLines on stream-ordered lines", () => {
  it("reads PRSI and the stated net from the right lines", () => {
    const items = [
      item("Salary", 10, 700),
      item("5000.00", 200, 700),
      item("Pension", 10, 650),
      item("100.00", 100, 650),
      item("700.00", 150, 650),
      item("100.00", 200, 650),
      item("700.00", 250, 650),
      item("PAYE", 10, 600),
      item("800.00", 100, 600),
      item("5600.00", 200, 600),
      item("PRSI", 10, 550),
      item("200.00", 100, 550),
      item("1400.00", 150, 550),
      item("400.00", 200, 550),
      item("2800.00", 250, 550),
      item("Gross Pay", 10, 500),
      item("PRSI Code A1 +", 150, 500, true),
      // Streamed later, but sharing the baseline above: a page-wide baseline
      // grouping would fold this amount into the label line.
      item("5000.00", 300, 500),
      item("5000.00", 10, 450),
      item("1100.00", 10, 400),
      item("3900.00", 10, 350),
      item("NOTE", 10, 300),
    ];
    const run = parseLines(groupItemsIntoLines(items), "2026-01", "x.pdf");
    expect(run).not.toBeNull();
    expect(run!.prsiEe).toBe(20000);
    expect(run!.statedNet).toBe(390000);
  });
});
