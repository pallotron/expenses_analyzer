/**
 * The one network call: Gemini's generateContent REST endpoint. The key goes
 * in a header so it never lands in a URL or a log; only status codes are
 * logged. Services take a GenerateText, so tests never reach the network.
 */

import { GeminiResponseError } from "../domain/gemini";

export type GenerateText = (prompt: string) => Promise<string>;

/** What the TUI hardcoded; GEMINI_MODEL overrides it. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** Gemini could not be reached, or answered with an HTTP error. */
export class GeminiCallError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super(status === null ? "Gemini could not be reached" : `Gemini answered HTTP ${status}`);
    this.status = status;
  }
}

interface GenerateContentBody {
  candidates?: { content?: { parts?: ({ text?: unknown } | null)[] } }[];
}

export function geminiClient(apiKey: string, model: string, fetchImpl?: typeof fetch): GenerateText {
  return async (prompt) => {
    let res: Response;
    try {
      res = await (fetchImpl ?? fetch)(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );
    } catch {
      console.warn("gemini: request failed");
      throw new GeminiCallError(null);
    }
    if (!res.ok) {
      console.warn(`gemini: HTTP ${res.status}`);
      throw new GeminiCallError(res.status);
    }
    const body = await res.json().catch(() => null) as GenerateContentBody | null;
    const parts = body?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new GeminiResponseError("no candidate");
    return parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  };
}
