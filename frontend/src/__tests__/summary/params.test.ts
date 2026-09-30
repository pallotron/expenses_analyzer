import { describe, expect, it } from "vitest";
import { parseParams, summaryApiPath, toSearchParams } from "../../summary/params";

const parse = (qs: string) => parseParams(new URLSearchParams(qs));

describe("parseParams", () => {
  it("reads a full view", () => {
    expect(parse("year=2026&month=3&sources=Card&sources=Bank%20A&hidden=1"))
      .toEqual({ year: 2026, month: 3, sources: ["Card", "Bank A"], hidden: true });
  });
  it("defaults everything", () => {
    expect(parse("")).toEqual({ year: null, month: null, sources: undefined, hidden: false });
  });
  it("tells no sources apart from all sources", () => {
    expect(parse("sources=").sources).toEqual([]);
    expect(parse("").sources).toBeUndefined();
  });
  it("falls back instead of failing on a hand-edited URL", () => {
    expect(parse("year=abc&month=13&hidden=yes")).toEqual({ year: null, month: null, sources: undefined, hidden: false });
    expect(parse("year=2026&month=0").month).toBeNull();
  });
});

describe("round trip", () => {
  it.each([
    { year: 2026, month: 3, sources: ["O'Brien, Ltd", "Card"], hidden: true },
    { year: 2025, month: null, sources: [], hidden: false },
    { year: 2025, month: null, sources: undefined, hidden: false },
  ])("%j", (p) => {
    expect(parseParams(toSearchParams(p))).toEqual(p);
  });
});

describe("summaryApiPath", () => {
  it("builds the API query with repeated sources", () => {
    expect(summaryApiPath({ year: 2026, month: null, sources: ["a,b", "c"], hidden: true }))
      .toBe("/api/summary?year=2026&sources=a%2Cb&sources=c&hidden=1");
    expect(summaryApiPath({ year: 2026, month: 2, sources: [], hidden: false }))
      .toBe("/api/summary?year=2026&month=2&sources=");
  });
});
