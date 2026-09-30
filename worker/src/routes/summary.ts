/**
 * /api/summary and /api/summary/periods. Parse, call the service, serialise.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { AppBindings, AppEnv } from "../app";
import { buildSummary, summaryPeriods, type SummaryQuery } from "../services/summary";

const Params = z.object({
  year: z.string().regex(/^\d{4}$/, "year must be four digits").transform(Number),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/, "month must be 1–12").transform(Number).optional(),
  hidden: z.enum(["0", "1"], "hidden must be 0 or 1").optional(),
});

/**
 * `sources` is a repeated parameter, so a name may contain commas. Absent
 * means every source; a single empty value means none.
 */
export function parseSummaryQuery(url: URL): { ok: true; query: SummaryQuery } | { ok: false; error: string } {
  const single = Object.fromEntries(["year", "month", "hidden"].flatMap((k) => {
    const v = url.searchParams.get(k);
    return v === null ? [] : [[k, v]];
  }));
  const parsed = Params.safeParse(single);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A missing year is the only invalid_type case (every value is a string);
    // Zod's own message for it is generic, so say what is wrong.
    return { ok: false, error: issue.code === "invalid_type" ? `${String(issue.path[0])} is required` : issue.message };
  }
  const raw = url.searchParams.getAll("sources");
  const sources = raw.length === 0 ? undefined : raw.filter((s) => s !== "");
  return {
    ok: true,
    query: {
      year: parsed.data.year,
      month: parsed.data.month ?? null,
      sources,
      includeHidden: parsed.data.hidden === "1",
    },
  };
}

export function summaryRoutes<B extends AppBindings>() {
  const routes = new Hono<AppEnv<B>>();

  routes.get("/periods", async (c) => c.json(await summaryPeriods(c.get("db"))));

  routes.get("/", async (c) => {
    const parsed = parseSummaryQuery(new URL(c.req.url));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(await buildSummary(c.get("db"), parsed.query));
  });

  return routes;
}
