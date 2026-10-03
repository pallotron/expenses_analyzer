import { describe, expect, it } from "vitest";
import type { MerchantRow } from "../../lib/types";
import { filterMerchants, parseMerchantParams, sortMerchants, toMerchantSearch } from "../../merchants/params";

const m = (id: number, name: string, over: Partial<MerchantRow> = {}): MerchantRow => ({
  id, name, category: "Groceries", budget: "essential", suggested: false, count: 1,
  totalCents: -100, lastDate: "2026-09-01", type: "expense", rules: [], ...over,
});

describe("merchant params", () => {
  it("round-trips, dropping defaults and nonsense", () => {
    const p = parseMerchantParams(new URLSearchParams("q=cafe&attention=uncategorized&type=income&sort=name&dir=asc&bogus=1"));
    expect(p).toEqual({ q: "cafe", attention: "uncategorized", type: "income", sort: "name", dir: "asc" });
    expect(toMerchantSearch(p).toString()).toBe("q=cafe&attention=uncategorized&type=income&sort=name&dir=asc");
    expect(parseMerchantParams(new URLSearchParams("sort=nope&attention=x"))).toEqual({ sort: "total", dir: "desc" });
    expect(toMerchantSearch({ sort: "total", dir: "desc" }).toString()).toBe("");
  });

  it("filters by name, category, attention and type", () => {
    const rows = [m(1, "Corner Shop"), m(2, "Cafe One", { category: null }), m(3, "Pay", { type: "income", suggested: true })];
    const ids = (p: Parameters<typeof filterMerchants>[1]) => filterMerchants(rows, p).map((r) => r.id);
    const base = { sort: "total", dir: "desc" } as const;
    expect(ids({ ...base, q: "CAFE" })).toEqual([2]);
    expect(ids({ ...base, category: "Groceries" })).toEqual([1, 3]);
    expect(ids({ ...base, attention: "uncategorized" })).toEqual([2]);
    expect(ids({ ...base, attention: "suggested" })).toEqual([3]);
    expect(ids({ ...base, type: "income" })).toEqual([3]);
  });

  it("sorts total by size, nulls last, ties by name", () => {
    const rows = [m(1, "B", { totalCents: -500 }), m(2, "A", { totalCents: 900 }), m(3, "C", { totalCents: -500, lastDate: null })];
    expect(sortMerchants(rows, "total", "desc").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortMerchants(rows, "last", "asc").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortMerchants(rows, "last", "desc").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortMerchants(rows, "name", "asc").map((r) => r.id)).toEqual([2, 1, 3]);
  });
});
