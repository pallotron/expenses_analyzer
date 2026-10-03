/**
 * The merchant editor and the Merchants page: list, rule lookup, preview, and
 * the writes. Parse with zod, call the service, answer with counts. Every 400
 * carries a message the screen shows as is.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type {
  DecisionResponse, MerchantCategoryResponse, MerchantsResponse, RuleDeletedResponse,
} from "../api/merchants";
import { listMerchants, ruleFor } from "../queries/merchants";
import {
  deleteMerchantRule, previewAliasChange, saveMerchantDecision, setMerchantCategory, UnknownRuleError,
} from "../services/merchants";
import { parseBody } from "./parseBody";

const Decision = z.object({
  pattern: z.string().trim().min(1, "Enter a pattern"),
  alias: z.string().trim().min(1, "Enter a display name"),
  category: z.string().trim().min(1, "Category cannot be empty").optional(),
  tags: z.array(z.string()).optional(),
}).strict().superRefine((d, ctx) => {
  try { new RegExp(d.pattern, "i"); } catch (e) {
    ctx.addIssue({ code: "custom", message: `Invalid pattern: ${e instanceof Error ? e.message : String(e)}` });
  }
});

const CategoryBody = z.object({
  ids: z.array(z.number().int().positive("ids must be positive whole numbers"))
    .min(1, "Choose at least one merchant").max(10_000, "At most 10,000 merchants at once"),
  category: z.string().trim().min(1, "Category cannot be empty").nullable(),
}).strict();

export function merchantRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/merchants", async (c) =>
    c.json({ merchants: await listMerchants(c.get("db")) } satisfies MerchantsResponse));

  routes.get("/merchants/rule", async (c) => {
    const raw = c.req.query("raw") ?? "";
    if (!raw.trim()) return c.json({ error: "Give the statement text" }, 400);
    return c.json(await ruleFor(c.get("db"), raw));
  });

  routes.get("/merchants/preview", async (c) =>
    c.json(await previewAliasChange(c.get("db"), c.req.query("pattern") ?? "", c.req.query("alias") ?? "")));

  routes.post("/merchants/decision", async (c) => {
    const body = await parseBody(c, Decision);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const result = await saveMerchantDecision(c.get("db"), body.data, c.get("user").id);
    return c.json(result satisfies DecisionResponse);
  });

  routes.post("/merchants/rules/:id/delete", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not a rule id" }, 400);
    try {
      return c.json(await deleteMerchantRule(c.get("db"), id, c.get("user").id) satisfies RuleDeletedResponse);
    } catch (e) {
      if (e instanceof UnknownRuleError) return c.json({ error: "This rule no longer exists." }, 404);
      throw e;
    }
  });

  routes.post("/merchants/category", async (c) => {
    const body = await parseBody(c, CategoryBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const result = await setMerchantCategory(c.get("db"), body.data.ids, body.data.category, c.get("user").id);
    return c.json(result satisfies MerchantCategoryResponse);
  });

  return routes;
}
