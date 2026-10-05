import { describe, expect, it } from "vitest";

import { buildSummary } from "../../services/summary";
import { listBudgetTypes, setCategoryType, setBudget } from "../../services/budgetTypes";
import { categorise, seed, store } from "../helpers/store";

function setup() {
  const s = store([]);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "Grocer", amount: 40, deleted: false },
    { date: "2026-03-02", merchant: "Grocer", amount: 30, deleted: false },
    { date: "2026-03-03", merchant: "Cinema", amount: 12, deleted: false },
    { date: "2026-03-04", merchant: "Cinema", amount: 12, deleted: true },
    { date: "2026-03-05", merchant: "Employer", amount: 2000, deleted: false },
  ], []);
  categorise(s.sqlite, { Grocer: "Groceries", Cinema: "Movies", Employer: "Salary" });
  s.sqlite.exec(`
    UPDATE transactions SET type = 'income' WHERE merchant_raw = 'Employer';
    UPDATE categories SET spending_type = 'essential' WHERE name = 'Groceries';
    INSERT INTO categories (name, spending_type) VALUES ('Unused', 'essential');
    INSERT INTO categories (name, is_archived) VALUES ('Old', 1);
  `);
  const typeOf = (name: string) =>
    (s.sqlite.prepare(`SELECT spending_type FROM categories WHERE name = ?`).get(name) as { spending_type: string | null })
      .spending_type;
  const budgets = () => s.sqlite.prepare(`SELECT * FROM spending_type_budgets ORDER BY spending_type`).all();
  return { ...s, typeOf, budgets };
}

describe("listBudgetTypes", () => {
  it("lists expense categories by name, untyped as discretionary, with live expense counts", async () => {
    const { db } = setup();
    expect(await listBudgetTypes(db)).toEqual({
      categories: [
        { name: "Groceries", spendingType: "essential", expenseCount: 2 },
        { name: "Movies", spendingType: "discretionary", expenseCount: 1 },
        { name: "Unused", spendingType: "essential", expenseCount: 0 },
      ],
      essentialBudgetCents: null,
      discretionaryBudgetCents: null,
    });
  });

  it("keeps a category that has both income and expense rows", async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`UPDATE merchants SET category_id = (SELECT id FROM categories WHERE name = 'Salary') WHERE canonical_name = 'Cinema'`);
    const names = (await listBudgetTypes(db)).categories.map((c) => c.name);
    expect(names).toEqual(["Groceries", "Movies", "Salary", "Unused"]);
  });

  it("keeps a typed category even when only income rows use it", async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`UPDATE categories SET spending_type = 'essential' WHERE name = 'Salary'`);
    expect((await listBudgetTypes(db)).categories.map((c) => c.name)).toContain("Salary");
  });

  it("returns the saved budgets", async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`INSERT INTO spending_type_budgets VALUES ('essential', 5300000), ('discretionary', NULL)`);
    const r = await listBudgetTypes(db);
    expect(r.essentialBudgetCents).toBe(5300000);
    expect(r.discretionaryBudgetCents).toBeNull();
  });
});

describe("setCategoryType", () => {
  it("sets the type and reports the category was found", async () => {
    const { db, typeOf } = setup();
    expect(await setCategoryType(db, "Movies", "essential")).toBe(true);
    expect(typeOf("Movies")).toBe("essential");
    expect(await setCategoryType(db, "Groceries", "discretionary")).toBe(true);
    expect(typeOf("Groceries")).toBe("discretionary");
  });

  it("reports an unknown or archived category and changes nothing", async () => {
    const { db, typeOf } = setup();
    expect(await setCategoryType(db, "Nope", "essential")).toBe(false);
    expect(await setCategoryType(db, "Old", "essential")).toBe(false);
    expect(typeOf("Old")).toBeNull();
  });

  it("moves the category's spend in the Summary split", async () => {
    const { db } = setup();
    const split = async () => (await buildSummary(db, { year: 2026, month: null, includeHidden: false })).spendingType;
    expect((await split()).essentialCents).toBe(7000);
    await setCategoryType(db, "Movies", "essential");
    expect(await split()).toMatchObject({ essentialCents: 8200, discretionaryCents: 0 });
  });
});

describe("setBudget", () => {
  it("creates, replaces and clears a budget", async () => {
    const { db, budgets } = setup();
    await setBudget(db, "essential", 5300000);
    expect(budgets()).toEqual([{ spending_type: "essential", annual_budget_cents: 5300000 }]);
    await setBudget(db, "essential", 100);
    await setBudget(db, "discretionary", 200);
    await setBudget(db, "essential", null);
    expect(budgets()).toEqual([
      { spending_type: "discretionary", annual_budget_cents: 200 },
      { spending_type: "essential", annual_budget_cents: null },
    ]);
  });
});
