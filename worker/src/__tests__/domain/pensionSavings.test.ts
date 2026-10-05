import { describe, expect, it } from "vitest";

import { coverageLabel, pensionSavings, type BankMonth, type PensionMonth } from "../../domain/pensionSavings";
import rawVectors from "../fixtures/python_vectors.json";

interface Expected {
  pensionCents: number; savedCents: number; incomeCents: number; rate: number;
  months: number[]; coverageLabel: string; reconciled: boolean;
}
const vectors = rawVectors as unknown as {
  payslips: {
    savings: {
      transactions: [string, number, "income" | "expense"][];
      payslips: [string, number, number, number, boolean][];
      cases: { year: number; month: number | null; expected: Expected | null }[];
    };
    coverageLabels: [number[], string][];
  };
};

/** The bank side as the Worker gets it: a row per month that has transactions. */
function bankMonths(rows: [string, number, string][]): BankMonth[] {
  const byMonth = new Map<string, BankMonth>();
  for (const [date, cents, type] of rows) {
    const month = date.slice(0, 7);
    const m = byMonth.get(month) ?? { month, incomeCents: 0, expensesCents: 0 };
    if (type === "income") m.incomeCents += cents; else m.expensesCents += cents;
    byMonth.set(month, m);
  }
  return [...byMonth.values()];
}

const { savings } = vectors.payslips;
const bank = bankMonths(savings.transactions);
const payslips: PensionMonth[] = savings.payslips.map(([month, ee, avc, er, ok]) =>
  ({ month, pensionEeCents: ee, avcCents: avc, pensionErCents: er, ytdReconciled: ok }));

describe("pensionSavings matches the Python's get_enhanced_savings_totals", () => {
  it.each(savings.cases.map((c) => [`${c.year}/${c.month ?? "year"}`, c] as const))("%s", (_label, c) => {
    const got = pensionSavings(bank, payslips, c.year, c.month);
    if (c.expected === null) {
      expect(got).toBeNull();
      return;
    }
    const { rate, ...rest } = c.expected;
    expect(got).toMatchObject(rest);
    expect(got!.rate).toBeCloseTo(rate, 9);
  });
});

describe("coverageLabel matches the Python's _coverage_label", () => {
  it.each(vectors.payslips.coverageLabels)("%j -> %j", (months, label) => {
    expect(coverageLabel(months)).toBe(label);
  });
});

describe("pensionSavings beyond the Python", () => {
  const month = (m: string, ok: boolean | null): PensionMonth =>
    ({ month: m, pensionEeCents: 100, avcCents: 0, pensionErCents: 100, ytdReconciled: ok });

  it("does not warn for a month whose check is unknown", () => {
    const got = pensionSavings([{ month: "2026-01", incomeCents: 1000, expensesCents: 0 }], [month("2026-01", null)], 2026, null);
    expect(got?.reconciled).toBe(true);
  });

  it("sums two people's pension for the same month", () => {
    const got = pensionSavings([{ month: "2026-01", incomeCents: 1000, expensesCents: 400 }],
      [month("2026-01", true), month("2026-01", true)], 2026, null);
    expect(got).toMatchObject({ pensionCents: 400, savedCents: 1000, incomeCents: 1400, months: [1] });
  });

  it("gives a zero rate when there is no income at all", () => {
    const got = pensionSavings([{ month: "2026-01", incomeCents: 0, expensesCents: 500 }],
      [{ ...month("2026-01", true), pensionEeCents: 0, pensionErCents: 0 }], 2026, null);
    expect(got?.rate).toBe(0);
  });
});
