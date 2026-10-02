/**
 * /api/transactions and /api/lookups. Parse, call the query, serialise.
 * The URL form is api/transactions.ts's toTransactionsSearch.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import type { TransactionsResponse } from "../api/transactions";
import { parseAmountFilter, type TransactionFilter } from "../domain/filters";
import { listLookups, listTransactions } from "../queries/transactions";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const Params = z.object({
  from: z.string().regex(ISO_DATE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(ISO_DATE, "to must be YYYY-MM-DD").optional(),
  merchant: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional(),
  min: z.string().regex(NUMBER, "min must be a number").optional(),
  max: z.string().regex(NUMBER, "max must be a number").optional(),
  type: z.enum(["expense", "income"], "type must be expense or income").optional(),
  budget: z.enum(["essential", "discretionary"], "budget must be essential or discretionary").optional(),
  excludeHidden: z.enum(["0", "1"], "excludeHidden must be 0 or 1").optional(),
});

const SINGLE_KEYS = Object.keys(Params.shape);

export function parseTransactionsQuery(url: URL):
  { ok: true; filter: TransactionFilter } | { ok: false; error: string } {
  // An empty box arrives as an empty value; it means "no filter".
  const single = Object.fromEntries(SINGLE_KEYS.flatMap((k) => {
    const v = url.searchParams.get(k);
    return v === null || v === "" ? [] : [[k, v]];
  }));
  const parsed = Params.safeParse(single);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = parsed.data;
  // Repeated parameter; absent means every source, one empty value means none.
  const raw = url.searchParams.getAll("sources");
  const filter: TransactionFilter = {
    ...(p.from && { dateFrom: p.from }),
    ...(p.to && { dateTo: p.to }),
    ...(p.merchant && { merchant: p.merchant }),
    ...(p.category && { category: p.category }),
    ...(p.tags && { tags: p.tags }),
    ...(p.min && { amountMinCents: parseAmountFilter(p.min) }),
    ...(p.max && { amountMaxCents: parseAmountFilter(p.max) }),
    ...(p.type && { type: p.type }),
    ...(p.budget && { budget: p.budget }),
    ...(raw.length > 0 && { sources: raw.filter((s) => s !== "") }),
    excludeHidden: p.excludeHidden === "1",
  };
  return { ok: true, filter };
}

export function transactionRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/transactions", async (c) => {
    const parsed = parseTransactionsQuery(new URL(c.req.url));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const list = await listTransactions(c.get("db"), parsed.filter);
    const body: TransactionsResponse = {
      rows: list.rows, count: list.rows.length, incomeCents: list.incomeCents, expensesCents: list.expensesCents,
    };
    return c.json(body);
  });

  routes.get("/lookups", async (c) => c.json(await listLookups(c.get("db"))));

  return routes;
}
