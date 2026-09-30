import { describe, expect, it } from "vitest";

import { merchantsInScope } from "../../queries/analysis";
import { summaryStore, summaryVectors, vectorStore, type SummaryRow } from "../helpers/summaryStore";

describe("merchant lists match the Python", () => {
  const { db } = vectorStore();

  it.each(summaryVectors.merchants.map((c) => [JSON.stringify([c.year, c.month, c.sources, c.type]), c] as const))(
    "%s",
    async (_name, c) => {
      const rows = await merchantsInScope(db, c.type, {
        sources: c.sources ?? undefined,
        year: String(c.year),
        month: c.month === null ? undefined : `${c.year}-${String(c.month).padStart(2, "0")}`,
      });
      expect(rows.map((r) => [r.merchant, r.category, r.amountCents])).toEqual(c.expected);
    },
  );
});

describe("modal category", () => {
  const rows: SummaryRow[] = [
    ["2026-01-01", "Amazon", 1_000, "expense", "Shopping", "Card"],
    ["2026-01-02", "Amazon", 2_000, "expense", "Groceries", "Card"],
    ["2026-01-03", "Amazon", 3_000, "expense", "Shopping", "Card"],
    ["2026-01-04", "Deli", 500, "expense", "Dining", "Card"],
    ["2026-01-05", "Deli", 700, "expense", "Bakery", "Card"],
  ];
  const { db, sqlite } = summaryStore(rows, []);

  it("takes the most frequent category, not the biggest spend", async () => {
    const amazon = (await merchantsInScope(db, "expense")).find((r) => r.merchant === "Amazon");
    expect(amazon).toEqual({ merchant: "Amazon", category: "Shopping", amountCents: 6_000, txnCount: 3 });
  });

  it("breaks a tie alphabetically, as pandas' mode()[0] does", async () => {
    const deli = (await merchantsInScope(db, "expense")).find((r) => r.merchant === "Deli");
    expect(deli?.category).toBe("Bakery");
  });

  it("falls back to the raw name for an unresolved merchant", async () => {
    sqlite.exec(`INSERT INTO transactions (date, merchant_raw, merchant_id, amount_cents, type, source)
                 VALUES (${Date.UTC(2026, 0, 9) / 1000}, 'UNRESOLVED 123', NULL, 250, 'expense', 'Card')`);
    const rows = await merchantsInScope(db, "expense");
    expect(rows.find((r) => r.merchant === "UNRESOLVED 123")).toMatchObject({ category: "Other", amountCents: 250 });
  });
});
