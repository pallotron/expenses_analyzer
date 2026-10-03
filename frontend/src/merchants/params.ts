import type { MerchantRow, TransactionType } from "../lib/types";

export const MERCHANT_SORTS = ["name", "category", "budget", "count", "total", "last", "rules"] as const;
export type MerchantSort = (typeof MERCHANT_SORTS)[number];

export interface MerchantParams {
  q?: string; category?: string; attention?: "uncategorized" | "suggested"; type?: TransactionType;
  sort: MerchantSort; dir: "asc" | "desc";
}

export function parseMerchantParams(sp: URLSearchParams): MerchantParams {
  const sort = sp.get("sort");
  const p: MerchantParams = {
    sort: (MERCHANT_SORTS as readonly string[]).includes(sort ?? "") ? (sort as MerchantSort) : "total",
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
  };
  const q = sp.get("q")?.trim();
  if (q) p.q = q;
  const category = sp.get("category");
  if (category) p.category = category;
  const attention = sp.get("attention");
  if (attention === "uncategorized" || attention === "suggested") p.attention = attention;
  const type = sp.get("type");
  if (type === "expense" || type === "income") p.type = type;
  return p;
}

export function toMerchantSearch(p: MerchantParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.category) sp.set("category", p.category);
  if (p.attention) sp.set("attention", p.attention);
  if (p.type) sp.set("type", p.type);
  if (p.sort !== "total" || p.dir !== "desc") { sp.set("sort", p.sort); sp.set("dir", p.dir); }
  return sp;
}

export function filterMerchants(rows: MerchantRow[], p: MerchantParams): MerchantRow[] {
  const q = p.q?.toLowerCase();
  return rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q)) &&
    (!p.category || r.category === p.category) &&
    (p.attention !== "uncategorized" || r.category === null) &&
    (p.attention !== "suggested" || r.suggested) &&
    (!p.type || r.type === p.type));
}

function compare(a: MerchantRow, b: MerchantRow, sort: MerchantSort): number {
  switch (sort) {
    case "count": return a.count - b.count;
    case "total": return Math.abs(a.totalCents) - Math.abs(b.totalCents);
    case "rules": return a.rules.length - b.rules.length;
    case "category": return (a.category ?? "").localeCompare(b.category ?? "");
    case "budget": return a.budget.localeCompare(b.budget);
    default: return a.name.localeCompare(b.name);
  }
}

export function sortMerchants(rows: MerchantRow[], sort: MerchantSort, dir: "asc" | "desc"): MerchantRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === "last") {
      // Merchants with no live rows go last whichever way the dates run.
      if (a.lastDate === null || b.lastDate === null) {
        if (a.lastDate !== b.lastDate) return a.lastDate === null ? 1 : -1;
      } else if (a.lastDate !== b.lastDate) return sign * a.lastDate.localeCompare(b.lastDate);
      return a.name.localeCompare(b.name);
    }
    return sign * compare(a, b, sort) || a.name.localeCompare(b.name);
  });
}
