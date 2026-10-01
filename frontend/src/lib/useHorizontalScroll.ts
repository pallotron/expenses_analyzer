import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface HorizontalScroll {
  ref: RefObject<HTMLDivElement | null>;
  /** Content is hidden off the left / right edge. */
  canLeft: boolean;
  canRight: boolean;
  /** Scroll by `pixels` (negative: left), smoothly unless reduced motion is asked for. */
  scrollBy: (pixels: number) => void;
}

/**
 * Tracks which way a horizontally scrolling box can still go, and starts it at
 * its right end, so a table of months opens on the latest ones. `resetKey`
 * changing (new data) jumps back to the right end.
 */
export function useHorizontalScroll(resetKey: unknown): HorizontalScroll {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ canLeft: false, canRight: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack: zoomed pages report fractional widths.
    const canLeft = el.scrollLeft > 1;
    const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.canLeft === canLeft && e.canRight === canRight ? e : { canLeft, canRight }));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    update();
  }, [resetKey, update]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [update]);

  const scrollBy = useCallback((pixels: number) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollBy({ left: pixels, behavior: reduce ? "auto" : "smooth" });
  }, []);

  return { ref, ...edges, scrollBy };
}
