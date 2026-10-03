import { describe, expect, it } from "vitest";

import { createApp, sameOrigin, type AppBindings } from "../../app";
import { categorise, seed, store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup() {
  const s = store([]);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
    { date: "2026-03-02", merchant: "Cafe", amount: 4, deleted: false },
  ], []);
  categorise(s.sqlite, { Shop: "Shopping", Cafe: "Eating out" });
  const app = createApp(() => s.db);
  const send = (method: string, path: string, body?: unknown, origin: string | null = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...(origin && { origin }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  return { ...s, send };
}
const one = <T>(sqlite: ReturnType<typeof store>["sqlite"], q: string) => sqlite.prepare(q).get() as T;

describe("Origin check", () => {
  it("refuses a write from another site, or with no Origin", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/transactions/delete", { ids: [1] }, "https://evil.example")).status).toBe(403);
    expect((await send("POST", "/api/transactions/delete", { ids: [1] }, null)).status).toBe(403);
  });

  it("accepts a local dev server on another port, but only on a local host", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/transactions/delete", { ids: [1] }, "http://localhost:5173")).status).toBe(200);
  });

  it("leaves reads alone", async () => {
    const { send } = setup();
    expect((await send("GET", "/api/lookups", undefined, null)).status).toBe(200);
  });
});

