import { useQuery } from "@tanstack/react-query";
import { getJson } from "./lib/api";

/**
 * Cloudflare Access serves this on every protected hostname: it ends the Access
 * session, so the next visit goes back through the login page.
 */
export const LOGOUT_PATH = "/cdn-cgi/access/logout";

/** What /api/me returns that the bar shows. */
interface Me {
  email: string;
  displayName: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * App name, who is signed in, and a sign-out link. Local development has no
 * Access in front of it, so there is nothing to sign out of there.
 */
export function TopBar(props: { hostname?: string }) {
  const hostname = props.hostname ?? window.location.hostname;
  const me = useQuery({ queryKey: ["me"], queryFn: () => getJson<Me>("/api/me"), staleTime: Infinity });

  return (
    <nav className="border-b border-slate-200 dark:border-slate-800">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm">
        <span className="font-semibold">Expenses</span>
        <span className="flex min-w-0 items-center gap-3">
          {me.data && (
            <span className="truncate text-slate-600 dark:text-slate-400" title={me.data.email}>
              <span className="hidden sm:inline">Signed in as </span>{me.data.displayName}
            </span>
          )}
          {!LOCAL_HOSTS.has(hostname) && (
            <a href={LOGOUT_PATH} className="shrink-0 underline">Sign out</a>
          )}
        </span>
      </div>
    </nav>
  );
}
