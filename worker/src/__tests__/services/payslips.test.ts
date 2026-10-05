import { describe, expect, it } from "vitest";

import type { PayslipRunInput } from "../../api/payslips";
import { createDb } from "../../db/client";
import { RUN_PART_KEYS } from "../../domain/payslips";
import { importRuns, listPayslips, removeRuns } from "../../services/payslips";
import { fakeD1 } from "../helpers/fakeD1";
import { store } from "../helpers/store";

/** A monthly run: 600 of pension (EE 500 + AVC 100) with the given year-to-date. */
function run(sourceFile: string, month: string, ytd: number, over: Partial<PayslipRunInput> = {}): PayslipRunInput {
  return {
    ...Object.fromEntries(RUN_PART_KEYS.map((k) => [k, 0])) as Omit<PayslipRunInput, "statedNetCents" | "sourceFile" | "month">,
    salaryCents: 500000, pensionEeCents: 50000, avcCents: 10000, pensionErCents: 50000,
    payeCents: 100000, prsiEeCents: 20000, uscCents: 15000,
    pensionEeYtdCents: ytd - ytd / 6, avcYtdCents: ytd / 6, pensionErYtdCents: ytd - ytd / 6,
    statedNetCents: 305000, sourceFile, month, ...over,
  };
}

function setup() {
  const s = store([]);
  s.sqlite.exec(`INSERT INTO users (id, email, display_name, owner_key) VALUES (2, 'b@example.com', 'B', 'b')`);
  const months = (userId = 1) => s.sqlite.prepare(
    `SELECT month, gross_cents, pension_ee_cents, avc_cents, source_files, net_reconciled, ytd_reconciled
     FROM payslips WHERE user_id = ? ORDER BY month`).all(userId);
  const runCount = () => (s.sqlite.prepare(`SELECT COUNT(*) AS n FROM payslip_runs`).get() as { n: number }).n;
  return { ...s, months, runCount };
}

