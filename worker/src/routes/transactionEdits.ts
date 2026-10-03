/**
 * Writes to transactions: edit one, bulk edit, delete, restore, tag. Parse
 * with zod, call the service, answer with a count. Every 400 carries a
 * message the screen shows as is.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type {
  DeletedResponse, RestoredResponse, TaggedResponse, UpdatedResponse,
} from "../api/transactions";
import { normalizeTags } from "../domain/tags";
import {
  restoreTransactions, softDeleteTransactions, tagTransactions, UnknownCategoryError, updateTransactions,
} from "../services/transactions";
import { parseBody } from "./parseBody";

const MAX_IDS = 10_000;
const MAX_CENTS = 100_000_000;
const MIN_DATE = "1900-01-01";

function maxDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const isCalendarDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const text = (name: string) => z.string().trim().min(1, `${name} cannot be empty`);

const Ids = z.array(z.number().int("ids must be positive whole numbers").positive("ids must be positive whole numbers"))
  .min(1, "Choose at least one transaction")
  .max(MAX_IDS, "At most 10,000 transactions at once")
  .transform((ids) => [...new Set(ids)]);

const Category = z.string().trim().min(1, "Category cannot be empty").nullable().optional();
const Type = z.enum(["expense", "income"], "Type must be expense or income").optional();

const Edit = z.object({
  date: z.string()
    .refine(isCalendarDate, "Date must be a real day, YYYY-MM-DD")
    .refine((d) => d >= MIN_DATE && d <= maxDate(), { error: () => `Date must be between ${MIN_DATE} and ${maxDate()}` })
    .optional(),
  merchant: text("Statement text").optional(),
  amountCents: z.number()
    .int("Amount must be whole cents")
    .positive("Amount must be more than zero")
    .max(MAX_CENTS, "Amount must be at most €1,000,000.00")
    .optional(),
  type: Type,
  source: text("Source").optional(),
  category: Category,
}).strict().refine((e) => Object.keys(e).length > 0, "Nothing to change");

const BulkEdit = z.object({
  merchant: text("Statement text").optional(),
  type: Type,
  source: text("Source").optional(),
  category: Category,
}).strict().refine((e) => Object.keys(e).length > 0, "Nothing to change");

const IdsBody = z.object({ ids: Ids });
const BulkBody = z.object({ ids: Ids, edit: BulkEdit });
const TagBody = z.object({
  ids: Ids,
  tags: z.array(z.string()).transform(normalizeTags).refine((t) => t.length > 0, "Give at least one tag"),
  mode: z.enum(["add", "remove"], "mode must be add or remove"),
});

export function transactionEditRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.patch("/transactions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not a transaction id" }, 400);
    const body = await parseBody(c, Edit);
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const n = await updateTransactions(c.get("db"), [id], body.data, c.get("user").id, { liveOnly: true });
      if (n === 0) return c.json({ error: "This transaction no longer exists." }, 404);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof UnknownCategoryError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  routes.post("/transactions/bulk-edit", async (c) => {
    const body = await parseBody(c, BulkBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const updated = await updateTransactions(c.get("db"), body.data.ids, body.data.edit, c.get("user").id, { liveOnly: true });
      return c.json({ updated } satisfies UpdatedResponse);
    } catch (e) {
      if (e instanceof UnknownCategoryError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  routes.post("/transactions/delete", async (c) => {
    const body = await parseBody(c, IdsBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const ids = await softDeleteTransactions(c.get("db"), body.data.ids, c.get("user").id);
    return c.json({ deleted: ids.length, ids } satisfies DeletedResponse);
  });

  routes.post("/transactions/restore", async (c) => {
    const body = await parseBody(c, IdsBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const restored = await restoreTransactions(c.get("db"), body.data.ids, c.get("user").id);
    return c.json({ restored } satisfies RestoredResponse);
  });

  routes.post("/transactions/tags", async (c) => {
    const body = await parseBody(c, TagBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const { ids, tags, mode } = body.data;
    const tagged = await tagTransactions(c.get("db"), ids, tags, mode, c.get("user").id);
    return c.json({ tagged } satisfies TaggedResponse);
  });

  return routes;
}
