/**
 * Fetching from the Worker. Access sits in front of it: when the Access
 * session lapses, requests are redirected to the login page, which a fetch
 * cannot follow across origins. So redirects are not followed, and a redirect
 * or a 401 reloads the page, which takes the browser through the login. A 403
 * means the login worked but the email is not a household user; reloading would
 * loop, so it is reported instead.
 */

export const NOT_SET_UP = "This account is not set up for the household.";
const REAUTH_KEY = "reauth-at";
const REAUTH_WINDOW_MS = 30_000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Indirection so tests can observe a reload; jsdom's location is not replaceable. */
export const page = { reload: () => window.location.reload() };

function reauthenticate(): void {
  let last = 0;
  try { last = Number(sessionStorage.getItem(REAUTH_KEY) ?? 0); } catch { /* storage blocked */ }
  if (Date.now() - last < REAUTH_WINDOW_MS) return; // just tried; don't loop
  try { sessionStorage.setItem(REAUTH_KEY, String(Date.now())); } catch { /* storage blocked */ }
  page.reload();
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { redirect: "manual", headers: { Accept: "application/json" } });
  if (res.type === "opaqueredirect" || res.status === 401) {
    reauthenticate();
    throw new ApiError(401, "Your session has expired. Reloading to sign in again…");
  }
  if (res.status === 403) throw new ApiError(403, NOT_SET_UP);
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
