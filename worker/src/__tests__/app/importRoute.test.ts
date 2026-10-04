import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { ImportMapping } from "../../api/import";
import { createDb } from "../../db/client";
import { fakeD1 } from "../helpers/fakeD1";
import { store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

const MAPPING: ImportMapping = { date: "Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const ROWS = [
  { date: "2026-09-01", merchant: "Corner Shop", amountCents: 1250, type: "expense" as const },
  { date: "2026-09-02", merchant: "Acme Payroll", amountCents: 250000, type: "income" as const },
];

function setup(d1 = false) {
  const s = store([]);
  const db = d1 ? createDb(fakeD1(s.sqlite)) : s.db;
  const app = createApp(() => db);
  const send = (method: string, path: string, body?: unknown, origin = "http://localhost") =>
    app.request(`http://localhost${path}`, {
      method, headers: { "content-type": "application/json", origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const count = () => (s.sqlite.prepare(`SELECT count(*) AS n FROM transactions`).get() as { n: number }).n;
  const mappings = async () => (await (await send("GET", "/api/import/mappings")).json()) as { mappings: Record<string, ImportMapping> };
  return { ...s, send, count, mappings };
}

describe("POST /api/import", () => {
  it("imports, reports, and remembers the mapping for the source", async () => {
    const s = setup();
    const res = await s.send("POST", "/api/import", { source: "Card", filename: "sept.csv", mapping: MAPPING, rows: ROWS });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 2, duplicates: 0, suppressedDeleted: 0, newMerchants: ["Acme Payroll", "Corner Shop"] });
    expect(s.count()).toBe(2);
    expect(s.sqlite.prepare(`SELECT source, filename FROM import_batches`).get()).toEqual({ source: "Card", filename: "sept.csv" });
    expect(await s.mappings()).toEqual({ mappings: { Card: MAPPING } });
  });

  it("inserts nothing new when the same file comes again", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS });
    const again = await (await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS })).json();
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(s.count()).toBe(2);
  });

  it("keeps each source's mapping and replaces only the one imported", async () => {
    const s = setup();
    const bank: ImportMapping = { ...MAPPING, amount: "Money In (€)", amountOut: "Money Out (€)" };
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS });
    await s.send("POST", "/api/import", { source: "Bank", mapping: bank, rows: ROWS });
    const card2 = { ...MAPPING, filter: { column: "State", value: "COMPLETED" } };
    await s.send("POST", "/api/import", { source: "Card", mapping: card2, rows: ROWS });
    expect(await s.mappings()).toEqual({ mappings: { Card: card2, Bank: bank } });
  });

  it("refuses rows the import validation refuses, saving nothing", async () => {
    const s = setup();
    const res = await s.send("POST", "/api/import", {
      source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], merchant: "  " }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "The file has rows the import refuses",
      errors: ["Found 1 row(s) with empty or missing merchant names"],
    });
    expect(s.count()).toBe(0);
    expect(await s.mappings()).toEqual({ mappings: {} });
  });

  it.each([
    ["no source", { mapping: MAPPING, rows: ROWS }],
    ["blank source", { source: "  ", mapping: MAPPING, rows: ROWS }],
    ["long source", { source: "x".repeat(101), mapping: MAPPING, rows: ROWS }],
    ["no rows", { source: "Card", mapping: MAPPING, rows: [] }],
    ["bad date", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], date: "01/09/2026" }] }],
    ["negative cents", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], amountCents: -5 }] }],
    ["bad type", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], type: "refund" }] }],
    ["extra mapping field", { source: "Card", mapping: { ...MAPPING, colour: "red" }, rows: ROWS }],
    ["bad type mode", { source: "Card", mapping: { ...MAPPING, typeMode: "sometimes" }, rows: ROWS }],
  ])("refuses %s", async (_, body) => {
    const res = await setup().send("POST", "/api/import", body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
  });

  it("refuses more than 5,000 rows with the split message", async () => {
    const rows = Array.from({ length: 5_001 }, () => ROWS[0]);
    const res = await setup().send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "At most 5,000 rows per import: split the file" });
  });

  it("imports 5,000 rows through the D1 driver", async () => {
    const s = setup(true);
    const rows = Array.from({ length: 5_000 }, (_, i) => ({
      date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`,
      merchant: `Shop ${i % 300}`, amountCents: 100 + i, type: "expense" as const,
    }));
    const res = await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 5_000 });
  });

  it("refuses a request from another site", async () => {
    const res = await setup().send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS }, "https://evil.example");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/import/mappings", () => {
  it("is empty before any import", async () => {
    expect(await setup().mappings()).toEqual({ mappings: {} });
  });
});
