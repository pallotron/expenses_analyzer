import { describe, expect, it } from "vitest";

import { patternOptions } from "../../summary/hiddenTags";

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
