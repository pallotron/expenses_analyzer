import { describe, expect, it } from "vitest";

import { activeFilterCount, parseTxParams, shiftMonth, toTxSearch, transactionsApiPath, wholeMonth } from "../../transactions/params";

const parse = (qs: string) => parseTxParams(new URLSearchParams(qs));

describe("parseTxParams", () => {
  it("reads every filter and the sort", () => {
    expect(parse('from=2026-09-01&to=2026-09-30&merchant=tes&category="Groceries"&tags=gift&min=1&max=2.5&type=income&budget=essential&sources=Card&sources=Bank%20A&excludeHidden=1&sort=amount&dir=asc'))
      .toEqual({ from: "2026-09-01", to: "2026-09-30", merchant: "tes", category: '"Groceries"', tags: "gift", min: "1", max: "2.5",
        type: "income", budget: "essential", sources: ["Card", "Bank A"], excludeHidden: true, sort: "amount", dir: "asc" });
  });
  it("drops malformed values instead of failing", () => {
    expect(parse("from=soon&min=ten&type=refund&budget=x&sort=colour&dir=up"))
      .toEqual({ excludeHidden: false, sort: "date", dir: "desc" });
  });
  it("ignores a stale sort=type now that the column is gone", () => {
    expect(parse("sort=type").sort).toBe("date");
  });
  it("keeps an explicit empty source list", () => {
    expect(parse("sources=").sources).toEqual([]);
  });
});

describe("toTxSearch / transactionsApiPath", () => {
  it("round-trips, writing sort only when not the default", () => {
    const p = parse('from=2026-09-01&category="A & B"&sources=&sort=merchant&dir=asc');
    expect(parseTxParams(toTxSearch(p))).toEqual(p);
    expect(toTxSearch(parse("from=2026-09-01")).toString()).toBe("from=2026-09-01");
  });
  it("leaves the sort out of the API path", () => {
    expect(transactionsApiPath(parse("type=income&sort=amount"))).toBe("/api/transactions?type=income");
  });
});

describe("wholeMonth / shiftMonth", () => {
  it("recognises a calendar month", () => {
    expect(wholeMonth(parse("from=2026-02-01&to=2026-02-28"))).toEqual({ year: 2026, month: 2 });
    expect(wholeMonth(parse("from=2026-02-01&to=2026-02-27"))).toBeNull();
    expect(wholeMonth(parse("from=2026-01-01&to=2026-12-31"))).toBeNull();
  });
  it("steps across a year boundary and keeps other filters", () => {
    const next = shiftMonth(parse("from=2025-12-01&to=2025-12-31&merchant=x"), 1);
    expect(next).toMatchObject({ from: "2026-01-01", to: "2026-01-31", merchant: "x" });
    expect(shiftMonth(parse("from=2026-01-01&to=2026-01-31"), -1)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("activeFilterCount", () => {
  it("counts filters other than the dates", () => {
    expect(activeFilterCount(parse("from=2026-01-01&to=2026-01-31"))).toBe(0);
    expect(activeFilterCount(parse("merchant=a&min=1&max=2&sources=Card&excludeHidden=1&type=expense"))).toBe(6);
  });
});
