import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's md breakpoint: at or above it is the desktop layout. */
export const DESKTOP = "(min-width: 768px)";

export function useMediaQuery(query: string): boolean {
  // Stable per query: a new function every render would resubscribe on every render.
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}
