import { describe, expect, it, vi } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { ImportMapping, ImportResponse } from "../../api/import";
import { createDb } from "../../db/client";
import * as importMappings from "../../services/importMappings";
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

  it("still answers 200 when only remembering the mapping fails", async () => {
    const s = setup();
    const save = vi.spyOn(importMappings, "saveImportMapping").mockRejectedValueOnce(new Error("settings write failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ inserted: 2, duplicates: 0 });
      expect(s.count()).toBe(2);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      save.mockRestore();
      log.mockRestore();
    }
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
    ["no source", { mapping: MAPPING, rows: ROWS }, "Invalid input: expected string, received undefined"],
    ["blank source", { source: "  ", mapping: MAPPING, rows: ROWS }, "Choose a source"],
    ["long source", { source: "x".repeat(101), mapping: MAPPING, rows: ROWS }, "A source name can be at most 100 characters"],
    ["no rows", { source: "Card", mapping: MAPPING, rows: [] }, "Nothing to import"],
    ["bad date", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], date: "01/09/2026" }] }, "Dates must be YYYY-MM-DD"],
    ["negative cents", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], amountCents: -5 }] }, "Amounts are positive; the type says which way"],
    ["bad type", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], type: "refund" }] }, "Invalid option: expected one of \"expense\"|\"income\""],
    ["extra mapping field", { source: "Card", mapping: { ...MAPPING, colour: "red" }, rows: ROWS }, "Unrecognized key: \"colour\""],
    ["bad type mode", { source: "Card", mapping: { ...MAPPING, typeMode: "sometimes" }, rows: ROWS }, "Invalid option: expected one of \"auto\"|\"expense\"|\"income\""],
  ])("refuses %s", async (_, body, message) => {
    const res = await setup().send("POST", "/api/import", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
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

describe("POST /api/import with dryRun", () => {
  const tally = (s: ReturnType<typeof setup>) => s.sqlite.prepare(`
    SELECT (SELECT count(*) FROM transactions) AS t, (SELECT count(*) FROM merchants) AS m,
           (SELECT count(*) FROM import_batches) AS b
  `).get();

  it("reports what the import would do, and writes nothing", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: [ROWS[0]] });
    const before = tally(s);
    const res = await s.send("POST", "/api/import", {
      source: "Other", mapping: { ...MAPPING, dateOrder: "mdy" }, rows: ROWS, dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: null, inserted: 1, duplicates: 1, suppressedDeleted: 0, newMerchants: ["Acme Payroll"],
    });
    expect(tally(s)).toEqual(before);
    expect(await s.mappings()).toEqual({ mappings: { Card: MAPPING } });
  });

  it("counts deleted rows and repeats exactly as the import then does", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: [ROWS[0]] });
    s.sqlite.prepare(`UPDATE transactions SET deleted_at = unixepoch()`).run();
    const body = { source: "Card", mapping: MAPPING, rows: [ROWS[0], ROWS[1], ROWS[1]] };
    const dry = await (await s.send("POST", "/api/import", { ...body, dryRun: true })).json() as ImportResponse;
    expect(dry).toEqual({ batchId: null, inserted: 2, duplicates: 0, suppressedDeleted: 1, newMerchants: ["Acme Payroll"] });
    const real = await (await s.send("POST", "/api/import", body)).json() as ImportResponse;
    expect(real).toEqual({ ...dry, batchId: expect.any(Number) });
  });

  it("refuses the rows the import refuses", async () => {
    const res = await setup().send("POST", "/api/import", {
      source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], merchant: " " }], dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "The file has rows the import refuses",
      errors: ["Found 1 row(s) with empty or missing merchant names"],
    });
  });

  it("takes only a boolean", async () => {
    const res = await setup().send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS, dryRun: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input: expected boolean, received string" });
  });
});

describe("GET /api/import/mappings", () => {
  it("is empty before any import", async () => {
    expect(await setup().mappings()).toEqual({ mappings: {} });
  });
});
