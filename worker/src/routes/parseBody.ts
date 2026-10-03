/** Shared by the write routes: read the JSON body and validate it with zod. */

import type { Context } from "hono";
import type { z } from "zod";

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, error: "The request body must be JSON" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.issues[0].message };
}
