/**
 * Who is making this request. The only place identity is decided.
 *
 * Cloudflare Access sits in front of the Worker, logs people in, and forwards
 * each request with a signed JWT in `Cf-Access-Jwt-Assertion`. This verifies
 * that JWT's signature against the team's published keys, and its issuer,
 * audience and expiry, then maps the email claim to a household user.
 *
 * Never read `Cf-Access-Authenticated-User-Email` or any other identity
 * header: anything that reaches the Worker without passing Access (a
 * misconfigured route, workers.dev) can set those freely. Only the signature
 * proves Access issued the token.
 */

import { sql } from "drizzle-orm";
import {
  createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey,
} from "jose";
import type { Db } from "./db/types";
import { users } from "./db/schema";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

export interface User {
  id: number;
  email: string;
  displayName: string;
  ownerKey: string;
}

export interface AuthConfig {
  /** e.g. "yourteam.cloudflareaccess.com". Scheme optional. */
  teamDomain: string;
  /** The Access application's audience tag. */
  aud: string;
  /**
   * Local development only: act as this user without a JWT. Honoured only
   * when the request is for localhost, so setting it in production does
   * nothing. Lives in worker/.dev.vars, which is gitignored.
   */
  devUserEmail?: string;
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403 | 500; reason: string };

/** Overridable in tests, which sign with a local key instead. */
export interface AuthDeps {
  keys?: JWTVerifyGetKey;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function issuerFor(teamDomain: string): string {
  const host = teamDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}`;
}

/*
 * One key set per team domain for the life of the isolate. jose caches the
 * fetched keys and refetches on an unknown key id, which covers rotation.
 */
const keySets = new Map<string, JWTVerifyGetKey>();

function remoteKeys(issuer: string): JWTVerifyGetKey {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  return keys;
}

async function findUser(db: Db, email: string): Promise<User | undefined> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      ownerKey: users.ownerKey,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user;
}

async function resolve(db: Db, email: string): Promise<AuthResult> {
  const user = await findUser(db, email);
  if (!user) {
    // Access let them in, but they are not one of the household's users.
    return { ok: false, status: 403, reason: "not a known user" };
  }
  return { ok: true, user };
}

export async function getUser(
  request: Request,
  config: AuthConfig,
  db: Db,
  deps: AuthDeps = {},
): Promise<AuthResult> {
  if (config.devUserEmail && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return resolve(db, config.devUserEmail);
  }

  // Fail closed. An empty audience would make jose skip the aud check.
  if (!config.teamDomain.trim() || !config.aud.trim()) {
    return { ok: false, status: 500, reason: "Access is not configured" };
  }

  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) {
    return { ok: false, status: 401, reason: "no Access token" };
  }

  const issuer = issuerFor(config.teamDomain);
  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, deps.keys ?? remoteKeys(issuer), {
      issuer,
      audience: config.aud,
      algorithms: ["RS256"],
    });
    email = payload.email;
  } catch (err) {
    if (err instanceof errors.JOSEError) {
      return { ok: false, status: 401, reason: `invalid Access token (${err.code})` };
    }
    throw err;
  }

  // Service tokens carry no email; nothing here is meant to accept them.
  if (typeof email !== "string" || !email) {
    return { ok: false, status: 403, reason: "Access token has no email" };
  }
  return resolve(db, email);
}