describe("PATCH /api/transactions/:id", () => {
  it("edits one transaction", async () => {
    const { send, sqlite } = setup();
    const res = await send("PATCH", "/api/transactions/1", { amountCents: 1234, type: "income", source: " Card ", category: "Eating out" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(one(sqlite, `SELECT amount_cents AS c, type, source FROM transactions WHERE id = 1`)).toEqual({ c: 1234, type: "income", source: "Card" });
    expect(one(sqlite, `SELECT category FROM v_live WHERE id = 1`)).toEqual({ category: "Eating out" });
  });

  it("replaces the tags", async () => {
    const { send, sqlite } = setup();
    sqlite.prepare(`INSERT INTO tags (name) VALUES ('old')`).run();
    sqlite.prepare(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (1, 1)`).run();
    const res = await send("PATCH", "/api/transactions/1", { tags: [" Gift ", "trip"] });
    expect(res.status).toBe(200);
    expect(sqlite.prepare(`SELECT g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = 1 ORDER BY 1`).all())
      .toEqual([{ name: "gift" }, { name: "trip" }]);
  });

  it("refuses tags in a bulk edit", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/transactions/bulk-edit", { ids: [1], edit: { tags: ["a"] } })).status).toBe(400);
  });

  it("answers 404 for a transaction that does not exist", async () => {
    const { send } = setup();
    const res = await send("PATCH", "/api/transactions/99", { type: "income" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This transaction no longer exists." });
  });

  it.each([
    [{}, "Nothing to change"],
    [{ date: "2026-02-30" }, "Date must be a real day, YYYY-MM-DD"],
    [{ date: "1800-01-01" }, "Date must be between 1900-01-01 and"],
    [{ amountCents: 0 }, "Amount must be more than zero"],
    [{ amountCents: 12.5 }, "Amount must be whole cents"],
    [{ amountCents: 100_000_001 }, "Amount must be at most €1,000,000.00"],
    [{ merchant: "   " }, "Statement text cannot be empty"],
    [{ source: "" }, "Source cannot be empty"],
    [{ type: "refund" }, "Type must be expense or income"],
    [{ category: "Nope" }, 'There is no category called "Nope"'],
  ])("refuses %j", async (body, message) => {
    const { send } = setup();
    const res = await send("PATCH", "/api/transactions/1", body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(message);
  });

  it("refuses a non-numeric id", async () => {
    const { send } = setup();
    expect((await send("PATCH", "/api/transactions/abc", { type: "income" })).status).toBe(400);
  });
});

describe("rows deleted elsewhere", () => {
  it("PATCH answers 404 and leaves a deleted row alone", async () => {
    const { send, sqlite } = setup();
    await send("POST", "/api/transactions/delete", { ids: [1] });
    const before = one(sqlite, `SELECT amount_cents AS c, type FROM transactions WHERE id = 1`);
    const res = await send("PATCH", "/api/transactions/1", { amountCents: 999, type: "income" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This transaction no longer exists." });
    expect(one(sqlite, `SELECT amount_cents AS c, type FROM transactions WHERE id = 1`)).toEqual(before);
  });

  it("bulk-edit counts and edits only live rows", async () => {
    const { send, sqlite } = setup();
    await send("POST", "/api/transactions/delete", { ids: [2] });
    const before = one<{ source: string }>(sqlite, `SELECT source FROM transactions WHERE id = 2`);
    const res = await send("POST", "/api/transactions/bulk-edit", { ids: [1, 2], edit: { source: "Card" } });
    expect(await res.json()).toEqual({ updated: 1 });
    expect(one(sqlite, `SELECT source FROM transactions WHERE id = 2`)).toEqual(before);
    expect(one(sqlite, `SELECT source FROM transactions WHERE id = 1`)).toEqual({ source: "Card" });
  });
});

describe("bulk routes", () => {
  it("bulk-edits, counting only rows that exist", async () => {
    const { send, sqlite } = setup();
    const res = await send("POST", "/api/transactions/bulk-edit", { ids: [1, 2, 99], edit: { source: "Card" } });
    expect(await res.json()).toEqual({ updated: 2 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transactions WHERE source = 'Card'`)).toEqual({ n: 2 });
  });

  it("refuses a bulk edit of fields bulk edit does not offer", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/transactions/bulk-edit", { ids: [1], edit: { amountCents: 5 } });
    expect(res.status).toBe(400);
  });

  it("deletes and restores", async () => {
    const { send, sqlite } = setup();
    expect(await (await send("POST", "/api/transactions/delete", { ids: [1, 2] })).json()).toEqual({ deleted: 2, ids: [1, 2] });
    expect(await (await send("POST", "/api/transactions/delete", { ids: [1, 2] })).json()).toEqual({ deleted: 0, ids: [] });
    expect(await (await send("POST", "/api/transactions/restore", { ids: [1] })).json()).toEqual({ restored: 1 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL`)).toEqual({ n: 1 });
  });

  it("tags only live rows, and counts only those", async () => {
    const { send, sqlite } = setup();
    await send("POST", "/api/transactions/delete", { ids: [2] });
    expect(await (await send("POST", "/api/transactions/tags", { ids: [1, 2], tags: ["trip"], mode: "add" })).json()).toEqual({ tagged: 1 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transaction_tags WHERE transaction_id = 2`)).toEqual({ n: 0 });
  });

  it("tags and untags", async () => {
    const { send, sqlite } = setup();
    expect(await (await send("POST", "/api/transactions/tags", { ids: [1, 2], tags: ["Trip "], mode: "add" })).json()).toEqual({ tagged: 2 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transaction_tags`)).toEqual({ n: 2 });
    await send("POST", "/api/transactions/tags", { ids: [1], tags: ["trip"], mode: "remove" });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM transaction_tags`)).toEqual({ n: 1 });
  });

  it.each([
    ["/api/transactions/delete", { ids: [] }, "Choose at least one transaction"],
    ["/api/transactions/delete", { ids: [0] }, "ids must be positive whole numbers"],
    ["/api/transactions/delete", { ids: Array.from({ length: 10_001 }, (_, i) => i + 1) }, "At most 10,000 transactions at once"],
    ["/api/transactions/tags", { ids: [1], tags: [" , "], mode: "add" }, "Give at least one tag"],
    ["/api/transactions/tags", { ids: [1], tags: ["x"], mode: "toggle" }, "mode must be add or remove"],
    ["/api/transactions/bulk-edit", { ids: [1], edit: {} }, "Nothing to change"],
  ])("refuses a bad body for %s", async (path, body, message) => {
    const { send } = setup();
    const res = await send("POST", path, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(message);
  });

  it("refuses a body that is not JSON", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/transactions/delete", undefined);
    expect(res.status).toBe(400);
  });
});

describe("sameOrigin", () => {
  it.each([
    ["https://x.example", "https://x.example/api/a", true],
    ["https://evil.example", "https://x.example/api/a", false],
    ["http://localhost:5173", "http://localhost:8787/api/a", true],
    ["http://localhost:5173", "https://x.example/api/a", false],
    ["null", "https://x.example/api/a", false],
    [null, "https://x.example/api/a", false],
  ])("%s → %s is %s", (origin, url, ok) => {
    expect(sameOrigin(origin, url)).toBe(ok);
  });
});
