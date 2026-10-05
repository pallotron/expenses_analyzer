import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import { RUN_PART_KEYS } from "../../domain/payslips";
import { seed, store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

const zero = Object.fromEntries(RUN_PART_KEYS.map((k) => [k, 0]));
const run = (sourceFile: string, over: Record<string, unknown> = {}) =>
  ({ ...zero, salaryCents: 100000, statedNetCents: null, sourceFile, month: "2026-01", ...over });

function setup() {
  const s = store([]);
  s.sqlite.exec(`INSERT INTO users (id, email, display_name, owner_key) VALUES (2, 'b@example.com', 'B', 'b')`);
  seed(s.sqlite, [{ date: "2026-01-02", merchant: "Shop", amount: 5, deleted: false }], []);
  s.sqlite.exec(`UPDATE transactions SET source = 'Bank A'`);
  const app = createApp(() => s.db);
  const post = (path: string, body: unknown, origin = "http://localhost") =>
    app.request(`http://localhost/api${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
    }, env);
  const get = (path: string) => app.request(`http://localhost/api${path}`, {}, env);
  const runs = () => s.sqlite.prepare(`SELECT user_id, source_file, imported_by FROM payslip_runs ORDER BY source_file`).all();
  return { ...s, post, get, runs };
}

const error = async (res: Response) => (await res.json() as { error: string }).error;

describe("POST /api/payslips/import", () => {
  it("imports for either person, recording who uploaded", async () => {
    const { post, runs } = setup();
    const res = await post("/payslips/import", { userId: 2, runs: [run("2026-01 pay.pdf")] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ months: ["2026-01"], imported: ["2026-01"], replaced: 0, ytdMismatches: [] });
    expect(runs()).toEqual([{ user_id: 2, source_file: "2026-01 pay.pdf", imported_by: 1 }]);
  });

  it.each([
    ["an unknown person", { userId: 9, runs: [run("2026-01 pay.pdf")] }, "No such person"],
    ["no files", { userId: 1, runs: [] }, "Add at least one payslip"],
    ["a month that differs from the file name", { userId: 1, runs: [run("2026-02 pay.pdf")] }, "2026-02 pay.pdf"],
    ["a file name with no month", { userId: 1, runs: [run("pay.pdf")] }, "pay.pdf"],
    ["the same file twice", { userId: 1, runs: [run("2026-01 a.pdf"), run("2026-01 a.pdf")] }, "more than once"],
    ["fractional cents", { userId: 1, runs: [run("2026-01 a.pdf", { salaryCents: 1.5 })] }, "whole cents"],
    ["an amount over ten million", { userId: 1, runs: [run("2026-01 a.pdf", { salaryCents: 1_000_000_001 })] }, "An amount must be between −10,000,000 and 10,000,000"],
    ["an amount under minus ten million", { userId: 1, runs: [run("2026-01 a.pdf", { payeCents: -1_000_000_001 })] }, "An amount must be between −10,000,000 and 10,000,000"],
    ["a missing part", { userId: 1, runs: [{ ...run("2026-01 a.pdf"), uscCents: undefined }] }, "uscCents"],
    ["an extra field", { userId: 1, runs: [run("2026-01 a.pdf", { grossCents: 5 })] }, ""],
  ])("refuses %s and saves nothing", async (_label, body, message) => {
    const { post, runs } = setup();
    const res = await post("/payslips/import", body);
    expect(res.status).toBe(400);
    expect(await error(res)).toContain(message);
    expect(runs()).toEqual([]);
  });

  it("allows negative parts the parser produces", async () => {
    const { post } = setup();
    const res = await post("/payslips/import", { userId: 1, runs: [run("2026-01 a.pdf", { salaryCents: -5000, nonTaxableAdjCents: -100 })] });
    expect(res.status).toBe(200);
  });

  it("refuses more than 500 files", async () => {
    const { post } = setup();
    const many = Array.from({ length: 501 }, (_, i) => run(`2026-01 ${i}.pdf`));
    expect((await post("/payslips/import", { userId: 1, runs: many })).status).toBe(400);
  });

  it("refuses a write from another site", async () => {
    const { post } = setup();
    expect((await post("/payslips/import", { userId: 1, runs: [run("2026-01 a.pdf")] }, "https://evil.example")).status).toBe(403);
  });
});

describe("POST /api/payslips/remove and GET /api/payslips", () => {
  it("lists, then removes a file", async () => {
    const { post, get } = setup();
    await post("/payslips/import", { userId: 1, runs: [run("2026-01 pay.pdf")] });
    const list = await (await get("/payslips")).json() as { people: { id: number; months: { runs: unknown[] }[] }[] };
    expect(list.people[0].months[0].runs).toHaveLength(1);
    const res = await post("/payslips/remove", { userId: 1, sourceFiles: ["2026-01 pay.pdf"] });
    expect(await res.json()).toEqual({ months: ["2026-01"] });
  });

  it.each([
    [{ userId: 1, sourceFiles: [] }],
    [{ userId: 9, sourceFiles: ["a.pdf"] }],
    [{ userId: 1, sourceFiles: [""] }],
  ])("refuses %j", async (body) => {
    expect((await setup().post("/payslips/remove", body)).status).toBe(400);
  });
});

describe("source owners", () => {
  it("lists every source in use with its owner", async () => {
    const res = await setup().get("/source-owners");
    expect(await res.json()).toEqual({
      sources: [{ source: "Bank A", userId: null }],
      users: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    });
  });

  it("sets and clears an owner", async () => {
    const { post, get } = setup();
    expect((await post("/source-owners", { source: "Bank A", userId: 2 })).status).toBe(200);
    expect((await (await get("/source-owners")).json() as { sources: unknown[] }).sources).toEqual([{ source: "Bank A", userId: 2 }]);
    expect((await post("/source-owners", { source: "Bank A", userId: null })).status).toBe(200);
    expect((await (await get("/source-owners")).json() as { sources: unknown[] }).sources).toEqual([{ source: "Bank A", userId: null }]);
  });

  it("answers 404 for a source no transaction has, and 400 for an unknown person", async () => {
    const { post } = setup();
    expect((await post("/source-owners", { source: "Nope", userId: 1 })).status).toBe(404);
    expect((await post("/source-owners", { source: "Bank A", userId: 9 })).status).toBe(400);
  });
});
