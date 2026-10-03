import { describe, expect, it } from "vitest";

import { createApp, type AppBindings } from "../../app";
import { store } from "../helpers/store";

const env: AppBindings = {
  CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
  DEV_USER_EMAIL: "a@example.com",
  ASSETS: { fetch: async () => new Response("asset") },
};

function setup() {
  const s = store([]);
  s.sqlite.exec(`INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency')`);
  const app = createApp(() => s.db);
  const post = (body: unknown, origin = "http://localhost") =>
    app.request("http://localhost/api/summary/hidden-tags", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    }, env);
  const patterns = () =>
    (s.sqlite.prepare(`SELECT pattern FROM tag_exclusion_patterns ORDER BY id`).all() as { pattern: string }[])
      .map((r) => r.pattern);
  return { post, patterns };
}

describe("POST /api/summary/hidden-tags", () => {
  it("saves the list, dropping repeats", async () => {
    const { post, patterns } = setup();
    const res = await post({ patterns: ["trip:*", "emergency", "trip:*"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ patterns: ["trip:*", "emergency"] });
    expect(patterns()).toEqual(["trip:*", "emergency"]);
  });

  it("accepts an empty list", async () => {
    const { post, patterns } = setup();
    expect((await post({ patterns: [] })).status).toBe(200);
    expect(patterns()).toEqual([]);
  });

  it.each([
    [{ patterns: [" "] }],
    [{ patterns: ["x".repeat(101)] }],
    [{ patterns: "emergency" }],
    [{}],
  ])("refuses %j and leaves the list alone", async (body) => {
    const { post, patterns } = setup();
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBeTruthy();
    expect(patterns()).toEqual(["emergency"]);
  });

  it("refuses a write from another site", async () => {
    const { post, patterns } = setup();
    expect((await post({ patterns: [] }, "https://evil.example")).status).toBe(403);
    expect(patterns()).toEqual(["emergency"]);
  });
});
