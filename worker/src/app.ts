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
import { budgetTypeRoutes } from "./routes/budgetTypes";
import { payslipRoutes } from "./routes/payslips";
import { summaryRoutes } from "./routes/summary";
import { transactionRoutes } from "./routes/transactions";
import { merchantRoutes } from "./routes/merchants";
import { importRoutes } from "./routes/import";
import { transactionEditRoutes } from "./routes/transactionEdits";

export interface AppBindings {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  /** Local development only, from worker/.dev.vars. See AuthConfig. */
  DEV_USER_EMAIL?: string;
  /** Secret. Unset: the Merchants page hides "Suggest categories". */
  GEMINI_API_KEY?: string;
  /** Defaults to DEFAULT_GEMINI_MODEL. */
  GEMINI_MODEL?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export type AppEnv<B extends AppBindings> = { Bindings: B; Variables: { user: User; db: Db } };

/**
 * Hashed build output can be cached forever; anything else must be revalidated.
 * With single-page-application fallback, a missing /assets/ file comes back as
 * 200 index.html, so an HTML body is never treated as immutable build output.
 */
export function withCacheHeaders(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  const html = (res.headers.get("content-type") ?? "").includes("text/html");
  out.headers.set(
    "Cache-Control",
    res.ok && path.startsWith("/assets/") && !html ? "public, max-age=31536000, immutable" : "no-store",
  );
  return out;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Writes must come from the app's own pages. Access authenticates by cookie,
 * which a browser also sends with a form posted from another site; that
 * site cannot set Origin to ours. Browsers send Origin on every non-GET
 * fetch, so a missing one is refused too. Locally, the Vite dev server on
 * another port proxies to the Worker, so any local origin may write to a
 * local Worker.
 */
export function sameOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  let from: URL;
  try { from = new URL(origin); } catch { return false; }
  const to = new URL(requestUrl);
  if (from.origin === to.origin) return true;
  return LOCAL.has(from.hostname) && LOCAL.has(to.hostname);
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
      return c.body(null, result.status, { "Cache-Control": "no-store" });
    }
    c.set("user", result.user);
    c.set("db", db);
    await next();
  });

  // Per-user data: never cached by the browser or an intermediary.
  app.use("/api/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c.req.header("origin") ?? null, c.req.url)) {
      return c.json({ error: "Cross-site request refused" }, 403);
    }
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
  app.route("/api", transactionRoutes<B>());
  app.route("/api", transactionEditRoutes<B>());
  app.route("/api", merchantRoutes<B>());
  app.route("/api", importRoutes<B>());
  app.route("/api", budgetTypeRoutes<B>());
  app.route("/api", payslipRoutes<B>());

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.all("*", async (c) => withCacheHeaders(await c.env.ASSETS.fetch(c.req.raw), new URL(c.req.url).pathname));

  return app;
}
