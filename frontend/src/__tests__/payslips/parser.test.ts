import { describe, it, expect } from "vitest";
import {
  extractAmounts,
  monthFromFilename,
  parseLines,
} from "../../payslips/parser";

/**
 * Euro string -> cents, so expectations read like the payslip does. Written
 * independently of the parser's own conversion so a bug there cannot cancel
 * itself out in the assertions.
 */
function c(euros: string): number {
  const negative = euros.startsWith("-");
  const [whole, fraction = "0"] = (negative ? euros.slice(1) : euros).split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -value : value;
}

// Synthetic lines mirroring the verified Irish payslip layout (no real data).
const JULY_LINES = [
  "Salary 13458.33",
  "Device Reimbursement 40.00",
  "Bonus 2614.00",
  "On-Call 396.00",
  "Notional Pay/Bik",
  "BIK Medical 384.44",
  "BIK Dental 56.25",
  "USC on 112658.19 1025.14 6697.18 0.00 0.00",
  "AVC 269.17 1884.18 0.00 0.00",
  "Pension 1076.67 7536.68 1076.67 7536.68",
  "PAYE 5163.77 33752.41",
  "PRSI 711.85 4731.59 1906.76 12674.01",
  "Pension monies from previous period(s) have been remitted",
];

// Same payroll template, as emitted by a different provider: uppercase labels,
// an employer-only pension, misc deductions, and a non-taxable adjustment.
const UPPERCASE_LINES = [
  "SALARY 3000.00",
  "HEALTH INSURANCE SUB 300.00",
  "Notional Pay/Bik",
  "SMALL BEN EXEMPTION 1500.00",
  "WORKING FROM HOME SUB 400.00",
  "USC on 45000.00 60.00 900.00 0.00 0.00",
  "PENSION ER 0.00 0.00 220.00 2640.00",
  "SPORTS CLUB 5.00 60.00 0.00 0.00",
  "GROUP HEALTH PLAN 300.00 1800.00 0.00 0.00",
  "PAYE 500.00 7000.00",
  "PRSI 140.00 1800.00 380.00 5000.00",
];

describe("extractAmounts", () => {
  it("parses two-decimal numbers into cents", () => {
    expect(extractAmounts("Pension 1076.67 7536.68 1076.67 7536.68")).toEqual([
      c("1076.67"),
      c("7536.68"),
      c("1076.67"),
      c("7536.68"),
    ]);
    expect(extractAmounts("PRSI Code")).toEqual([]);
  });

  it("strips thousands separators and keeps the sign", () => {
    expect(extractAmounts("Salary 13,458.33")).toEqual([c("13458.33")]);
    expect(extractAmounts("UNPAID LEAVE -730.77")).toEqual([c("-730.77")]);
  });

  it("converts exactly, where a float round-trip would drift", () => {
    // 1.005 * 100 is 100.4999... in binary float; cents parsed from the string
    // are exact. Summing a column of these is where the drift used to show up.
    expect(extractAmounts("A 1.005")).toEqual([100]);
    expect(extractAmounts("A 0.10 B 0.20")).toEqual([10, 20]);
    const [a, b] = extractAmounts("A 0.10 B 0.20");
    expect(a + b).toBe(30);
  });
});

