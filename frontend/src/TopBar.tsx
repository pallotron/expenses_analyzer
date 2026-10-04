import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router";
import { getJson } from "./lib/api";
import { Logo } from "./Logo";

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

  const nav = useRef<HTMLElement>(null);
  // Sticky panels below sit directly under the bar, whose height varies.
  useEffect(() => {
    const el = nav.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      document.documentElement.style.setProperty("--topbar-h", `${height}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--topbar-h");
    };
  }, []);

  return (
    <nav ref={nav} className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 text-sm sm:py-5">
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-3 text-lg font-semibold"><Logo size={32} /><span className="hidden sm:inline">Expenses</span></span>
          {([["/", "Summary"], ["/transactions", "Transactions"], ["/merchants", "Merchants"], ["/import", "Import"]] as const).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}
              className={({ isActive }) => (isActive ? "font-semibold underline" : "text-slate-600 dark:text-slate-400")}>
              {label}
            </NavLink>
          ))}
        </span>
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
