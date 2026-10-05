import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import { store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup() {
  const s = store([]);
  s.sqlite.exec(`
    INSERT INTO categories (name, spending_type) VALUES ('Groceries', 'essential'), ('Movies', NULL);
    INSERT INTO spending_type_budgets VALUES ('essential', 5300000);
  `);
  const app = createApp(() => s.db);
  const post = (path: string, body: unknown, origin = "http://localhost") =>
    app.request(`http://localhost/api/budget-types${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    }, env);
  const get = () => app.request("http://localhost/api/budget-types", {}, env);
  const types = () => s.sqlite.prepare(`SELECT name, spending_type FROM categories ORDER BY name`).all();
  const budgets = () => s.sqlite.prepare(`SELECT * FROM spending_type_budgets ORDER BY spending_type`).all();
  return { post, get, types, budgets };
}

describe("GET /api/budget-types", () => {
  it("answers the categories and budgets", async () => {
    const res = await setup().get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categories: [
        { name: "Groceries", spendingType: "essential", expenseCount: 0 },
        { name: "Movies", spendingType: "discretionary", expenseCount: 0 },
      ],
      essentialBudgetCents: 5300000,
      discretionaryBudgetCents: null,
    });
  });
});

describe("POST /api/budget-types/category", () => {
  it("sets a category's type", async () => {
    const { post, types } = setup();
    const res = await post("/category", { name: "Movies", spendingType: "essential" });
    expect(res.status).toBe(200);
    expect(types()).toEqual([
      { name: "Groceries", spending_type: "essential" },
      { name: "Movies", spending_type: "essential" },
    ]);
  });

  it("answers 404 for an unknown category", async () => {
    const { post, types } = setup();
    const res = await post("/category", { name: "Nope", spendingType: "essential" });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Nope");
    expect(types()).toHaveLength(2);
  });

  it.each([
    [{ name: "Movies", spendingType: "fun" }],
    [{ name: "", spendingType: "essential" }],
    [{ spendingType: "essential" }],
    [{ name: "Movies", spendingType: "essential", extra: 1 }],
  ])("refuses %j and changes nothing", async (body) => {
    const { post, types } = setup();
    const res = await post("/category", body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
    expect(types()).toEqual([
      { name: "Groceries", spending_type: "essential" },
      { name: "Movies", spending_type: null },
    ]);
  });

  it("refuses a write from another site", async () => {
    const { post } = setup();
    expect((await post("/category", { name: "Movies", spendingType: "essential" }, "https://evil.example")).status).toBe(403);
  });
});

describe("POST /api/budget-types/budget", () => {
  it("sets and clears a budget", async () => {
    const { post, budgets } = setup();
    expect((await post("/budget", { spendingType: "discretionary", annualBudgetCents: 3700000 })).status).toBe(200);
    expect((await post("/budget", { spendingType: "essential", annualBudgetCents: null })).status).toBe(200);
    expect(budgets()).toEqual([
      { spending_type: "discretionary", annual_budget_cents: 3700000 },
      { spending_type: "essential", annual_budget_cents: null },
    ]);
  });

  it.each([
    [{ spendingType: "essential", annualBudgetCents: -1 }],
    [{ spendingType: "essential", annualBudgetCents: 1.5 }],
    [{ spendingType: "essential", annualBudgetCents: 1_000_000_001 }],
    [{ spendingType: "essential", annualBudgetCents: "100" }],
    [{ spendingType: "essential" }],
    [{ spendingType: "both", annualBudgetCents: 1 }],
  ])("refuses %j and leaves the budgets alone", async (body) => {
    const { post, budgets } = setup();
    const res = await post("/budget", body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
    expect(budgets()).toEqual([{ spending_type: "essential", annual_budget_cents: 5300000 }]);
  });
});
