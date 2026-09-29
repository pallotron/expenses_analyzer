/**
 * Replays tools/crosscheck/vectors.py's record of the Python's answers.
 * Regenerate that file when the Python changes; CI fails if it is stale.
 */

import { describe, expect, it } from "vitest";

import {
  compileAliases, normalizeMerchantName, resolveMerchantName,
} from "../../domain/merchants";
import { parseAmountCents } from "../../domain/money";
import * as tags from "../../domain/tags";
import rawVectors from "../fixtures/python_vectors.json";

type Pair<A, B> = [A, B];
type Cell = string | null;

/** JSON import types mixed tuples too loosely; this is the file's real shape. */
const vectors = rawVectors as unknown as {
  normalizeMerchantName: Pair<string, string>[];
  aliases: { rules: Pair<string, string>[]; cases: Pair<string, string>[] };
  amountCents: Pair<string, number>[];
  tags: {
    normalizeTag: Pair<string, string>[];
    parseTags: Pair<Cell, string[]>[];
    joinTags: Pair<string[], string>[];
    addTags: [Cell, string[], string][];
    removeTags: [Cell, string[], string][];
    normalizePattern: Pair<string, string>[];
    isValidPattern: Pair<string, boolean>[];
    cellMatchesPatterns: [Cell, string[], boolean][];
  };
};

describe("merchant names match the Python", () => {
  it.each(vectors.normalizeMerchantName)("normalize %j -> %j", (input, expected) => {
    expect(normalizeMerchantName(input)).toBe(expected);
  });

  const invalid: string[] = [];
  const aliases = compileAliases(
    vectors.aliases.rules.map(([pattern, canonicalName]) => ({ pattern, canonicalName })),
    (pattern) => invalid.push(pattern),
  );

  it("skips the pattern Python could not compile, and only that one", () => {
    expect(invalid).toEqual(["[invalid"]);
  });

  it.each(vectors.aliases.cases)("resolve %j -> %j", (input, expected) => {
    expect(resolveMerchantName(input, aliases)).toBe(expected);
  });
});

describe("amounts are stored as the Python stored them", () => {
  it.each(vectors.amountCents)("%j -> %i cents", (input, expected) => {
    expect(parseAmountCents(input)).toBe(expected);
  });
});

describe("tag helpers match expenses/tags.py", () => {
  const t = vectors.tags;
  it.each(t.normalizeTag)("normalizeTag %j -> %j", (input, expected) => {
    expect(tags.normalizeTag(input)).toBe(expected);
  });
  it.each(t.parseTags)("parseTags %j -> %j", (input, expected) => {
    expect(tags.parseTags(input)).toEqual(expected);
  });
  it.each(t.joinTags)("joinTags %j -> %j", (input, expected) => {
    expect(tags.joinTags(input)).toBe(expected);
  });
  it.each(t.addTags)("addTags %j + %j -> %j", (cell, add, expected) => {
    expect(tags.addTagsToCell(cell, add)).toBe(expected);
  });
  it.each(t.removeTags)("removeTags %j - %j -> %j", (cell, remove, expected) => {
    expect(tags.removeTagsFromCell(cell, remove)).toBe(expected);
  });
  it.each(t.normalizePattern)("normalizePattern %j -> %j", (input, expected) => {
    expect(tags.normalizePattern(input)).toBe(expected);
  });
  it.each(t.isValidPattern)("isValidPattern %j -> %j", (input, expected) => {
    expect(tags.isValidPattern(input)).toBe(expected);
  });
  it.each(t.cellMatchesPatterns)("cellMatchesPatterns %j %j -> %j", (cell, patterns, expected) => {
    expect(tags.cellMatchesPatterns(cell, patterns)).toBe(expected);
  });
});
