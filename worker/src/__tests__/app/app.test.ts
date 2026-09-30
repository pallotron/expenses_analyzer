import { describe, expect, it, vi } from "vitest";

import { createApp, withCacheHeaders, type AppBindings } from "../../app";
import { vectorStore } from "../helpers/summaryStore";

const { db } = vectorStore();

function setup(email = "a@example.com") {
  const assets = vi.fn(async (req: Request) =>
    new Response(`asset ${new URL(req.url).pathname}`, { headers: { "content-type": "text/html" } }));
  const env: AppBindings = {
    CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    DEV_USER_EMAIL: email,
    ASSETS: { fetch: assets },
  };
  const app = createApp(() => db);
  const get = (path: string, host = "http://localhost") => app.request(`${host}${path}`, {}, env);
  return { get, assets };
}

describe("authentication", () => {
  it("refuses an unauthenticated request before serving anything, assets included", async () => {
    const { get, assets } = setup();
    const res = await get("/index.html", "https://expenses.example.com"); // not localhost: no dev user
    expect(res.status).toBe(401);
    expect(assets).not.toHaveBeenCalled();
  });

  it("refuses a logged-in email that is not a household user", async () => {
    const { get } = setup("stranger@example.com");
    expect((await get("/api/me")).status).toBe(403);
  });

  it("returns the user from /api/me", async () => {
    const { get } = setup();
    expect(await (await get("/api/me")).json()).toMatchObject({ email: "a@example.com" });
  });
});

describe("/api/summary", () => {
  it("lists periods", async () => {
    const body = await (await setup().get("/api/summary/periods")).json() as { years: { year: number }[] };
    expect(body.years[0].year).toBe(2026);
  });

  it("returns a year view", async () => {
    const res = await setup().get("/api/summary?year=2026");
    expect(res.status).toBe(200);
    const body = await res.json() as { month: null; monthly: unknown };
    expect(body.month).toBeNull();
    expect(body.monthly).not.toBeNull();
  });

  it("filters by repeated sources, including names with commas and quotes", async () => {
    const { get } = setup();
    const card = await (await get("/api/summary?year=2026&sources=Card")).json() as { cashFlow: { incomeCents: number } };
    expect(card.cashFlow.incomeCents).toBe(0);
    const odd = await get("/api/summary?year=2026&sources=" + encodeURIComponent("O'Brien, Ltd"));
    expect(odd.status).toBe(200);
    const none = await (await get("/api/summary?year=2026&sources=")).json() as { cashFlow: { expensesCents: number } };
    expect(none.cashFlow.expensesCents).toBe(0);
  });

  it.each([
    ["missing year", "/api/summary"],
    ["bad year", "/api/summary?year=26"],
    ["month 13", "/api/summary?year=2026&month=13"],
    ["month 0", "/api/summary?year=2026&month=0"],
    ["bad hidden", "/api/summary?year=2026&hidden=yes"],
  ])("rejects %s with a 400 and a message", async (_name, path) => {
    const res = await setup().get(path);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("routing", () => {
  it("answers an unknown API path with a JSON 404, not the app", async () => {
    const { get, assets } = setup();
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(assets).not.toHaveBeenCalled();
  });

  it("serves anything else from the assets, with the right caching", async () => {
    const { get } = setup();
    const page = await get("/some/client/route");
    expect(await page.text()).toBe("asset /some/client/route");
    expect(page.headers.get("cache-control")).toBe("no-store");
    const bundle = await get("/assets/index-abc123.js");
    expect(bundle.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not mark a failed asset response immutable", () => {
    const res = withCacheHeaders(new Response("x", { status: 404 }), "/assets/missing.js");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
