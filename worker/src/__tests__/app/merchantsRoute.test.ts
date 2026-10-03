import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import { categorise, seed, store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup() {
  const rules = [["^CAFE", "Cafe"]];
  const s = store(rules);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "CAFE ONE", amount: 4, deleted: false },
    { date: "2026-03-02", merchant: "CORNER SHOP", amount: 10, deleted: false },
  ], rules);
  categorise(s.sqlite, { Cafe: "Eating out" });
  const app = createApp(() => s.db);
  const send = (method: string, path: string, body?: unknown, origin: string | null = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...(origin && { origin }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  return { ...s, send };
}

describe("merchant reads", () => {
  it("lists merchants", async () => {
    const { send } = setup();
    const res = await send("GET", "/api/merchants");
    expect(res.status).toBe(200);
    const { merchants } = await res.json() as { merchants: { name: string }[] };
    expect(merchants.map((m) => m.name).sort()).toEqual(["CORNER SHOP", "Cafe"]);
  });

  it("looks up the rule for a raw name, refusing a blank one", async () => {
    const { send } = setup();
    expect(await (await send("GET", "/api/merchants/rule?raw=CAFE%20TWO")).json())
      .toMatchObject({ merchant: "Cafe", rule: { pattern: "^CAFE" }, category: "Eating out" });
    expect((await send("GET", "/api/merchants/rule?raw=%20")).status).toBe(400);
  });

  it("previews, reporting a bad pattern in the body", async () => {
    const { send } = setup();
    expect(await (await send("GET", "/api/merchants/preview?pattern=CORNER&alias=Corner")).json())
      .toMatchObject({ matched: 1, totalCents: 1000 });
    const bad = await (await send("GET", "/api/merchants/preview?pattern=%5Bbad&alias=X")).json() as { error?: string };
    expect(bad.error).toBeTruthy();
  });
});

describe("merchant writes", () => {
  it("refuses a write from another site", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/merchants/category", { ids: [1], category: "X" }, "https://evil.example")).status).toBe(403);
  });

  it("saves a decision", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/merchants/decision", { pattern: "CORNER", alias: "Corner Shop", category: "Groceries", tags: ["local"] });
    expect(await res.json()).toEqual({ repointed: 1, tagged: 1 });
  });

  it("answers 400 with the regex message, and for a blank alias", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/merchants/decision", { pattern: "[bad", alias: "X" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/pattern/i);
    expect((await send("POST", "/api/merchants/decision", { pattern: "CORNER", alias: " " })).status).toBe(400);
  });

  it("answers 400 for a whitespace-only category", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/merchants/decision", { pattern: "CORNER", alias: "Corner Shop", category: "  " });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Category cannot be empty");
  });

  it("deletes a rule, and answers 404 the second time", async () => {
    const { send, sqlite } = setup();
    const { id } = sqlite.prepare(`SELECT id FROM merchant_aliases`).get() as { id: number };
    expect(await (await send("POST", `/api/merchants/rules/${id}/delete`)).json()).toEqual({ repointed: 1 });
    expect((await send("POST", `/api/merchants/rules/${id}/delete`)).status).toBe(404);
    expect((await send("POST", `/api/merchants/rules/abc/delete`)).status).toBe(400);
  });

  it("sets and clears categories", async () => {
    const { send } = setup();
    expect(await (await send("POST", "/api/merchants/category", { ids: [1, 3], category: "Food" })).json()).toEqual({ updated: 2 });
    expect(await (await send("POST", "/api/merchants/category", { ids: [1], category: null })).json()).toEqual({ updated: 1 });
    expect((await send("POST", "/api/merchants/category", { ids: [], category: "Food" })).status).toBe(400);
  });
});
