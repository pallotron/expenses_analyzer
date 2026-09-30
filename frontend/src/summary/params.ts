/**
 * The Summary's view lives in the URL, so back/forward, reload and a link sent
 * to the other household member all show the same thing. A hand-edited value
 * that makes no sense falls back to its default rather than failing.
 */

export interface SummaryParams {
  /** Null: the newest year with data. */
  year: number | null;
  /** 1–12, or null for the whole year. */
  month: number | null;
  /** Undefined: every source. []: none. */
  sources: string[] | undefined;
  hidden: boolean;
}

export function parseParams(sp: URLSearchParams): SummaryParams {
  const year = sp.get("year");
  const month = Number(sp.get("month"));
  const raw = sp.getAll("sources");
  return {
    year: year && /^\d{4}$/.test(year) ? Number(year) : null,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    sources: raw.length === 0 ? undefined : raw.filter((s) => s !== ""),
    hidden: sp.get("hidden") === "1",
  };
}

export function toSearchParams(p: SummaryParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.year !== null) sp.set("year", String(p.year));
  if (p.month !== null) sp.set("month", String(p.month));
  if (p.sources !== undefined) {
    if (p.sources.length === 0) sp.append("sources", "");
    for (const s of p.sources) sp.append("sources", s);
  }
  if (p.hidden) sp.set("hidden", "1");
  return sp;
}

export function summaryApiPath(p: SummaryParams & { year: number }): string {
  return `/api/summary?${toSearchParams(p)}`;
}
