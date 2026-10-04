import { describe, expect, it } from "vitest";

import { parseDate } from "../../domain/importDates";
import rawVectors from "../fixtures/python_vectors.json";

const dates = (rawVectors as unknown as { import: { dates: [string, string | null][] } }).import.dates;

/** Where the web deliberately reads a date differently from the TUI. */
const KNOWN_DIFFERENCES: Record<string, string> = {
  "01.09.2026": "2026-09-01", // the TUI reads "." month-first
  "1/9/26": "2026-09-01",     // the TUI refuses dates under 8 characters
};

describe("parseDate matches the Python", () => {
  it.each(dates.filter(([raw]) => !(raw in KNOWN_DIFFERENCES)))("%j -> %j", (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });

  it.each(Object.entries(KNOWN_DIFFERENCES))("differs on %j on purpose", (raw, ours) => {
    const python = dates.find(([d]) => d === raw);
    expect(python).toBeDefined();
    expect(python![1]).not.toBe(ours);
    expect(parseDate(raw)).toBe(ours);
  });
});

describe("parseDate beyond the Python", () => {
  it("reads numeric dates month-first when asked", () => {
    expect(parseDate("09/01/2026", "mdy")).toBe("2026-09-01");
    expect(parseDate("13/01/2026", "mdy")).toBeNull();
  });

  it("keeps ISO dates whatever the order", () => {
    expect(parseDate("2026-09-01", "mdy")).toBe("2026-09-01");
  });

  it("trims and rejects impossible days and months", () => {
    expect(parseDate("  01/09/2026  ")).toBe("2026-09-01");
    expect(parseDate("29/02/2025")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29");
    expect(parseDate("01/13/2026")).toBeNull();
    expect(parseDate("12 Foo 2026")).toBeNull();
  });
});