describe("parseLines", () => {
  it("extracts the core fields", () => {
    const run = parseLines(JULY_LINES, "2026-07", "2026-07.pdf");
    expect(run).not.toBeNull();
    expect(run!.salary).toBe(c("13458.33"));
    expect(run!.bonus).toBe(c("2614.00"));
    expect(run!.oncall).toBe(c("396.00"));
    expect(run!.reimbursements).toBe(c("40.00"));
    expect(run!.pensionEe).toBe(c("1076.67"));
    expect(run!.avc).toBe(c("269.17"));
    expect(run!.pensionEr).toBe(c("1076.67"));
    expect(run!.paye).toBe(c("5163.77"));
    expect(run!.prsiEe).toBe(c("711.85"));
    expect(run!.usc).toBe(c("1025.14"));
    expect(run!.pensionEeYtd).toBe(c("7536.68"));
    expect(run!.avcYtd).toBe(c("1884.18"));
    expect(run!.pensionErYtd).toBe(c("7536.68"));
  });

  it("derives gross and net", () => {
    const run = parseLines(JULY_LINES, "2026-07", "2026-07.pdf")!;
    // Gross = cash earnings, excludes notional BIK.
    expect(run.gross).toBe(c("16508.33"));
    expect(run.taxTotal).toBe(c("6900.76")); // PAYE + PRSI_ee + USC
    expect(run.dedsFromGross).toBe(c("1345.84")); // PensionEE + AVC
    expect(run.net).toBe(c("8261.73")); // gross - deds - tax
  });

  it("returns null for an unrecognised format", () => {
    expect(
      parseLines(["Total Pay 1000.00", "Deductions 200.00"], "2026-07", "x.pdf"),
    ).toBeNull();
  });

  it("handles uppercase labels", () => {
    const run = parseLines(UPPERCASE_LINES, "2025-12", "2025-12.pdf");
    expect(run).not.toBeNull();
    expect(run!.salary).toBe(c("3000.00"));
    expect(run!.pensionEr).toBe(c("220.00"));
    expect(run!.pensionEe).toBe(c("0.00"));
    expect(run!.usc).toBe(c("60.00"));
    expect(run!.paye).toBe(c("500.00"));
    expect(run!.prsiEe).toBe(c("140.00"));
  });

  it("separates gross from notional and non-taxable pay", () => {
    const run = parseLines(UPPERCASE_LINES, "2025-12", "2025-12.pdf")!;
    // A taxable subsidy counts toward gross; notional BIK never does.
    expect(run.gross).toBe(c("3300.00"));
    expect(run.nonTaxableAdj).toBe(c("400.00"));
    // Both unrecognised 4-amount lines are treated as misc deductions.
    expect(run.miscDeductions).toBe(c("305.00"));
    expect(run.net).toBe(c("3300.00") - c("700.00") - c("305.00") + c("400.00"));
  });

  it("splits a line carrying two labels", () => {
    // Text extraction sometimes runs two items onto one line; each must keep
    // its own amounts rather than the first label swallowing all of them.
    const run = parseLines(
      [
        ...UPPERCASE_LINES.slice(0, 5),
        "BACKPAY 650.00 USC on 27000.00 86.66 565.48 0.00 0.00",
        ...UPPERCASE_LINES.slice(6),
      ],
      "2025-07",
      "2025-07.pdf",
    );
    expect(run).not.toBeNull();
    expect(run!.salary).toBe(c("3650.00"));
    expect(run!.usc).toBe(c("86.66"));
  });

  it("counts earnings under provider-specific labels", () => {
    const run = parseLines(
      [
        "Salary 10200.00",
        "Sign On Bonus 15000.00",
        "Retro Pay 916.67",
        "Device Reimbursement 2.00",
        "Device Reimb(tax free) 38.00",
        "USC on 25202.00 1686.48 1686.48 0.00 0.00",
        "AVC 204.00 204.00 0.00 0.00",
        "Pension 816.00 816.00 816.00 816.00",
        "PAYE 9049.47 9049.47",
        "PRSI 1033.28 1033.28 2810.02 2810.02",
      ],
      "2025-09",
      "2025-09.pdf",
    );
    expect(run).not.toBeNull();
    expect(run!.bonus).toBe(c("15000.00"));
    expect(run!.salary).toBe(c("10200.00") + c("916.67"));
    expect(run!.reimbursements).toBe(c("2.00"));
    expect(run!.nonTaxableAdj).toBe(c("38.00"));
  });

  it("subtracts a negative salary adjustment", () => {
    // Unpaid leave reduces salary and is signed negative on the payslip.
    const run = parseLines(
      ["SALARY 3166.67", "UNPAID LEAVE -730.77", ...UPPERCASE_LINES.slice(5)],
      "2026-04",
      "2026-04.pdf",
    );
    expect(run).not.toBeNull();
    expect(run!.salary).toBe(c("3166.67") - c("730.77"));
    expect(run!.gross).toBe(c("2435.90"));
  });

  it("accepts a supplementary run with no salary line", () => {
    // An off-cycle on-call payment has no salary line but is still a real run.
    const run = parseLines(
      [
        "On-Call 468.75",
        "USC on 14650.17 37.50 841.23 0.00 0.00",
        "AVC 0.00 260.00 0.00 0.00",
        "Pension 0.00 1040.00 0.00 1040.00",
        "PAYE 187.50 4262.56",
        "PRSI 19.69 615.30 52.74 1648.14",
      ],
      "2026-01",
      "2026-01-oncall.pdf",
    );
    expect(run).not.toBeNull();
    expect(run!.salary).toBe(0);
    expect(run!.oncall).toBe(c("468.75"));
    expect(run!.net).toBe(c("224.06"));
  });

  it("carries month and source file through", () => {
    const run = parseLines(JULY_LINES, "2026-07", "2026-07.pdf")!;
    expect(run.month).toBe("2026-07");
    expect(run.sourceFile).toBe("2026-07.pdf");
  });
});

describe("netReconciled", () => {
  it("flags a label the parser does not know", () => {
    // The summary block is bare amounts terminated by the label block; its
    // last entry is net. Here it disagrees with what the line items add up to.
    const run = parseLines(
      [...JULY_LINES, "16508.33", "1345.84", "6900.76", "0.00", "9999.99", "NOTE"],
      "2026-07",
      "2026-07.pdf",
    )!;
    expect(run.statedNet).toBe(c("9999.99"));
    expect(run.netReconciled).toBe(false);
  });

  it("accepts a matching stated net", () => {
    const run = parseLines(
      [...JULY_LINES, "8261.73", "NOTE"],
      "2026-07",
      "2026-07.pdf",
    )!;
    expect(run.netReconciled).toBe(true);
  });

  it("is true when the payslip states no net", () => {
    const run = parseLines(JULY_LINES, "2026-07", "2026-07.pdf")!;
    expect(run.statedNet).toBeNull();
    expect(run.netReconciled).toBe(true);
  });
});

describe("monthFromFilename", () => {
  it.each([
    ["2026-07.pdf", "2026-07"],
    ["2026-01-oncall.pdf", "2026-01"],
    ["payslip-2025-11-final.pdf", "2025-11"],
    ["/some/path/2026-03.pdf", "2026-03"],
    ["notes.pdf", null],
    ["2026-13.pdf", null],
    ["1834-05.pdf", null],
  ])("reads %s as %s", (name, expected) => {
    expect(monthFromFilename(name)).toBe(expected);
  });
});
