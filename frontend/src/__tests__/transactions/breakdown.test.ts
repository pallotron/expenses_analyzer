import { describe, expect, it } from "vitest";

import type { TransactionRow } from "../../lib/types";
import { categoryTotals, merchantTotals } from "../../transactions/breakdown";

let id = 0;
const row = (merchant: string, cents: number, category = "Groceries", type: "expense" | "income" = "expense", budget: "essential" | "discretionary" = "essential"): TransactionRow => ({
  id: ++id, date: "2026-09-10", merchant, merchantRaw: merchant.toUpperCase(), amountCents: cents, type, category,
  merchantCategory: category, categoryOverridden: false, budget, tags: "", source: "Card",
});

describe("merchantTotals", () => {
  it("adds up each merchant of the type, largest first", () => {
    const totals = merchantTotals([row("Shop A", 500), row("Shop B", 2000), row("Shop A", 700), row("Employer", 9000, "Salary", "income")], "expense");
    expect(totals).toEqual([
      { merchant: "Shop B", category: "Groceries", budget: "essential", amountCents: 2000, count: 1 },
      { merchant: "Shop A", category: "Groceries", budget: "essential", amountCents: 1200, count: 2 },
    ]);
  });

  it("names the category most of a merchant's money went to", () => {
    const [m] = merchantTotals([row("Market", 300), row("Market", 900, "Eating out", "expense", "discretionary"), row("Market", 400)], "expense");
    expect(m).toMatchObject({ category: "Eating out", budget: "discretionary", amountCents: 1600, count: 3 });
  });

  it("orders ties by name and is empty with no rows of the type", () => {
    expect(merchantTotals([row("B", 100), row("A", 100)], "expense").map((m) => m.merchant)).toEqual(["A", "B"]);
    expect(merchantTotals([row("A", 100)], "income")).toEqual([]);
  });
});

describe("categoryTotals", () => {
  it("adds up each category of the type, largest first", () => {
    const rows = [row("Shop A", 500), row("Cafe", 2000, "Eating out", "expense", "discretionary"), row("Shop B", 700), row("Employer", 9000, "Salary", "income")];
    expect(categoryTotals(rows, "expense")).toEqual([
      { category: "Eating out", budget: "discretionary", amountCents: 2000 },
      { category: "Groceries", budget: "essential", amountCents: 1200 },
    ]);
    expect(categoryTotals(rows, "income")).toEqual([{ category: "Salary", budget: "essential", amountCents: 9000 }]);
  });
});
