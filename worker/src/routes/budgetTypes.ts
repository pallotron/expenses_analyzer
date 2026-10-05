/**
 * /api/budget-types: each category's essential/discretionary type and the
 * annual budget per type. Parse with zod, call the service, serialise.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import { MAX_BUDGET_CENTS, type BudgetTypesResponse } from "../api/budgetTypes";
import { listBudgetTypes, setBudget, setCategoryType } from "../services/budgetTypes";
import { parseBody } from "./parseBody";

const Kind = z.enum(["essential", "discretionary"], "spendingType must be essential or discretionary");

const CategoryType = z.object({
  name: z.string("name must be text").min(1, "Choose a category"),
  spendingType: Kind,
}).strict();

const Budget = z.object({
  spendingType: Kind,
  annualBudgetCents: z.number("annualBudgetCents must be a number or null")
    .int("A budget must be whole cents")
    .min(0, "A budget can't be negative")
    .max(MAX_BUDGET_CENTS, "A budget can be at most 10,000,000")
    .nullable(),
}).strict();

export function budgetTypeRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/budget-types", async (c) =>
    c.json((await listBudgetTypes(c.get("db"))) satisfies BudgetTypesResponse));

  routes.post("/budget-types/category", async (c) => {
    const body = await parseBody(c, CategoryType);
    if (!body.ok) return c.json({ error: body.error }, 400);
    if (!(await setCategoryType(c.get("db"), body.data.name, body.data.spendingType))) {
      return c.json({ error: `There is no category called "${body.data.name}".` }, 404);
    }
    return c.json({ ok: true });
  });

  routes.post("/budget-types/budget", async (c) => {
    const body = await parseBody(c, Budget);
    if (!body.ok) return c.json({ error: body.error }, 400);
    await setBudget(c.get("db"), body.data.spendingType, body.data.annualBudgetCents);
    return c.json({ ok: true });
  });

  return routes;
}
