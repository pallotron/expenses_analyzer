import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeminiResponseError } from "../../domain/gemini";
import { GeminiCallError, geminiClient } from "../../services/gemini";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("geminiClient", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("posts the prompt with the key in a header, and joins the answer's text parts", async () => {
    const fetchImpl = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: '{"A":' }, { text: ' "B"}' }] } }] }));
    const generate = geminiClient("secret-key", "gemini-test", fetchImpl as unknown as typeof fetch);
    expect(await generate("hello")).toBe('{"A": "B"}');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain("secret-key");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    expect(JSON.parse(String(init.body))).toEqual({ contents: [{ parts: [{ text: "hello" }] }] });
  });

  it("throws GeminiCallError with the status on a non-2xx answer, logging only the status", async () => {
    const generate = geminiClient("secret-key", "m", (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch);
    const e = await generate("secret-prompt").catch((x) => x);
    expect(e).toBeInstanceOf(GeminiCallError);
    expect(e.status).toBe(429);
    expect(warn).toHaveBeenCalledWith("gemini: HTTP 429");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("secret-key");
    expect(logged).not.toContain("secret-prompt");
  });

  it("throws GeminiCallError without a status when fetch itself fails", async () => {
    const generate = geminiClient("k", "m", (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch);
    const e = await generate("p").catch((x) => x);
    expect(e).toBeInstanceOf(GeminiCallError);
    expect(e.status).toBeNull();
  });

  it.each([
    [{ promptFeedback: { blockReason: "SAFETY" } }],
    [{ candidates: [] }],
    [{ candidates: [{ finishReason: "SAFETY" }] }],
  ])("throws GeminiResponseError on a 200 with no usable candidate: %j", async (body) => {
    const generate = geminiClient("k", "m", (async () => ok(body)) as unknown as typeof fetch);
    await expect(generate("p")).rejects.toBeInstanceOf(GeminiResponseError);
  });

  it("throws GeminiResponseError when the 200 body is not JSON", async () => {
    const generate = geminiClient("k", "m", (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch);
    await expect(generate("p")).rejects.toBeInstanceOf(GeminiResponseError);
  });
});
