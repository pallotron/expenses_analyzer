import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { LookupsResponse } from "../../api/transactions";
import { categorise, seed, store } from "../helpers/store";

const base: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup(env: AppBindings = { ...base, GEMINI_API_KEY: "test-key" }) {
  const s = store([]);
  seed(s.sqlite, [
    { date: "2026-03-01", merchant: "Corner Shop", amount: 10, deleted: false },
    { date: "2026-03-02", merchant: "Bakery", amount: 5, deleted: false },
  ], []);
  categorise(s.sqlite, { Bakery: "Groceries" });
  const app = createApp(() => s.db);
  const send = (method: string, path: string, body?: unknown, origin = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method, headers: { "content-type": "application/json", origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  return { ...s, send };
}

const geminiAnswers = (text: string) => vi.fn(async () => new Response(
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 },
));

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("POST /api/merchants/suggest", () => {
  it("asks Gemini with the configured model and saves the answers", async () => {
    const fetchMock = geminiAnswers('{"Corner Shop": "Groceries"}');
    vi.stubGlobal("fetch", fetchMock);
    const { send } = setup({ ...base, GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" });
    const res = await send("POST", "/api/merchants/suggest", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ asked: 1, suggested: 1, newCategories: [], unanswered: 0 });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/models/gemini-test:generateContent");
  });

  it("uses gemini-2.5-flash when no model is configured", async () => {
    const fetchMock = geminiAnswers("{}");
    vi.stubGlobal("fetch", fetchMock);
    await setup().send("POST", "/api/merchants/suggest", {});
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("is 503 without a key", async () => {
    const res = await setup(base).send("POST", "/api/merchants/suggest", {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Gemini isn't set up" });
  });

  it.each([
    [async () => new Response("quota", { status: 429 }), "Gemini didn't answer (HTTP 429)"],
    [async () => { throw new TypeError("offline"); }, "Gemini didn't answer"],
    [async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }), "Gemini's answer couldn't be read"],
    [async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sorry, no." }] } }] }), { status: 200 }), "Gemini's answer couldn't be read"],
  ])("is 502 with a short message when Gemini fails (%#), saving nothing", async (impl, message) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    const { send, sqlite } = setup();
    const res = await send("POST", "/api/merchants/suggest", {});
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: message });
    expect(sqlite.prepare(`SELECT count(*) AS n FROM merchants WHERE category_suggested = 1`).get()).toEqual({ n: 0 });
  });

  it("refuses a request from another site", async () => {
    vi.stubGlobal("fetch", geminiAnswers("{}"));
    expect((await setup().send("POST", "/api/merchants/suggest", {}, "https://evil.example")).status).toBe(403);
  });
});

describe("POST /api/merchants/confirm", () => {
  it("confirms flagged merchants", async () => {
    const { send, sqlite } = setup();
    sqlite.exec(`UPDATE merchants SET category_suggested = 1 WHERE canonical_name = 'Bakery'`);
    const id = (sqlite.prepare(`SELECT id FROM merchants WHERE canonical_name = 'Bakery'`).get() as { id: number }).id;
    const res = await send("POST", "/api/merchants/confirm", { ids: [id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: 1 });
  });

  it.each([[{ ids: [] }], [{ ids: [0] }], [{ ids: "1" }], [{}], [{ ids: [1], extra: true }]])("refuses %j", async (body) => {
    const res = await setup().send("POST", "/api/merchants/confirm", body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
  });

  it("refuses a request from another site", async () => {
    expect((await setup().send("POST", "/api/merchants/confirm", { ids: [1] }, "https://evil.example")).status).toBe(403);
  });
});

describe("GET /api/lookups", () => {
  it("says whether Gemini is set up", async () => {
    const on = await (await setup().send("GET", "/api/lookups")).json() as LookupsResponse;
    const off = await (await setup(base).send("GET", "/api/lookups")).json() as LookupsResponse;
    expect(on.gemini).toBe(true);
    expect(off.gemini).toBe(false);
  });
});

const idOf = (s: ReturnType<typeof setup>, name: string) =>
  (s.sqlite.prepare(`SELECT id FROM merchants WHERE canonical_name = ?`).get(name) as { id: number }).id;

describe("POST /api/merchants/ask", () => {
  it("returns Gemini's opinion without saving it", async () => {
    vi.stubGlobal("fetch", geminiAnswers('{"Bakery": "Bread", "Corner Shop": "groceries"}'));
    const s = setup();
    const res = await s.send("POST", "/api/merchants/ask", { ids: [idOf(s, "Bakery"), idOf(s, "Corner Shop")] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      answers: [
        { id: idOf(s, "Bakery"), name: "Bakery", current: "Groceries", suggested: "Bread", isNew: true },
        { id: idOf(s, "Corner Shop"), name: "Corner Shop", current: null, suggested: "Groceries", isNew: false },
      ],
      unanswered: 0,
    });
    expect(s.sqlite.prepare(`SELECT count(*) AS n FROM categories`).get()).toEqual({ n: 1 });
  });

  it("is 503 without a key", async () => {
    const res = await setup(base).send("POST", "/api/merchants/ask", { ids: [1] });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Gemini isn't set up" });
  });

  it("is 502 when Gemini fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    const s = setup();
    const res = await s.send("POST", "/api/merchants/ask", { ids: [idOf(s, "Bakery")] });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Gemini didn't answer (HTTP 429)" });
  });

  it.each([[{ ids: [] }], [{ ids: [0] }], [{ ids: Array.from({ length: 1001 }, (_, i) => i + 1) }], [{}]])(
    "refuses %#", async (body) => {
      const res = await setup().send("POST", "/api/merchants/ask", body);
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBeTruthy();
    });

  it("refuses a request from another site", async () => {
    expect((await setup().send("POST", "/api/merchants/ask", { ids: [1] }, "https://evil.example")).status).toBe(403);
  });
});

describe("POST /api/merchants/categories", () => {
  it("applies each change and creates new categories", async () => {
    const s = setup();
    const res = await s.send("POST", "/api/merchants/categories", {
      changes: [{ id: idOf(s, "Corner Shop"), category: "Hardware" }, { id: idOf(s, "Bakery"), category: "Bread" }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    expect(s.sqlite.prepare(`
      SELECT m.canonical_name AS name, c.name AS category FROM merchants m JOIN categories c ON c.id = m.category_id ORDER BY 1
    `).all()).toEqual([{ name: "Bakery", category: "Bread" }, { name: "Corner Shop", category: "Hardware" }]);
  });

  it.each([
    [{ changes: [] }],
    [{ changes: [{ id: 1, category: " " }] }],
    [{ changes: [{ id: 0, category: "X" }] }],
    [{ changes: [{ id: 1 }] }],
    [{ changes: [{ id: 1, category: "X", extra: 1 }] }],
    [{}],
  ])("refuses %j", async (body) => {
    const res = await setup().send("POST", "/api/merchants/categories", body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
  });

  it("refuses a request from another site", async () => {
    const res = await setup().send("POST", "/api/merchants/categories", { changes: [{ id: 1, category: "X" }] }, "https://evil.example");
    expect(res.status).toBe(403);
  });
});
