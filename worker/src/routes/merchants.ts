/**
 * The merchant editor and the Merchants page: list, rule lookup, preview, the
 * writes, and Gemini suggestions. Parse with zod, call the service, answer with counts. Every 400
 * carries a message the screen shows as is.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type {
  AskResponse, CategoryChangesResponse, ConfirmResponse, DecisionResponse, MerchantCategoryResponse, MerchantsResponse,
  RuleDeletedResponse, SuggestResponse,
} from "../api/merchants";
import { GeminiResponseError } from "../domain/gemini";
import { listMerchants, ruleFor } from "../queries/merchants";
import { applyCategories, askCategories, confirmSuggestions, suggestCategories } from "../services/categorize";
import { DEFAULT_GEMINI_MODEL, GeminiCallError, geminiClient, type GenerateText } from "../services/gemini";
import {
  deleteMerchantRule, previewAliasChange, saveMerchantDecision, setMerchantCategory, UnknownRuleError,
} from "../services/merchants";
import { parseBody } from "./parseBody";

const PATTERN_TOO_LONG = "Patterns can be at most 500 characters";

const Decision = z.object({
  // Kept as typed: a trailing space is part of the match.
  pattern: z.string().max(500, PATTERN_TOO_LONG).refine((p) => p.trim() !== "", "Enter a pattern"),
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

const ConfirmBody = z.object({
  ids: z.array(z.number().int().positive("ids must be positive whole numbers"))
    .min(1, "Choose at least one merchant").max(10_000, "At most 10,000 merchants at once"),
}).strict();

const AskBody = z.object({
  ids: z.array(z.number().int().positive("ids must be positive whole numbers"))
    .min(1, "Choose at least one merchant").max(1_000, "Ask about at most 1,000 merchants at once"),
}).strict();

const ChangesBody = z.object({
  changes: z.array(z.object({
    id: z.number().int().positive("ids must be positive whole numbers"),
    category: z.string().trim().min(1, "Category cannot be empty"),
  }).strict()).min(1, "Choose at least one change").max(10_000, "At most 10,000 merchants at once"),
}).strict();

/**
 * Run `work` with a Gemini client, turning Gemini's failures into the short
 * messages the page shows. 503 when no key is configured.
 */
async function withGemini<B extends AppBindings>(
  c: Context<AppEnv<B>>, work: (generate: GenerateText) => Promise<object>,
) {
  const key = c.env.GEMINI_API_KEY;
  if (!key) return c.json({ error: "Gemini isn't set up" }, 503);
  try {
    return c.json(await work(geminiClient(key, c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL)));
  } catch (e) {
    if (e instanceof GeminiCallError) {
      return c.json({ error: e.status === null ? "Gemini didn't answer" : `Gemini didn't answer (HTTP ${e.status})` }, 502);
    }
    if (e instanceof GeminiResponseError) return c.json({ error: "Gemini's answer couldn't be read" }, 502);
    throw e;
  }
}

export function merchantRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/merchants", async (c) =>
    c.json({ merchants: await listMerchants(c.get("db")) } satisfies MerchantsResponse));

  routes.get("/merchants/rule", async (c) => {
    const raw = c.req.query("raw") ?? "";
    if (!raw.trim()) return c.json({ error: "Give the statement text" }, 400);
    return c.json(await ruleFor(c.get("db"), raw));
  });

  routes.get("/merchants/preview", async (c) => {
    const pattern = c.req.query("pattern") ?? "";
    if (pattern.length > 500) return c.json({ error: PATTERN_TOO_LONG }, 400);
    return c.json(await previewAliasChange(c.get("db"), pattern, c.req.query("alias") ?? ""));
  });

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

  routes.post("/merchants/suggest", (c) => withGemini(c, async (generate) =>
    (await suggestCategories(c.get("db"), generate, c.get("user").id)) satisfies SuggestResponse));

  routes.post("/merchants/ask", async (c) => {
    const body = await parseBody(c, AskBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return withGemini(c, async (generate) =>
      (await askCategories(c.get("db"), generate, body.data.ids)) satisfies AskResponse);
  });

  routes.post("/merchants/categories", async (c) => {
    const body = await parseBody(c, ChangesBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return c.json(await applyCategories(c.get("db"), body.data.changes, c.get("user").id) satisfies CategoryChangesResponse);
  });

  routes.post("/merchants/confirm", async (c) => {
    const body = await parseBody(c, ConfirmBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return c.json(await confirmSuggestions(c.get("db"), body.data.ids, c.get("user").id) satisfies ConfirmResponse);
  });

  return routes;
}
