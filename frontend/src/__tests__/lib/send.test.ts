/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, send } from "../../lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("send", () => {
  it("posts JSON and returns the parsed answer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ deleted: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await send("POST", "/api/transactions/delete", { ids: [1, 2] })).toEqual({ deleted: 2 });
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/transactions/delete");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ ids: [1, 2] }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("throws the server's message with its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Amount must be more than zero" }), { status: 400 })));
    await expect(send("PATCH", "/api/transactions/1", {})).rejects.toEqual(new ApiError(400, "Amount must be more than zero"));
  });

  it("shows the server's message on a refused cross-site write, but NOT_SET_UP for Access's bare 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Cross-site request refused" }), { status: 403 })));
    await expect(send("POST", "/x", {})).rejects.toEqual(new ApiError(403, "Cross-site request refused"));
  });

  it("keeps the server's list of errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "The file has rows the import refuses", errors: ["Found 2 date(s) after maximum allowed date 2027-10-04"],
    }), { status: 400 })));
    const e = (await send("POST", "/api/import", {}).catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe("The file has rows the import refuses");
    expect(e.errors).toEqual(["Found 2 date(s) after maximum allowed date 2027-10-04"]);
  });

  it("ignores an errors field that is not a list of strings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Bad", errors: "nope" }), { status: 400 })));
    const e = (await send("POST", "/x", {}).catch((x: unknown) => x)) as ApiError;
    expect(e.errors).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Bad", errors: ["a", 1] }), { status: 400 })));
    const f = (await send("POST", "/x", {}).catch((x: unknown) => x)) as ApiError;
    expect(f.errors).toBeUndefined();
  });
});
