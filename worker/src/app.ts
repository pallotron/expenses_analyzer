/**
 * The Worker as a Hono app. Every request, static files included, passes
 * getUser first (wrangler.toml sets run_worker_first), so nothing is served to
 * a request Access did not vouch for.
 *
 * The database comes from the caller: index.ts passes createDb over env.DB,
 * tests pass an in-memory SQLite. That keeps env.DB inside db/client.ts and
 * this file free of Workers-only types.
 */

import { Hono } from "hono";

import { count, isNull } from "drizzle-orm";
import { getUser, type AuthDeps, type User } from "./auth";
import { transactions } from "./db/schema";
import type { Db } from "./db/types";
import { summaryRoutes } from "./routes/summary";

export interface AppBindings {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  /** Local development only, from worker/.dev.vars. See AuthConfig. */
  DEV_USER_EMAIL?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export type AppEnv<B extends AppBindings> = { Bindings: B; Variables: { user: User; db: Db } };

/** Hashed build output can be cached forever; anything else must be revalidated. */
export function withCacheHeaders(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  out.headers.set(
    "Cache-Control",
    res.ok && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
  );
  return out;
}

export function createApp<B extends AppBindings>(makeDb: (env: B) => Db, auth: AuthDeps = {}) {
  const app = new Hono<AppEnv<B>>();

  app.use("*", async (c, next) => {
    const db = makeDb(c.env);
    const result = await getUser(c.req.raw, {
      teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
      aud: c.env.CF_ACCESS_AUD,
      devUserEmail: c.env.DEV_USER_EMAIL,
    }, db, auth);
    if (!result.ok) {
      console.warn(`auth refused (${result.status}): ${result.reason}`);
      // The reason stays in the log; the client learns only the status.
      return c.body(null, result.status);
    }
    c.set("user", result.user);
    c.set("db", db);
    await next();
  });

  app.get("/health", async (c) => {
    const [row] = await c.get("db")
      .select({ transactions: count() })
      .from(transactions)
      .where(isNull(transactions.deletedAt));
    return c.json({ ok: true, ...row });
  });

  // Who the Worker thinks you are: the first thing to check after deploying.
  app.get("/api/me", (c) => c.json(c.get("user")));

  app.route("/api/summary", summaryRoutes<B>());

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.all("*", async (c) => withCacheHeaders(await c.env.ASSETS.fetch(c.req.raw), new URL(c.req.url).pathname));

  return app;
}
