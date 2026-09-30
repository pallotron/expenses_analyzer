import type { Grid, PeriodsResponse, SummaryResponse } from "../../lib/types";

export const periods: PeriodsResponse = {
  years: [{ year: 2026, months: [1, 2, 3] }, { year: 2025, months: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] }],
  sources: ["Bank A", "Card"],
};

const emptyGrid: Grid = { rows: [], total: { category: "Total", months: Array.from({ length: 12 }, () => ({ amountCents: 0, anomaly: false })), totalCents: 0 } };

export function summary(overrides: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    year: 2026,
    month: null,
    cashFlow: { incomeCents: 6_140_000, expensesCents: 3_895_000 },
    spendingType: { essentialCents: 2_410_000, discretionaryCents: 1_485_000, essentialBudgetCents: 3_400_000, discretionaryBudgetCents: null },
    expenseCategories: [
      { category: "Groceries", spendingType: "essential", amountCents: 742_000 },
      { category: "Eating out", spendingType: "discretionary", amountCents: 311_000 },
    ],
    incomeCategories: [{ category: "Salary", spendingType: null, amountCents: 5_820_000 }],
    topMerchants: Array.from({ length: 12 }, (_, i) => ({
      merchant: `Shop ${i + 1}`, category: "Groceries", spendingType: "essential" as const, amountCents: 100_000 - i * 1_000, txnCount: 3,
    })),
    topIncome: [{ merchant: "Employer", category: "Salary", spendingType: null, amountCents: 5_820_000, txnCount: 9 }],
    monthlyTotals: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, incomeCents: i < 9 ? 680_000 : 0, expensesCents: i < 9 ? 430_000 : 0 })),
    monthly: {
      expense: {
        rows: [{ category: "Groceries", totalCents: 742_000, months: Array.from({ length: 12 }, (_, i) => ({ amountCents: i < 9 ? 82_444 : 0, anomaly: i === 2 })) }],
        total: { category: "Total", totalCents: 742_000, months: Array.from({ length: 12 }, (_, i) => ({ amountCents: i < 9 ? 82_444 : 0, anomaly: false })) },
      },
      income: emptyGrid,
    },
    hiddenCents: 124_000,
    excludedPatterns: ["emergency"],
    ...overrides,
  };
}

/** A fetch that answers the two Summary endpoints and records what was asked. */
export function mockApi(opts: { periods?: PeriodsResponse; summary?: (url: URL) => SummaryResponse; status?: number } = {}) {
  const calls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(url);
    if (opts.status) return new Response(JSON.stringify({ error: "boom" }), { status: opts.status });
    const body = url.pathname === "/api/summary/periods"
      ? (opts.periods ?? periods)
      : (opts.summary ?? (() => summary()))(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}
