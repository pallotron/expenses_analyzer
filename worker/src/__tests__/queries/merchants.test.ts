import { describe, expect, it } from "vitest";

import { listMerchants, ruleFor } from "../../queries/merchants";
import { listLookups } from "../../queries/transactions";
import { saveMerchantDecision } from "../../services/merchants";
import { USER, categorise, seed, store } from "../helpers/store";

const rules = [["^CAFE", "Cafe"], ["CAFE\\s+ANNEX", "Cafe"]];

function cafes() {
  const s = store(rules);
  seed(s.sqlite, [
    { date: "2026-04-10", merchant: "CAFE ONE", amount: 4, deleted: false },
    { date: "2026-04-12", merchant: "CAFE TWO", amount: 6, deleted: false },
    { date: "2026-04-20", merchant: "CAFE ONE", amount: 50, deleted: true },
    { date: "2026-04-11", merchant: "EMPLOYER PAY", amount: 1000, deleted: false },
  ], rules);
  s.sqlite.exec(`UPDATE transactions SET type = 'income' WHERE merchant_raw = 'EMPLOYER PAY'`);
  s.sqlite.exec(`INSERT INTO merchants (canonical_name) VALUES ('Unused')`);
  categorise(s.sqlite, { Cafe: "Eating out" });
  s.sqlite.exec(`UPDATE categories SET spending_type = 'essential' WHERE name = 'Eating out'`);
  return s;
}

describe("listMerchants", () => {
  it("counts live rows only, signs totals, and lists rules in priority order", async () => {
    const { sqlite, db } = cafes();
    const list = await listMerchants(db);
    expect(list.map((m) => m.name).sort()).toEqual(["Cafe", "EMPLOYER PAY"]);
    const cafe = list.find((m) => m.name === "Cafe")!;
    expect(cafe).toMatchObject({
      category: "Eating out", budget: "essential", suggested: false,
      count: 2, totalCents: -1000, lastDate: "2026-04-12", type: "expense",
    });
    expect(cafe.rules.map((r) => r.pattern)).toEqual(["^CAFE", "CAFE\\s+ANNEX"]);
    expect(list.find((m) => m.name === "EMPLOYER PAY")).toMatchObject({
      category: null, budget: "discretionary", count: 1, totalCents: 100000, type: "income", rules: [],
    });
    sqlite.close();
  });

  it("keeps a merchant that has a rule but no rows", async () => {
    const { sqlite, db } = cafes();
    sqlite.exec(`INSERT INTO merchant_aliases (pattern, priority, merchant_id) SELECT 'NOTHING', 9, id FROM merchants WHERE canonical_name = 'Unused'`);
    expect((await listMerchants(db)).find((m) => m.name === "Unused"))
      .toMatchObject({ count: 0, totalCents: 0, lastDate: null, rules: [{ pattern: "NOTHING" }] });
    sqlite.close();
  });

  it("a merchant keeps both rules after a pattern is retyped", async () => {
    const { sqlite, db } = cafes();
    await saveMerchantDecision(db, { pattern: "^CAFE\\s", alias: "Cafe" }, USER);
    expect((await listMerchants(db)).find((m) => m.name === "Cafe")!.rules.map((r) => r.pattern))
      .toEqual(["^CAFE", "CAFE\\s+ANNEX", "^CAFE\\s"]);
    sqlite.close();
  });
});

describe("ruleFor", () => {
  it("answers the first matching rule and its merchant", async () => {
    const { sqlite, db } = cafes();
    const found = await ruleFor(db, "CAFE ANNEX 3");
    expect(found).toMatchObject({ merchant: "Cafe", category: "Eating out", rule: { pattern: "^CAFE" } });
    expect(typeof found.rule?.id).toBe("number");
    sqlite.close();
  });

  it("answers no rule, the normalised name, and its category for an unmatched name", async () => {
    const { sqlite, db } = cafes();
    expect(await ruleFor(db, "EMPLOYER PAY 01/04 2")).toEqual({ rule: null, merchant: "EMPLOYER PAY", category: null });
    sqlite.close();
  });
});

describe("lookups", () => {
  it("lists the essential categories", async () => {
    const { sqlite, db } = cafes();
    expect((await listLookups(db)).essentialCategories).toEqual(["Eating out"]);
    sqlite.close();
  });
});
