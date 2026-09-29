/**
 * Worker entry point.
 *
 * Every route is authenticated: getUser (src/auth.ts) verifies the Cloudflare
 * Access JWT before anything touches the database. There are no public routes,
 * so a misrouted request that skipped Access still gets nothing.
 */

import { count, isNull } from "drizzle-orm";
import { getUser, type AuthConfig } from "./auth";
import { createDb } from "./db/client";
import { transactions } from "./db/schema";

export interface Env {
  DB: D1Database;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  /** Local development only, from worker/.dev.vars. See AuthConfig. */
  DEV_USER_EMAIL?: string;
}

function authConfig(env: Env): AuthConfig {
  return {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    aud: env.CF_ACCESS_AUD,
    devUserEmail: env.DEV_USER_EMAIL,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = createDb(env.DB);
    const auth = await getUser(request, authConfig(env), db);
    if (!auth.ok) {
      console.warn(`auth refused (${auth.status}): ${auth.reason}`);
      // The reason stays in the log; the client learns only the status.
      return new Response(null, { status: auth.status });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const [row] = await db
        .select({ transactions: count() })
        .from(transactions)
        .where(isNull(transactions.deletedAt));
      return Response.json({ ok: true, ...row });
    }

    // Who the Worker thinks you are: the first thing to check after deploying.
    if (url.pathname === "/api/me") {
      return Response.json(auth.user);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
