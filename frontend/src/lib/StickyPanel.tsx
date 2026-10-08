import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Controls that stay frozen under the sticky top bar from the md breakpoint up.
 * A zero-size sentinel just before the panel tells when the page has scrolled
 * under it, and only then is the soft shadow shown. The sentinel sits one top
 * bar height above the panel's own spot (a CSS margin, so a late or changed
 * bar height needs no recomputation). The panel's height is published as
 * --controls-h, so a table header can stick directly under it.
 */
export function StickyPanel(props: { children: ReactNode; label: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = panel.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      document.documentElement.style.setProperty("--controls-h", `${height}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--controls-h");
    };
  }, []);

  return (
    <>
      {/* Absolute, so it takes no slot (and no gap) in the page's flex column. */}
      <div ref={sentinel} aria-hidden="true" className="pointer-events-none absolute h-px w-px"
        style={{ marginTop: "calc(-1 * var(--topbar-h, 0px))" }} />
      <div ref={panel} role="region" aria-label={props.label} data-stuck={stuck ? "true" : "false"}
        className="-mx-4 flex flex-col gap-4 bg-white px-4 dark:bg-slate-950 md:sticky md:top-[var(--topbar-h,0px)] md:z-[25] md:pb-3 data-[stuck=true]:md:shadow-[0_8px_12px_-10px_rgba(15,23,42,0.25)] print:static! print:shadow-none!">
        {props.children}
      </div>
    </>
  );
}
