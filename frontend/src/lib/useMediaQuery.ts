import { useSyncExternalStore } from "react";

/** Tailwind's md breakpoint: at or above it is the desktop layout. */
export const DESKTOP = "(min-width: 768px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
