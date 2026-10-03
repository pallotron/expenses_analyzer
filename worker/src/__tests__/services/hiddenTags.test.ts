import { describe, expect, it } from "vitest";

import { createDb } from "../../db/client";
import { buildSummary, setHiddenTagPatterns } from "../../services/summary";
import { fakeD1 } from "../helpers/fakeD1";
import { seed, store } from "../helpers/store";

const patternsOf = (sqlite: ReturnType<typeof store>["sqlite"]) =>
  (sqlite.prepare(`SELECT pattern FROM tag_exclusion_patterns ORDER BY id`).all() as { pattern: string }[])
    .map((r) => r.pattern);

describe("setHiddenTagPatterns", () => {
  it("replaces the list, keeping the order given", async () => {
    const { sqlite, db } = store([]);
    sqlite.exec(`INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency'), ('old')`);
    expect(await setHiddenTagPatterns(db, ["trip:*", "emergency"])).toEqual(["trip:*", "emergency"]);
    expect(patternsOf(sqlite)).toEqual(["trip:*", "emergency"]);
  });

  it("clears the list when given none", async () => {
    const { sqlite, db } = store([]);
    sqlite.exec(`INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency')`);
    expect(await setHiddenTagPatterns(db, [])).toEqual([]);
    expect(patternsOf(sqlite)).toEqual([]);
  });

  it("saves more patterns than D1 allows bound parameters", async () => {
    const { sqlite } = store([]);
    const db = createDb(fakeD1(sqlite));
    const many = Array.from({ length: 150 }, (_, i) => `tag${i}`);
    await setHiddenTagPatterns(db, many);
    expect(patternsOf(sqlite)).toEqual(many);
  });

  it("changes what the Summary hides", async () => {
    const { sqlite, db } = store([]);
    seed(sqlite, [
      { date: "2026-03-01", merchant: "Shop", amount: 10, deleted: false },
      { date: "2026-03-02", merchant: "Hotel", amount: 50, deleted: false },
    ], []);
    sqlite.exec(`
      INSERT INTO tags (id, name) VALUES (1, 'trip:rome');
      INSERT INTO transaction_tags (transaction_id, tag_id)
        SELECT id, 1 FROM transactions WHERE merchant_raw = 'Hotel';
    `);
    const query = { year: 2026, month: null, includeHidden: false };
    expect((await buildSummary(db, query)).cashFlow.expensesCents).toBe(6_000);
    await setHiddenTagPatterns(db, ["trip:*"]);
    const after = await buildSummary(db, query);
    expect(after.cashFlow.expensesCents).toBe(1_000);
    expect(after.hiddenCents).toBe(5_000);
    expect(after.excludedPatterns).toEqual(["trip:*"]);
  });
});
