/**
 * Payslip runs and the month rows rebuilt from them. Every write reads the
 * person's runs, merges the change, rebuilds the affected months with
 * domain/payslips.ts, and writes runs and months in one batch.
 */

import { asc, desc, eq, sql } from "drizzle-orm";

import type {
  PayslipImportResponse, PayslipMonthRow, PayslipRemoveResponse, PayslipRunInput, PayslipsResponse,
} from "../api/payslips";
import { atomic } from "../db/atomic";
import { payslipRuns, payslips, users } from "../db/schema";
import type { Db } from "../db/types";
import { aggregateMonths, deriveRun, RUN_PART_KEYS, type MonthTotals, type StoredRun } from "../domain/payslips";

const json = (v: unknown) => JSON.stringify(v);

async function runsOf(db: Db, userId: number): Promise<StoredRun[]> {
  const rows = await db.select().from(payslipRuns).where(eq(payslipRuns.userId, userId));
  return rows.map((r) => ({
    ...Object.fromEntries(RUN_PART_KEYS.map((k) => [k, r[k]])) as Omit<StoredRun, "statedNetCents" | "month" | "sourceFile" | "grossCents" | "taxTotalCents" | "netCents" | "netReconciled">,
    statedNetCents: r.statedNetCents,
    grossCents: r.grossCents, taxTotalCents: r.taxTotalCents, netCents: r.netCents, netReconciled: r.netReconciled,
    month: r.month, sourceFile: r.sourceFile,
  }));
}

async function savedMonths(db: Db, userId: number): Promise<string[]> {
  const rows = await db.select({ month: payslips.month }).from(payslips).where(eq(payslips.userId, userId));
  return rows.map((r) => r.month);
}

/**
 * The months a change touches: the changed months, plus for each the next
 * later month of the same year that has runs, whose YTD check reads it.
 */
function affected(changed: Set<string>, runMonths: string[]): string[] {
  const out = new Set(changed);
  const sorted = [...new Set(runMonths)].sort();
  for (const m of changed) {
    const next = sorted.find((x) => x > m && x.slice(0, 4) === m.slice(0, 4));
    if (next) out.add(next);
  }
  return [...out].sort();
}

/** Upsert these month rows and delete these months, for one person. */
function monthStatements(userId: number, rows: MonthTotals[], emptied: string[]) {
  const statements = [];
  if (rows.length) {
    statements.push(sql`
      INSERT INTO payslips (user_id, month, gross_cents, net_cents, tax_total_cents, pension_ee_cents, avc_cents,
        pension_er_cents, bonus_cents, on_call_cents, source_files, ytd_reconciled, net_reconciled)
      SELECT ${userId}, json_extract(value, '$.month'), json_extract(value, '$.grossCents'),
        json_extract(value, '$.netCents'), json_extract(value, '$.taxTotalCents'),
        json_extract(value, '$.pensionEeCents'), json_extract(value, '$.avcCents'),
        json_extract(value, '$.pensionErCents'), json_extract(value, '$.bonusCents'),
        json_extract(value, '$.onCallCents'), json(json_extract(value, '$.sourceFiles')),
        json_extract(value, '$.ytd'), json_extract(value, '$.net')
      FROM json_each(${json(rows.map((r) => ({ ...r, ytd: r.ytdReconciled === null ? null : Number(r.ytdReconciled), net: Number(r.netReconciled) })))})
      WHERE true
      ON CONFLICT (user_id, month) DO UPDATE SET
        gross_cents = excluded.gross_cents, net_cents = excluded.net_cents,
        tax_total_cents = excluded.tax_total_cents, pension_ee_cents = excluded.pension_ee_cents,
        avc_cents = excluded.avc_cents, pension_er_cents = excluded.pension_er_cents,
        bonus_cents = excluded.bonus_cents, on_call_cents = excluded.on_call_cents,
        source_files = excluded.source_files, ytd_reconciled = excluded.ytd_reconciled,
        net_reconciled = excluded.net_reconciled, updated_at = unixepoch()`);
  }
  if (emptied.length) {
    statements.push(sql`DELETE FROM payslips WHERE user_id = ${userId}
      AND month IN (SELECT value FROM json_each(${json(emptied)}))`);
  }
  return statements;
}

/** Rebuild the given months from `runs`; those left with no runs are deleted. */
function rebuild(userId: number, runs: StoredRun[], runless: string[], months: string[]) {
  const rows = aggregateMonths(runs, runless).filter((r) => months.includes(r.month));
  const emptied = months.filter((m) => !rows.some((r) => r.month === m) && !runless.includes(m));
  return { rows, statements: monthStatements(userId, rows, emptied) };
}

