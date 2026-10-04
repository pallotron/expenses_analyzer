import { describe, expect, it } from "vitest";

import type { TransactionType } from "../../api/transactions";
import {
  categoryGuidance, geminiPrompt, GeminiResponseError, parseGeminiResponse,
} from "../../domain/gemini";
import rawVectors from "../fixtures/python_vectors.json";

const vectors = (rawVectors as unknown as {
  gemini: {
    guidance: [string[], TransactionType, string][];
    prompts: [string[], string, TransactionType, string][];
    parse: [string, Record<string, string>][];
  };
}).gemini;

describe("Gemini prompt and parsing match the Python", () => {
  it.each(vectors.guidance)("guidance for %j (%s)", (categories, type, expected) => {
    expect(categoryGuidance(categories, type)).toBe(expected);
  });

  it.each(vectors.prompts)("prompt for %j", (names, guidance, type, expected) => {
    expect(geminiPrompt(names, guidance, type)).toBe(expected);
  });

  it.each(vectors.parse)("parses %j", (text, expected) => {
    expect(parseGeminiResponse(text, Object.keys(expected))).toEqual(expected);
  });
});

describe("parseGeminiResponse beyond the Python", () => {
  it("keeps only names that were asked", () => {
    expect(parseGeminiResponse('{"Corner Shop": "Groceries", "Other Shop": "Fuel"}', ["Corner Shop"]))
      .toEqual({ "Corner Shop": "Groceries" });
  });

  it("matches an echoed name ignoring case and surrounding spaces, keeping the asked spelling", () => {
    expect(parseGeminiResponse('{" cafe ONE ": "Eating out"}', ["Cafe One"])).toEqual({ "Cafe One": "Eating out" });
  });

  it("keeps the first answer when two keys map to one asked name", () => {
    expect(parseGeminiResponse('{"Cafe One": "Eating out", "cafe one": "Coffee"}', ["Cafe One"]))
      .toEqual({ "Cafe One": "Eating out" });
  });

  it("answers two names that differ only by case each with its own value", () => {
    expect(parseGeminiResponse('{"AMAZON": "Shopping", "Amazon": "Books"}', ["AMAZON", "Amazon"]))
      .toEqual({ AMAZON: "Shopping", Amazon: "Books" });
  });

  it("gives an inexact answer to the first matching asked name only", () => {
    expect(parseGeminiResponse('{"amazon ": "Shopping"}', ["AMAZON", "Amazon"])).toEqual({ AMAZON: "Shopping" });
  });

  it("copes with asked names that are Object.prototype keys", () => {
    expect(parseGeminiResponse('{"constructor": "Fuel"}', ["constructor"])).toEqual({ constructor: "Fuel" });
  });

  it("trims categories and drops blank, non-string and Uncategorized answers", () => {
    expect(parseGeminiResponse(
      '{"A": "  Fuel ", "B": "", "C": 3, "D": null, "E": "uncategorized", "F": "UNCATEGORIZED "}',
      ["A", "B", "C", "D", "E", "F"],
    )).toEqual({ A: "Fuel" });
  });

  it.each(['["Groceries"]', '"Groceries"', "null", "not json at all"])("rejects %j", (text) => {
    expect(() => parseGeminiResponse(text, ["A"])).toThrow(GeminiResponseError);
  });
});
