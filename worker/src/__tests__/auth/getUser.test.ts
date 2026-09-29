/**
 * getUser accepts only a JWT Access signed, for this application, still in
 * date, naming a household user. Tokens are signed with a local key standing
 * in for the team's published one; everything else is the real verification.
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey,
} from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCESS_JWT_HEADER, getUser, type AuthConfig } from "../../auth";
import * as schema from "../../db/schema";
import type { Db } from "../../db/types";
import { emptyDatabase } from "../helpers/db";

const TEAM = "household.cloudflareaccess.com";
const ISSUER = `https://${TEAM}`;
const AUD = "test-audience-tag";
const CONFIG: AuthConfig = { teamDomain: TEAM, aud: AUD };
const APP = "https://expenses.example.com/api/me";

type Key = CryptoKey;

let keys: JWTVerifyGetKey;
let signingKey: Key;
let otherKey: Key;

const sqlite = emptyDatabase();
sqlite.exec(`
  INSERT INTO users (email, display_name, owner_key) VALUES
    ('Alex@Example.com', 'Alex', 'self'),
    ('sam@example.com',  'Sam',  'partner');
`);
const db = drizzle(sqlite, { schema }) as unknown as Db;
afterAll(() => sqlite.close());

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

interface TokenOptions {
  email?: string | null;
  aud?: string;
  iss?: string;
  expiresIn?: string | number;
  key?: Key;
}

async function token(opts: TokenOptions = {}): Promise<string> {
  const claims = opts.email === null ? {} : { email: opts.email ?? "sam@example.com" };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m")
    .sign(opts.key ?? signingKey);
}

function request(headers: Record<string, string> = {}, url = APP): Request {
  return new Request(url, { headers });
}

const withToken = async (opts?: TokenOptions) =>
  request({ [ACCESS_JWT_HEADER]: await token(opts) });

describe("getUser", () => {
  it("returns the household user a valid token names", async () => {
    expect(await getUser(await withToken(), CONFIG, db, { keys })).toEqual({
      ok: true,
      user: { id: 2, email: "sam@example.com", displayName: "Sam", ownerKey: "partner" },
    });
  });

  it("matches the email case-insensitively", async () => {
    const result = await getUser(await withToken({ email: "alex@example.COM" }), CONFIG, db, { keys });
    expect(result).toMatchObject({ ok: true, user: { displayName: "Alex" } });
  });

  it("accepts a team domain written with a scheme and trailing slash", async () => {
    const config = { ...CONFIG, teamDomain: `https://${TEAM}/` };
    expect(await getUser(await withToken(), config, db, { keys })).toMatchObject({ ok: true });
  });

  it("rejects a request with no token", async () => {
    expect(await getUser(request(), CONFIG, db, { keys }))
      .toMatchObject({ ok: false, status: 401 });
  });

  it("ignores the identity header Access also sends", async () => {
    const spoofed = request({ "Cf-Access-Authenticated-User-Email": "sam@example.com" });
    expect(await getUser(spoofed, CONFIG, db, { keys }))
      .toMatchObject({ ok: false, status: 401 });
  });

  // Functions, because the keys only exist once beforeAll has run.
  it.each<[string, () => TokenOptions]>([
    ["signed by another key", () => ({ key: otherKey })],
    ["for another application", () => ({ aud: "someone-elses-app" })],
    ["from another team", () => ({ iss: "https://intruder.cloudflareaccess.com" })],
    ["expired", () => ({ expiresIn: Math.floor(Date.now() / 1000) - 60 })],
  ])("rejects a token %s", async (_label, opts) => {
    const req = await withToken(opts());
    expect(await getUser(req, CONFIG, db, { keys })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects garbage in the token header", async () => {
    const req = request({ [ACCESS_JWT_HEADER]: "not.a.jwt" });
    expect(await getUser(req, CONFIG, db, { keys })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects an unsigned token", async () => {
    const [, payload] = (await token()).split(".");
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const req = request({ [ACCESS_JWT_HEADER]: `${header}.${payload}.` });
    expect(await getUser(req, CONFIG, db, { keys })).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses someone Access admitted who is not a household user", async () => {
    const req = await withToken({ email: "stranger@example.com" });
    expect(await getUser(req, CONFIG, db, { keys })).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a token with no email, such as a service token", async () => {
    const req = await withToken({ email: null });
    expect(await getUser(req, CONFIG, db, { keys })).toMatchObject({ ok: false, status: 403 });
  });

  it.each([
    ["team domain", { teamDomain: "" }],
    ["audience", { aud: " " }],
  ])("fails closed when the %s is not configured", async (_label, override) => {
    const req = await withToken();
    expect(await getUser(req, { ...CONFIG, ...override }, db, { keys }))
      .toMatchObject({ ok: false, status: 500 });
  });

  describe("local development user", () => {
    const dev: AuthConfig = { teamDomain: "", aud: "", devUserEmail: "alex@example.com" };

    it.each(["http://localhost:8787/api/me", "http://127.0.0.1:8787/api/me"])(
      "acts as the dev user on %s",
      async (url) => {
        expect(await getUser(request({}, url), dev, db, { keys }))
          .toMatchObject({ ok: true, user: { displayName: "Alex" } });
      },
    );

    it("is ignored anywhere but localhost", async () => {
      expect(await getUser(request(), dev, db, { keys }))
        .toMatchObject({ ok: false, status: 500 });
      expect(await getUser(await withToken(), { ...CONFIG, devUserEmail: "alex@example.com" }, db, { keys }))
        .toMatchObject({ ok: true, user: { displayName: "Sam" } });
    });
  });
});