describe("importRuns", () => {
  it("stores each file and builds its month, deriving gross and net itself", async () => {
    const { db, months, sqlite } = setup();
    const res = await importRuns(db, 1, [run("2026-01 pay.pdf", "2026-01", 60000)], 1);
    expect(res).toEqual({ months: ["2026-01"], imported: ["2026-01"], replaced: 0, ytdMismatches: [] });
    expect(months()).toEqual([{
      month: "2026-01", gross_cents: 500000, pension_ee_cents: 50000, avc_cents: 10000,
      source_files: '["2026-01 pay.pdf"]', net_reconciled: 1, ytd_reconciled: 1,
    }]);
    expect(sqlite.prepare(`SELECT net_cents, imported_by FROM payslip_runs`).get()).toEqual({ net_cents: 305000, imported_by: 1 });
  });

  it("re-importing a file replaces its run and the month does not double", async () => {
    const { db, months, runCount } = setup();
    await importRuns(db, 1, [run("2026-01 pay.pdf", "2026-01", 60000)], 1);
    const res = await importRuns(db, 1, [run("2026-01 pay.pdf", "2026-01", 60000, { salaryCents: 510000, statedNetCents: 315000 })], 2);
    expect(res.replaced).toBe(1);
    expect(runCount()).toBe(1);
    expect(months()).toMatchObject([{ month: "2026-01", gross_cents: 510000 }]);
  });

  it("a later run joins its month and rebuilds the next month's check", async () => {
    const { db, months } = setup();
    await importRuns(db, 1, [run("2026-01 pay.pdf", "2026-01", 60000), run("2026-02 pay.pdf", "2026-02", 150000)], 1);
    expect(months()).toMatchObject([{ month: "2026-01", ytd_reconciled: 1 }, { month: "2026-02", ytd_reconciled: 0 }]);
    // A January bonus run with 300 more pension (YTD 90,000) makes both months add up:
    // January 60,000 + 30,000 against 90,000 − 0, February 60,000 against 150,000 − 90,000.
    const bonus = run("2026-01 bonus.pdf", "2026-01", 90000, {
      salaryCents: 0, bonusCents: 100000, pensionEeCents: 25000, avcCents: 5000, pensionErCents: 0,
      payeCents: 0, prsiEeCents: 0, uscCents: 0, statedNetCents: null,
    });
    const res = await importRuns(db, 1, [bonus], 1);
    expect(res.months).toEqual(["2026-01", "2026-02"]);
    // February was only re-checked, not imported.
    expect(res.imported).toEqual(["2026-01"]);
    expect(months()).toMatchObject([
      { month: "2026-01", gross_cents: 600000, pension_ee_cents: 75000, source_files: '["2026-01 bonus.pdf","2026-01 pay.pdf"]', ytd_reconciled: 1 },
      { month: "2026-02", ytd_reconciled: 1 },
    ]);
  });

  it("reports months whose year-to-date check fails", async () => {
    const { db } = setup();
    const res = await importRuns(db, 1, [run("a.pdf", "2026-01", 60000), run("b.pdf", "2026-02", 150000)], 1);
    expect(res.ytdMismatches).toEqual(["2026-02"]);
  });

  it("TUI-era months are left alone and make the next month's check unknown", async () => {
    const { db, sqlite, months } = setup();
    sqlite.exec(`INSERT INTO payslips (user_id, month, gross_cents, net_cents, tax_total_cents, source_files, ytd_reconciled)
                 VALUES (1, '2026-01', 1, 2, 3, '["old"]', 1)`);
    await importRuns(db, 1, [run("2026-02 pay.pdf", "2026-02", 120000)], 1);
    expect(months()).toMatchObject([
      { month: "2026-01", gross_cents: 1, source_files: '["old"]', ytd_reconciled: 1 },
      { month: "2026-02", ytd_reconciled: null },
    ]);
  });

  it("replaces a TUI-era month once a file for it arrives", async () => {
    const { db, sqlite, months } = setup();
    sqlite.exec(`INSERT INTO payslips (user_id, month, gross_cents, net_cents, tax_total_cents) VALUES (1, '2026-01', 1, 2, 3)`);
    await importRuns(db, 1, [run("2026-01 pay.pdf", "2026-01", 60000)], 1);
    expect(months()).toMatchObject([{ month: "2026-01", gross_cents: 500000, ytd_reconciled: 1 }]);
  });

  it("keeps each person's payslips apart", async () => {
    const { db, months } = setup();
    await importRuns(db, 1, [run("pay.pdf", "2026-01", 60000)], 1);
    await importRuns(db, 2, [run("pay.pdf", "2026-01", 60000)], 1);
    expect(months(1)).toHaveLength(1);
    expect(months(2)).toHaveLength(1);
  });

  it("imports more files than D1 allows bound parameters", async () => {
    const { sqlite, runCount } = setup();
    const db = createDb(fakeD1(sqlite));
    const runs = Array.from({ length: 150 }, (_, i) =>
      run(`2026-${String((i % 12) + 1).padStart(2, "0")} part ${i}.pdf`, `2026-${String((i % 12) + 1).padStart(2, "0")}`, 0));
    await importRuns(db, 1, runs, 1);
    expect(runCount()).toBe(150);
  });

  it("writes nothing when the batch fails part-way", async () => {
    const { sqlite, runCount, months } = setup();
    const db = createDb(fakeD1(sqlite));
    sqlite.exec(`CREATE TRIGGER boom BEFORE INSERT ON payslips BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    await expect(importRuns(db, 1, [run("a.pdf", "2026-01", 60000)], 1)).rejects.toThrow();
    expect(runCount()).toBe(0);
    expect(months()).toEqual([]);
  });
});

describe("removeRuns", () => {
  it("removes a file and rebuilds its month and the next", async () => {
    const { db, months } = setup();
    await importRuns(db, 1, [run("a.pdf", "2026-01", 60000), run("b.pdf", "2026-01", 60000, { pensionEeCents: 0, avcCents: 0 }),
      run("c.pdf", "2026-02", 120000)], 1);
    const res = await removeRuns(db, 1, ["b.pdf"]);
    expect(res.months).toEqual(["2026-01", "2026-02"]);
    expect(months()).toMatchObject([{ month: "2026-01", source_files: '["a.pdf"]', gross_cents: 500000 }, { month: "2026-02", ytd_reconciled: 1 }]);
  });

  it("deletes a month whose last file is removed", async () => {
    const { db, months, runCount } = setup();
    await importRuns(db, 1, [run("a.pdf", "2026-01", 60000)], 1);
    await removeRuns(db, 1, ["a.pdf"]);
    expect(runCount()).toBe(0);
    expect(months()).toEqual([]);
  });

  it("removes more files than D1 allows bound parameters", async () => {
    const { sqlite, runCount, months } = setup();
    const db = createDb(fakeD1(sqlite));
    const pad = (n: number) => String(n).padStart(2, "0");
    // 150 runs over 2025-01 … 2026-06 (18 months, 8 or 9 files each).
    const monthOf = (i: number) => (i % 18 < 12 ? `2025-${pad((i % 18) + 1)}` : `2026-${pad((i % 18) - 11)}`);
    const runs = Array.from({ length: 150 }, (_, i) => run(`${monthOf(i)} part ${i}.pdf`, monthOf(i), 0));
    await importRuns(db, 1, runs, 1);
    // Remove the first 120 in one call; the 30 left still span all 18 months.
    const gone = runs.slice(0, 120).map((r) => r.sourceFile);
    await removeRuns(db, 1, gone);
    expect(runCount()).toBe(30);
    const left = sqlite.prepare(`SELECT source_file FROM payslip_runs ORDER BY source_file`).all() as { source_file: string }[];
    expect(left.map((r) => r.source_file).sort()).toEqual(runs.slice(120).map((r) => r.sourceFile).sort());
    const expectedMonths = [...new Set(runs.slice(120).map((r) => r.month))].sort();
    const rows = months() as { month: string; source_files: string }[];
    expect(rows.map((r) => r.month)).toEqual(expectedMonths);
    for (const row of rows) {
      const files = runs.slice(120).filter((r) => r.month === row.month).map((r) => r.sourceFile).sort();
      expect(JSON.parse(row.source_files)).toEqual(files);
    }
  });

  it("ignores a file it does not know", async () => {
    const { db } = setup();
    expect(await removeRuns(db, 1, ["nope.pdf"])).toEqual({ months: [] });
  });
});

describe("listPayslips", () => {
  it("lists both people, months newest first, each with its files", async () => {
    const { db, sqlite } = setup();
    sqlite.exec(`INSERT INTO payslips (user_id, month, gross_cents, net_cents, tax_total_cents) VALUES (1, '2025-12', 1, 2, 3)`);
    await importRuns(db, 1, [run("b.pdf", "2026-01", 60000), run("a.pdf", "2026-01", 0, { pensionEeCents: 0, avcCents: 0 })], 1);
    const res = await listPayslips(db);
    expect(res.people.map((p) => [p.id, p.name, p.months.map((m) => m.month)])).toEqual([
      [1, "A", ["2026-01", "2025-12"]],
      [2, "B", []],
    ]);
    const january = res.people[0].months[0];
    expect(january.runs.map((r) => r.sourceFile)).toEqual(["a.pdf", "b.pdf"]);
    expect(january.runs[1]).toEqual({
      sourceFile: "b.pdf", grossCents: 500000, netCents: 305000, pensionEeCents: 50000, avcCents: 10000,
      pensionErCents: 50000, netReconciled: true,
    });
    expect(res.people[0].months[1].runs).toEqual([]);
  });
});
