import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Controls that stay frozen under the sticky top bar from the md breakpoint up.
 * A zero-size sentinel just before the panel tells when the page has scrolled
 * under it, and only then is the soft shadow shown.
 */
export function StickyPanel(props: { children: ReactNode; label: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 0;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: `-${Math.round(bar)}px 0px 0px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Absolute, so it takes no slot (and no gap) in the page's flex column. */}
      <div ref={sentinel} aria-hidden="true" className="pointer-events-none absolute h-px w-px" />
      <div role="region" aria-label={props.label} data-stuck={stuck ? "true" : "false"}
        className="-mx-4 flex flex-col gap-4 bg-white px-4 dark:bg-slate-950 md:sticky md:top-[var(--topbar-h,0px)] md:z-[25] md:pb-3 data-[stuck=true]:md:shadow-[0_8px_12px_-10px_rgba(15,23,42,0.25)]">
        {props.children}
      </div>
    </>
  );
}
