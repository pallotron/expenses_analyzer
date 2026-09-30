import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { netCashFlow } from "../../queries/analysis";
import { buildSummary, summaryPeriods } from "../../services/summary";
import { inMemoryCopy } from "../helpers/db";
import { summaryStore, vectorStore } from "../helpers/summaryStore";

describe("summaryPeriods", () => {
  it("lists years newest first with their months, and every source", async () => {
    const { db } = vectorStore();
    const periods = await summaryPeriods(db);
    expect(periods.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(periods.years[0].months).toEqual([1, 2, 3]);
    expect(periods.years[1].months).not.toContain(6); // the gap month
    expect(periods.sources).toEqual(["Bank A", "Card"]);
  });

  it("is empty for an empty store", async () => {
    const { db } = summaryStore([], []);
    expect(await summaryPeriods(db)).toEqual({ years: [], sources: [] });
  });
});

describe("buildSummary", () => {
  const { db, sqlite } = vectorStore();
  sqlite.exec(`
    INSERT INTO spending_type_budgets (spending_type, annual_budget_cents) VALUES ('essential', 2400000), ('discretionary', NULL);
    INSERT INTO tags (id, name) VALUES (1, 'emergency');
    INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency'), ('trip:*');
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 1 FROM transactions WHERE merchant_raw = 'Bookshop';
  `);

  it("builds a year view whose parts agree with each other", async () => {
    const s = await buildSummary(db, { year: 2026, month: null, includeHidden: false });
    expect(s.year).toBe(2026);
    expect(s.month).toBeNull();
    expect(s.spendingType.essentialCents + s.spendingType.discretionaryCents).toBe(s.cashFlow.expensesCents);
    expect(s.expenseCategories.reduce((a, c) => a + c.amountCents, 0)).toBe(s.cashFlow.expensesCents);
    expect(s.topIncome.reduce((a, c) => a + c.amountCents, 0)).toBe(s.cashFlow.incomeCents);
    expect(s.monthlyTotals).toHaveLength(12);
    expect(s.monthlyTotals!.reduce((a, m) => a + m.expensesCents, 0)).toBe(s.cashFlow.expensesCents);
    expect(s.monthly!.expense.total.totalCents).toBe(s.cashFlow.expensesCents);
    expect(s.spendingType.essentialBudgetCents).toBe(2_400_000);
    expect(s.spendingType.discretionaryBudgetCents).toBeNull();
  });

  it("orders categories by amount and labels spending type like the TUI", async () => {
    const s = await buildSummary(db, { year: 2026, month: null, includeHidden: false });
    const amounts = s.expenseCategories.map((c) => c.amountCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(s.expenseCategories.find((c) => c.category === "Rent")?.spendingType).toBe("essential");
    expect(s.expenseCategories.find((c) => c.category === "Other")).toBeUndefined(); // no 2026 Other spend
    expect(s.expenseCategories.find((c) => c.category === "Dining")?.spendingType).toBe("discretionary");
    expect(s.incomeCategories.every((c) => c.spendingType === null)).toBe(true);
    // Books has no spending type stored; the TUI counts it as discretionary.
    const all = await buildSummary(db, { year: 2026, month: null, includeHidden: true });
    expect(all.expenseCategories.find((c) => c.category === "Books")?.spendingType).toBe("discretionary");
  });

  it("hides excluded tags by default and reports what it hid", async () => {
    const hidden = await buildSummary(db, { year: 2026, month: 3, includeHidden: false });
    const shown = await buildSummary(db, { year: 2026, month: 3, includeHidden: true });
    expect(hidden.hiddenCents).toBe(5_000);
    expect(shown.cashFlow.expensesCents - hidden.cashFlow.expensesCents).toBe(5_000);
    // The hidden spend is in March only, so another month hides nothing.
    const february = await buildSummary(db, { year: 2026, month: 2, includeHidden: false });
    expect(february.hiddenCents).toBe(0);
    expect(hidden.excludedPatterns).toEqual(["emergency", "trip:*"]);
  });

  it("leaves year-only parts out of a month view", async () => {
    const s = await buildSummary(db, { year: 2026, month: 2, includeHidden: false });
    expect(s.month).toBe(2);
    expect(s.monthlyTotals).toBeNull();
    expect(s.monthly).toBeNull();
  });

  it("averages the twelve months before a month view, skipping months with no rows", async () => {
    const s = await buildSummary(db, { year: 2026, month: 2, includeHidden: false });
    // 2025-02 to 2026-01 is twelve calendar months, but June 2025 has no rows.
    expect(s.monthAverage).toEqual({ incomeCents: 409_091, expensesCents: 185_536, months: 11 });
  });

  it("has no month average in a year view, or for the first month on record", async () => {
    expect((await buildSummary(db, { year: 2026, month: null, includeHidden: false })).monthAverage).toBeNull();
    expect((await buildSummary(db, { year: 2025, month: 1, includeHidden: false })).monthAverage).toBeNull();
  });

  it("does not look further back than twelve months", async () => {
    // 2025-02 is thirteen months before 2026-03, so it is not in the average.
    const s = await buildSummary(db, { year: 2026, month: 3, includeHidden: false });
    expect(s.monthAverage).toEqual({ incomeCents: 409_091, expensesCents: 191_562, months: 11 });
  });

  it("averages only the selected sources", async () => {
    const s = await buildSummary(db, { year: 2026, month: 2, sources: ["Card"], includeHidden: false });
    expect(s.monthAverage).toEqual({ incomeCents: 0, expensesCents: 4_627, months: 11 });
  });

  it("returns zeros, not an error, for a source filter that matches nothing", async () => {
    const s = await buildSummary(db, { year: 2026, month: null, sources: [], includeHidden: false });
    expect(s.cashFlow).toEqual({ incomeCents: 0, expensesCents: 0 });
    expect(s.expenseCategories).toEqual([]);
    expect(s.monthly!.expense.rows).toEqual([]);
  });
});

describe.runIf(process.env.CROSSCHECK_DB)("buildSummary on real data", () => {
  // describe bodies run even when skipped, so open the copy only once it is wanted.
  let sqlite: Database.Database;
  let db: Db;
  beforeAll(() => {
    sqlite = inMemoryCopy(process.env.CROSSCHECK_DB!);
    db = drizzle(sqlite, { schema }) as unknown as Db;
  });
  afterAll(() => sqlite.close());

  it("each year's cash flow equals v_summary's", async () => {
    for (const row of await netCashFlow(db, "year")) {
      const s = await buildSummary(db, { year: Number(row.period), month: null, includeHidden: false });
      expect(s.cashFlow).toEqual({ incomeCents: row.incomeCents, expensesCents: row.expensesCents });
    }
  });
});
