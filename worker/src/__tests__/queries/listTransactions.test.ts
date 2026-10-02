import { describe, expect, it } from "vitest";

import { listLookups, listTransactions } from "../../queries/transactions";
import { vectorStore } from "../helpers/summaryStore";

function store() {
  const s = vectorStore();
  s.sqlite.exec(`
    INSERT INTO tags (id, name) VALUES (1, 'emergency'), (2, 'gift');
    INSERT INTO tag_exclusion_patterns (pattern) VALUES ('emergency');
    INSERT INTO transaction_tags (transaction_id, tag_id)
      SELECT id, 1 FROM transactions WHERE merchant_raw = 'Bookshop';
  `);
  return s;
}

describe("listTransactions sources and hidden tags", () => {
  const { db, sqlite } = store();
  const count = (where: string) =>
    (sqlite.prepare(`SELECT COUNT(*) FROM v_live WHERE ${where}`).raw().get() as [number])[0];

  it("keeps only the chosen sources", async () => {
    const list = await listTransactions(db, { sources: ["Card"] });
    expect(list.rows.length).toBe(count(`source = 'Card'`));
    expect(list.rows.every((r) => r.source === "Card")).toBe(true);
  });

  it("lists nothing for an empty source list", async () => {
    expect((await listTransactions(db, { sources: [] })).rows).toEqual([]);
  });

  it("drops exactly the rows v_summary drops when hidden tags are excluded", async () => {
    const all = await listTransactions(db);
    const shown = await listTransactions(db, { excludeHidden: true });
    expect(shown.rows.length).toBe((sqlite.prepare(`SELECT COUNT(*) FROM v_summary`).raw().get() as [number])[0]);
    expect(shown.rows.some((r) => r.merchant === "Bookshop")).toBe(false);
    expect(all.rows.some((r) => r.merchant === "Bookshop")).toBe(true);
  });

  it("totals income and expenses separately", async () => {
    const list = await listTransactions(db);
    const sum = (t: string) => list.rows.filter((r) => r.type === t).reduce((a, r) => a + r.amountCents, 0);
    expect(list.incomeCents).toBe(sum("income"));
    expect(list.expensesCents).toBe(sum("expense"));
    expect(list.totalCents).toBe(list.incomeCents + list.expensesCents);
  });
});

describe("listLookups", () => {
  it("lists live categories, tags in use and sources, sorted", async () => {
    const { db, sqlite } = store();
    const l = await listLookups(db);
    expect(l.sources).toEqual(["Bank A", "Card"]);
    expect(l.tags).toEqual(["emergency"]); // 'gift' is on no transaction
    expect(l.categories).toEqual([...l.categories].sort());
    expect(l.categories).toContain("Groceries");
    sqlite.exec(`UPDATE transactions SET deleted_at = 1 WHERE source = 'Card'`);
    expect((await listLookups(db)).sources).toEqual(["Bank A"]);
  });
});
