/**
 * Replays tools/crosscheck/vectors.py's record of the Python's answers.
 * Regenerate that file when the Python changes; CI fails if it is stale.
 */

import { describe, expect, it } from "vitest";

import { applyFilters, parseAmountFilter, type FilterableRow } from "../../domain/filters";
import {
  compileAliases, normalizeMerchantName, patternClaiming, resolveMerchantName,
} from "../../domain/merchants";
import { validateImportRows } from "../../domain/validation";
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
  filters: {
    rows: [string, string, number, string, string, string, string, string][];
    cases: { filter: Record<string, string>; expected: number[] }[];
  };
  validation: {
    maxDate: string;
    cases: { name: string; rows: [string, string, number, string][]; errors: string[] }[];
  };
  merchantEditor: {
    aliases: Pair<string, string>[];
    claiming: Pair<string, string | null>[];
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

describe("filters match the Transactions screen", () => {
  const rows: (FilterableRow & { index: number })[] = vectors.filters.rows.map(
    ([date, merchant, amount, source, category, type, tags, budget], index) => ({
      index, date, merchant, amountCents: Math.round(amount * 100), source, category, type, tags, budget,
    }),
  );

  it.each(vectors.filters.cases.map((c) => [JSON.stringify(c.filter), c] as const))(
    "%s",
    (_label, { filter, expected }) => {
      const result = applyFilters(rows, {
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        merchant: filter.merchant,
        category: filter.category,
        source: filter.source,
        tags: filter.tags,
        type: filter.type as "expense" | "income" | undefined,
        budget: filter.budget as "essential" | "discretionary" | undefined,
        amountMinCents: filter.amountMin === undefined ? undefined : parseAmountFilter(filter.amountMin),
        amountMaxCents: filter.amountMax === undefined ? undefined : parseAmountFilter(filter.amountMax),
      });
      expect(result.map((r) => r.index)).toEqual(expected);
    },
  );
});

describe("import validation reports what validation.py reported", () => {
  it.each(vectors.validation.cases.map((c) => [c.name, c] as const))("%s", (_name, { rows, errors }) => {
    const typed = rows.map(([date, merchant, amount, type]) => ({
      date, merchant, amountCents: Math.round(amount * 100), type,
    }));
    expect(validateImportRows(typed, { maxDate: vectors.validation.maxDate })).toEqual(errors);
  });
});

describe("the rule claiming a merchant matches merchant_editor.pattern_claiming", () => {
  const rules = [
    ...vectors.merchantEditor.aliases.map(([pattern, canonicalName]) => ({ pattern, canonicalName })),
    { pattern: "[invalid", canonicalName: "Never" },
  ];
  it.each(vectors.merchantEditor.claiming)("%j -> %j", (merchant, expected) => {
    expect(patternClaiming(merchant, rules)).toBe(expected);
  });
});
