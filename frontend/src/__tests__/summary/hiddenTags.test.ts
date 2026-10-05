import { describe, expect, it } from "vitest";

import { hiddenText, patternOptions } from "../../summary/hiddenTags";

describe("patternOptions", () => {
  it("lists namespaces, then tags in use, then stale patterns, ticking the excluded ones", () => {
    expect(patternOptions(["emergency", "trip:paris", "trip:rome", "work:x"], ["trip:*", "gone", "emergency"])).toEqual([
      { pattern: "trip:*", ticked: true },
      { pattern: "work:*", ticked: false },
      { pattern: "emergency", ticked: true },
      { pattern: "trip:paris", ticked: false },
      { pattern: "trip:rome", ticked: false },
      { pattern: "work:x", ticked: false },
      { pattern: "gone", ticked: true },
    ]);
  });

  it("lists each pattern once", () => {
    expect(patternOptions(["a", "a"], ["a", "a"])).toEqual([{ pattern: "a", ticked: true }]);
  });

  it("is empty with no tags and no patterns", () => {
    expect(patternOptions([], [])).toEqual([]);
  });
});

describe("hiddenText", () => {
  it.each([
    [0, 0, "nothing hidden"],
    [113_110, 0, "€1,131.10 expenses hidden"],
    [0, 9_063_334, "€90,633.34 income hidden"],
    [5_000, 90_000, "€50.00 expenses and €900.00 income hidden"],
  ])("says %i expense and %i income cents as %j", (expense, income, text) => {
    expect(hiddenText(expense, income)).toBe(text);
  });
});
