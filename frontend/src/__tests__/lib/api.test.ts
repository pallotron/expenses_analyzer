/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_SET_UP, getJson, page } from "../../lib/api";

// jsdom's window.location cannot be replaced, so the reload goes through `page`.
let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.spyOn(page, "reload").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respond = (res: Partial<Response>) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 200, type: "basic", json: async () => ({}), ...res })));

describe("getJson", () => {
  it("returns the parsed body", async () => {
    respond({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    expect(await getJson("/api/x")).toEqual({ a: 1 });
  });

  it("reloads once when Access redirects, and not again straight after", async () => {
    respond({ status: 0, type: "opaqueredirect" });
    await expect(getJson("/api/x")).rejects.toThrow("Reloading to sign in again");
    await expect(getJson("/api/x")).rejects.toThrow("Reload the page to sign in again");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a 401", async () => {
    respond({ status: 401 });
    await expect(getJson("/api/x")).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload on a 403, which would loop, and says why", async () => {
    respond({ status: 403 });
    await expect(getJson("/api/x")).rejects.toThrow(NOT_SET_UP);
    expect(reload).not.toHaveBeenCalled();
  });

  it("surfaces the API's error message", async () => {
    respond({ status: 400, json: async () => ({ error: "year must be four digits" }) });
    await expect(getJson("/api/x")).rejects.toThrow("year must be four digits");
  });
});
