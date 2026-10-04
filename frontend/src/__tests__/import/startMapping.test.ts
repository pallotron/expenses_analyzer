import { describe, expect, it } from "vitest";

import { guessMapping, startMapping } from "../../import/startMapping";

const card = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"];
const bank = ["Date", "Description", "Money In (€)", "Money Out (€)", "Balance (€)"];

describe("guessMapping", () => {
  it("guesses a signed-amount export", () => {
    expect(guessMapping(card)).toEqual({
      date: "Started Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy",
    });
  });

  it("guesses separate money in and out columns", () => {
    expect(guessMapping(bank)).toEqual({
      date: "Date", merchant: "Description", amount: "Money In (€)", amountOut: "Money Out (€)",
      typeMode: "auto", dateOrder: "dmy",
    });
  });

  it("leaves a field blank when nothing looks right", () => {
    expect(guessMapping(["When", "Who", "How much"])).toMatchObject({ date: "", merchant: "", amount: "" });
  });
});

describe("startMapping", () => {
  const saved = { date: "Completed Date", merchant: "Description", amount: "Amount", typeMode: "auto" as const,
    dateOrder: "dmy" as const, filter: { column: "State", value: "COMPLETED" } };

  it("uses a saved mapping that fits", () => {
    expect(startMapping(card, saved)).toEqual({ mapping: saved, fits: true, missing: [] });
  });

  it("keeps what still matches and names what is missing", () => {
    const renamed = card.map((c) => (c === "Completed Date" ? "Date Completed" : c));
    const result = startMapping(renamed, saved);
    expect(result.fits).toBe(false);
    expect(result.missing).toEqual(["Completed Date"]);
    expect(result.mapping).toMatchObject({ date: "Started Date", merchant: "Description", amount: "Amount", filter: saved.filter });
  });

  it("guesses when there is no saved mapping", () => {
    expect(startMapping(bank)).toEqual({ mapping: guessMapping(bank), fits: false, missing: [] });
  });
});
