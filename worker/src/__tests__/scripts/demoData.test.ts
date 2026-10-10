import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildDemo } from "../../../scripts/demoData";
import { migrate } from "../../../scripts/migrate";

function demo(today: string) {
  const sqlite = new Database(":memory:");
  migrate(sqlite);
  buildDemo(sqlite, new Date(`${today}T12:00:00Z`));
  const one = <T>(sql: string) => sqlite.prepare(sql).raw().get() as T;
  return { sqlite, one };
}

describe("buildDemo", () => {
  it("covers 18 months ending today, with nothing in the future", () => {
    const { one } = demo("2026-10-10");
    const [first, last, n] = one<[string, string, number]>("SELECT MIN(date), MAX(date), COUNT(*) FROM v_transactions");
    expect(first.slice(0, 7)).toBe("2025-05");
    expect(last <= "2026-10-10").toBe(true);
    expect(last.slice(0, 7)).toBe("2026-10");
    expect(n).toBeGreaterThan(600);
    expect(n).toBeLessThan(2000);
  });

  it("still has this month's rows on the 1st", () => {
    const { one } = demo("2026-11-01");
    expect(one<[string]>("SELECT MAX(date) FROM v_transactions")[0]).toBe("2026-11-01");
  });

  it("is the same every run", () => {
    const dump = (s: Database.Database) => JSON.stringify(s.prepare("SELECT * FROM v_transactions ORDER BY id").raw().all());
    expect(dump(demo("2026-10-10").sqlite)).toBe(dump(demo("2026-10-10").sqlite));
  });

  it("never trips the duplicate index, whatever the date", () => {
    for (const d of ["2026-01-31", "2026-02-28", "2026-03-15", "2026-12-31"]) expect(() => demo(d)).not.toThrow();
  });

  it("fills every page", () => {
    const { one } = demo("2026-10-10");
    expect(one<[number]>("SELECT COUNT(*) FROM v_live WHERE type = 'expense' AND spending_type IS NULL")[0]).toBe(0);
    expect(one<[number]>("SELECT COUNT(*) FROM v_excluded_ids")[0]).toBeGreaterThan(0);
    expect(one<[number]>("SELECT COUNT(DISTINCT user_id) FROM payslips")[0]).toBe(2);
    expect(one<[number]>("SELECT COUNT(*) FROM payslip_runs")[0]).toBe(one<[number]>("SELECT COUNT(*) FROM payslips")[0]);
    expect(one<[number]>("SELECT COUNT(DISTINCT user_id) FROM source_owners")[0]).toBe(2);
    expect(one<[number]>("SELECT COUNT(*) FROM merchant_aliases")[0]).toBeGreaterThan(0);
    expect(one<[number]>("SELECT COUNT(DISTINCT merchant_raw) FROM v_transactions WHERE merchant = 'Corner Shop'")[0]).toBeGreaterThan(1);
    expect(one<[number]>("SELECT COUNT(*) FROM v_transactions WHERE tags LIKE '%trip:%'")[0]).toBeGreaterThan(0);
  });
});
