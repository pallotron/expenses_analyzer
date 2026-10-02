import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { LookupsResponse, TransactionsResponse } from "../../api/transactions";
import { parseTransactionsQuery } from "../../routes/transactions";
import { vectorStore } from "../helpers/summaryStore";

const { db } = vectorStore();
const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};
const get = (path: string) => createApp(() => db).request(`http://localhost${path}`, {}, env);

describe("parseTransactionsQuery", () => {
  const parse = (qs: string) => parseTransactionsQuery(new URL(`http://x/api/transactions?${qs}`));

  it("maps every parameter onto the filter", () => {
    expect(parse("from=2026-01-01&to=2026-01-31&merchant=tes&category=%22Groceries%22&tags=gift&min=1.5&max=20&type=expense&budget=essential&sources=Card&sources=Bank+A&excludeHidden=1"))
      .toEqual({ ok: true, filter: {
        dateFrom: "2026-01-01", dateTo: "2026-01-31", merchant: "tes", category: '"Groceries"', tags: "gift",
        amountMinCents: 150, amountMaxCents: 2000, type: "expense", budget: "essential",
        sources: ["Card", "Bank A"], excludeHidden: true,
      } });
  });

  it("treats empty values as unset, except sources where one empty value means none", () => {
    expect(parse("merchant=&from=&sources=")).toEqual({ ok: true, filter: { sources: [], excludeHidden: false } });
    expect(parse("")).toEqual({ ok: true, filter: { excludeHidden: false } });
  });

  it.each([
    ["from=2026-1-1", "from must be YYYY-MM-DD"],
    ["to=yesterday", "to must be YYYY-MM-DD"],
    ["min=ten", "min must be a number"],
    ["max=1e3", "max must be a number"],
    ["type=refund", "type must be expense or income"],
    ["budget=fun", "budget must be essential or discretionary"],
    ["excludeHidden=yes", "excludeHidden must be 0 or 1"],
  ])("rejects %s", (qs, error) => {
    expect(parse(qs)).toEqual({ ok: false, error });
  });
});

describe("GET /api/transactions", () => {
  it("lists rows with their count and totals", async () => {
    const res = await get("/api/transactions?type=expense&sources=Card");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json() as TransactionsResponse;
    expect(body.count).toBe(body.rows.length);
    expect(body.count).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.source === "Card" && r.type === "expense")).toBe(true);
    expect(body.incomeCents).toBe(0);
    expect(body.expensesCents).toBe(body.rows.reduce((a, r) => a + r.amountCents, 0));
  });

  it("answers a bad parameter with 400 and the message", async () => {
    const res = await get("/api/transactions?min=abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "min must be a number" });
  });
});

describe("GET /api/lookups", () => {
  it("returns the lookups", async () => {
    const body = await (await get("/api/lookups")).json() as LookupsResponse;
    expect(body.sources).toEqual(["Bank A", "Card"]);
  });
});
