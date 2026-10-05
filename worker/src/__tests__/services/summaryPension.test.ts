import { describe, expect, it } from "vitest";

import { buildSummary } from "../../services/summary";
import { seed, store } from "../helpers/store";

function setup() {
  const s = store([]);
  s.sqlite.exec(`INSERT INTO users (id, email, display_name, owner_key) VALUES (2, 'b@example.com', 'B', 'b')`);
  seed(s.sqlite, [
    { date: "2026-01-05", merchant: "Pay A", amount: 5000, deleted: false },
    { date: "2026-01-06", merchant: "Shop", amount: 3000, deleted: false },
    { date: "2026-02-05", merchant: "Pay B", amount: 4000, deleted: false },
    { date: "2026-03-05", merchant: "Kid Shop", amount: 10, deleted: false },
  ], []);
  s.sqlite.exec(`
    UPDATE transactions SET type = 'income' WHERE merchant_raw IN ('Pay A', 'Pay B');
    UPDATE transactions SET source = 'A Bank' WHERE merchant_raw IN ('Pay A', 'Shop');
    UPDATE transactions SET source = 'B Bank' WHERE merchant_raw = 'Pay B';
    UPDATE transactions SET source = 'Kid Bank' WHERE merchant_raw = 'Kid Shop';
    INSERT INTO source_owners (source, user_id) VALUES ('A Bank', 1), ('B Bank', 2), ('Kid Bank', NULL);
    INSERT INTO payslips (user_id, month, gross_cents, net_cents, tax_total_cents, pension_ee_cents, avc_cents, pension_er_cents, ytd_reconciled)
      VALUES (1, '2026-01', 0, 0, 0, 50000, 10000, 50000, 1),
             (2, '2026-01', 0, 0, 0, 20000, 0, 20000, 0),
             (2, '2026-02', 0, 0, 0, 20000, 0, 20000, 1);
  `);
  const pension = async (sources?: string[], month: number | null = null) =>
    (await buildSummary(s.db, { year: 2026, month, sources, includeHidden: false })).pension;
  return { ...s, pension };
}

describe("the Summary's pension figure", () => {
  it("counts everyone with all sources, over months with payslips and bank data", async () => {
    expect(await setup().pension()).toEqual({
      pensionCents: 190000, savedCents: 790000, incomeCents: 1090000,
      rate: (790000 / 1090000) * 100, months: [1, 2], coverageLabel: "Jan–Feb",
      reconciled: false, people: ["A", "B"],
    });
  });

  it("counts only the owner of the selected sources", async () => {
    const got = await setup().pension(["A Bank"]);
    expect(got).toMatchObject({ pensionCents: 110000, months: [1], people: ["A"], reconciled: true });
  });

  it("counts both when both people's accounts are selected", async () => {
    expect((await setup().pension(["A Bank", "B Bank"]))?.people).toEqual(["A", "B"]);
  });

  it("no pension when the selected sources belong to no one", async () => {
    expect(await setup().pension(["Kid Bank"])).toBeNull();
    expect(await setup().pension([])).toBeNull();
  });

  it("follows the month view", async () => {
    expect(await setup().pension(undefined, 2)).toMatchObject({ months: [2], pensionCents: 40000 });
    expect(await setup().pension(undefined, 3)).toBeNull();
  });
});
