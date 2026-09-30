/**
 * Worker entry point: the Hono app in src/app.ts over D1.
 *
 * Every route is authenticated: getUser (src/auth.ts) verifies the Cloudflare
 * Access JWT before anything touches the database or the static assets. There
 * are no public routes, so a misrouted request that skipped Access still gets
 * nothing.
 */

import { createApp, type AppBindings } from "./app";
import { createDb } from "./db/client";

export interface Env extends AppBindings {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default createApp<Env>((env) => createDb(env.DB)) satisfies ExportedHandler<Env>;
