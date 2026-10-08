import { describe, expect, it, vi } from "vitest";

import { createApp, type AppBindings } from "../../app";
import type { Db } from "../../db/types";
import { isReadLimit, nextReset, readLimitMessage } from "../../readLimit";

// What Drizzle throws when D1 refuses a query: its own error, D1's as the cause.
const limitError = () => new Error("Failed query: select ...", {
  cause: new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. [code: 7500]"),
});

function setup(err: Error) {
  const db = { select: () => { throw err; } } as unknown as Db;
  const assets = vi.fn(async () => new Response("app"));
  const env: AppBindings = {
    CF_ACCESS_TEAM_DOMAIN: "household.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    DEV_USER_EMAIL: "a@example.com",
    ASSETS: { fetch: assets },
  };
  const app = createApp(() => db);
  return { get: (path: string) => app.request(`http://localhost${path}`, {}, env), assets };
}

describe("D1's daily read limit", () => {
  it("is recognised through Drizzle's wrapper", () => {
    expect(isReadLimit(limitError())).toBe(true);
    expect(isReadLimit(new Error("no such table: users"))).toBe(false);
    expect(isReadLimit("daily read limit")).toBe(false);
  });

  it("resets at the next midnight UTC", () => {
    expect(nextReset(new Date("2026-10-08T18:39:00Z")).toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(nextReset(new Date("2026-12-31T23:59:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("gives the reset in Irish time", () => {
    expect(readLimitMessage(new Date("2026-10-08T18:39:00Z"))).toContain("01:00 Irish time"); // summer time
    expect(readLimitMessage(new Date("2026-12-08T18:39:00Z"))).toContain("00:00 Irish time");
  });

  it("explains itself on a page instead of a bare 500", async () => {
    const { get, assets } = setup(limitError());
    const res = await get("/");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.text()).toContain("Daily read limit reached");
    expect(assets).not.toHaveBeenCalled();
  });

  it("answers the API in JSON, which the app shows as the error", async () => {
    const res = await setup(limitError()).get("/api/me");
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain("daily read limit");
  });

  it("leaves any other failure a plain 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await setup(new Error("boom")).get("/");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");
  });
});