export async function importRuns(
  db: Db, userId: number, inputs: PayslipRunInput[], importedBy: number,
): Promise<PayslipImportResponse> {
  const existing = await runsOf(db, userId);
  const saved = await savedMonths(db, userId);
  const runless = saved.filter((m) => !existing.some((r) => r.month === m));
  const incoming: StoredRun[] = inputs.map((i) => ({ ...i, ...deriveRun(i) }));
  const names = new Set(incoming.map((r) => r.sourceFile));
  const replacedRuns = existing.filter((r) => names.has(r.sourceFile));
  const merged = [...existing.filter((r) => !names.has(r.sourceFile)), ...incoming];

  const changed = new Set([...incoming, ...replacedRuns].map((r) => r.month));
  // A month that now has runs is no longer the TUI's.
  const stillRunless = runless.filter((m) => !merged.some((r) => r.month === m));
  const months = affected(changed, merged.map((r) => r.month));
  const { rows, statements } = rebuild(userId, merged, stillRunless, months);

  const runRows = incoming.map((r) => ({ ...r, netReconciled: Number(r.netReconciled) }));
  const columns = [...RUN_PART_KEYS, "statedNetCents", "grossCents", "taxTotalCents", "netCents", "netReconciled"] as const;
  const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  await atomic(db, [
    sql`INSERT INTO payslip_runs (user_id, source_file, month, imported_by, ${sql.raw(columns.map(snake).join(", "))})
        SELECT ${userId}, json_extract(value, '$.sourceFile'), json_extract(value, '$.month'), ${importedBy},
          ${sql.raw(columns.map((c) => `json_extract(value, '$.${c}')`).join(", "))}
        FROM json_each(${json(runRows)})
        WHERE true
        ON CONFLICT (user_id, source_file) DO UPDATE SET
          month = excluded.month, imported_by = excluded.imported_by, updated_at = unixepoch(),
          ${sql.raw(columns.map((c) => `${snake(c)} = excluded.${snake(c)}`).join(", "))}`,
    ...statements,
  ]);

  return {
    months,
    imported: [...new Set(inputs.map((i) => i.month))].sort(),
    replaced: replacedRuns.length,
    ytdMismatches: rows.filter((r) => r.ytdReconciled === false).map((r) => r.month),
  };
}

export async function removeRuns(db: Db, userId: number, sourceFiles: string[]): Promise<PayslipRemoveResponse> {
  const existing = await runsOf(db, userId);
  const names = new Set(sourceFiles);
  const removed = existing.filter((r) => names.has(r.sourceFile));
  if (removed.length === 0) return { months: [] };
  const saved = await savedMonths(db, userId);
  const kept = existing.filter((r) => !names.has(r.sourceFile));
  const runless = saved.filter((m) => !existing.some((r) => r.month === m));
  const months = affected(new Set(removed.map((r) => r.month)), kept.map((r) => r.month));
  const { statements } = rebuild(userId, kept, runless, months);
  await atomic(db, [
    sql`DELETE FROM payslip_runs WHERE user_id = ${userId}
        AND source_file IN (SELECT value FROM json_each(${json([...names])}))`,
    ...statements,
  ]);
  return { months };
}

export async function listPayslips(db: Db): Promise<PayslipsResponse> {
  const people = await db.select({ id: users.id, name: users.displayName }).from(users).orderBy(asc(users.id));
  const monthRows = await db.select().from(payslips).orderBy(desc(payslips.month));
  const runRows = await db.select().from(payslipRuns).orderBy(asc(payslipRuns.sourceFile));
  return {
    people: people.map((p) => ({
      ...p,
      months: monthRows.filter((m) => m.userId === p.id).map((m): PayslipMonthRow => ({
        month: m.month,
        grossCents: m.grossCents, netCents: m.netCents, taxTotalCents: m.taxTotalCents,
        pensionEeCents: m.pensionEeCents, avcCents: m.avcCents, pensionErCents: m.pensionErCents,
        bonusCents: m.bonusCents, onCallCents: m.onCallCents,
        netReconciled: m.netReconciled, ytdReconciled: m.ytdReconciled,
        runs: runRows.filter((r) => r.userId === p.id && r.month === m.month).map((r) => ({
          sourceFile: r.sourceFile, grossCents: r.grossCents, netCents: r.netCents,
          pensionEeCents: r.pensionEeCents, avcCents: r.avcCents, pensionErCents: r.pensionErCents,
          netReconciled: r.netReconciled,
        })),
      })),
    })),
  };
}
