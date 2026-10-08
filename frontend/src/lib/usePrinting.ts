import { useEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/**
 * True while the browser prints, so a page can render what the screen hides
 * behind tabs, pages and phone layouts. Driven by beforeprint/afterprint, not
 * by a button, so the browser's own Print menu gives the same output. The
 * update is flushed synchronously: the browser lays out the printout as soon
 * as beforeprint returns.
 */
let printing = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (printing === next) return;
  printing = next;
  flushSync(() => listeners.forEach((l) => l()));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => set(true));
  window.addEventListener("afterprint", () => set(false));
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** `title` becomes the document title while printing: the browser's suggested PDF name. */
export function usePrinting(title?: string): boolean {
  useEffect(() => {
    if (!title) return;
    let saved: string | null = null;
    // A second beforeprint must not save the print title as the one to restore.
    const before = () => { saved ??= document.title; document.title = title; };
    const after = () => { if (saved !== null) document.title = saved; saved = null; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      after();
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [title]);
  return useSyncExternalStore(subscribe, () => printing, () => false);
}
