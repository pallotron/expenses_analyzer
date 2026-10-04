import { describe, expect, it } from "vitest";

import {
  importList, isReady, NEW_SOURCE, requestFor, rowStatus, type Action, type Counts, type FileRow,
} from "../../import/importList";
import { MAX_IMPORT_ROWS, type ImportMapping } from "../../lib/types";

const GRID = [["Date", "Description", "Amount"], ["01/09/2026", "Corner Shop", "-6.55"], ["02/09/2026", "Acme Payroll", "100.00"]];
const MAP: ImportMapping = { date: "Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const SAVED = { Card: MAP };
const COUNTS: Counts = { inserted: 2, duplicates: 0, suppressedDeleted: 0, newMerchants: [] };

const file = (name = "a.csv") => new File(["x"], name, { lastModified: 1 });
const apply = (actions: Action[], start: FileRow[] = []) => actions.reduce(importList, start);
const add = (...names: string[]): Action => ({ type: "add", files: names.map((n, i) => ({ id: `f${i + 1}`, file: file(n) })) });
const read = (id = "f1", grid = GRID): Action => ({ type: "read", id, grid, saved: SAVED });
const choose = (choice: string, id = "f1"): Action => ({ type: "choose", id, choice, saved: SAVED });
const checked = (rows: FileRow[], id = "f1"): FileRow[] => {
  const v = rows.find((r) => r.id === id)!.version;
  return apply([{ type: "checkStart", id, version: v }, { type: "checked", id, version: v, counts: COUNTS }], rows);
};

describe("the import list", () => {
  it("reads a file, and a source whose saved mapping fits makes it ready after a check", () => {
    let rows = apply([add("a.csv")]);
    expect(rowStatus(rows[0])).toEqual({ kind: "reading" });
    rows = apply([read()], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "leftOut" });
    rows = apply([choose("Card")], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "checking" });
    rows = checked(rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "ready", counts: COUNTS, skipped: 0 });
    expect(isReady(rows[0])).toBe(true);
  });

  it("reports a file it could not read", () => {
    const rows = apply([add("a.csv"), { type: "readFailed", id: "f1", message: "Choose a .csv, .xls or .xlsx file" }]);
    expect(rowStatus(rows[0])).toEqual({ kind: "readFailed", message: "Choose a .csv, .xls or .xlsx file" });
  });

  it("opens a lone file, but not files added together", () => {
    expect(apply([add("a.csv")])[0].open).toBe(true);
    expect(apply([add("a.csv", "b.csv")]).map((r) => r.open)).toEqual([false, false]);
  });

  it("marks a second copy of a file, until a source is chosen for it", () => {
    let rows = apply([add("a.csv"), { type: "add", files: [{ id: "f2", file: file("a.csv") }] }, read("f1"), read("f2")]);
    expect(rowStatus(rows[1])).toEqual({ kind: "sameFile" });
    rows = apply([choose("Card", "f2")], rows);
    expect(rowStatus(rows[1])).toEqual({ kind: "checking" });
  });

  it("needs its columns confirmed for a source with no saved mapping", () => {
    let rows = apply([add("a.csv", "b.csv"), read(), choose("Other")]);
    expect(rowStatus(rows[0])).toEqual({ kind: "needsMapping", missing: [] });
    expect(rows[0].open).toBe(true);
    rows = apply([{ type: "confirm", id: "f1" }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "checking" });
  });

  it("names the saved columns a file lacks", () => {
    const rows = apply([
      add("a.csv"),
      { type: "read", id: "f1", grid: GRID, saved: { Card: { ...MAP, date: "Started Date" } } },
      { type: "choose", id: "f1", choice: "Card", saved: { Card: { ...MAP, date: "Started Date" } } },
    ]);
    expect(rowStatus(rows[0])).toEqual({ kind: "needsMapping", missing: ["Started Date"] });
  });

  it("goes on to check once the guessed columns are confirmed", () => {
    const saved = { Card: { ...MAP, date: "Started Date" } };
    let rows = apply([add("a.csv"), { type: "read", id: "f1", grid: GRID, saved }, { type: "choose", id: "f1", choice: "Card", saved }]);
    expect(rowStatus(rows[0])).toEqual({ kind: "needsMapping", missing: ["Started Date"] });
    rows = apply([{ type: "confirm", id: "f1" }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "checking" });
  });

  it("ignores a check answer for an older version of the row", () => {
    let rows = apply([add("a.csv"), read(), choose("Card")]);
    const old = rows[0].version;
    rows = apply([{ type: "checkStart", id: "f1", version: old }, { type: "mapping", id: "f1", mapping: { ...MAP, typeMode: "expense" } }], rows);
    rows = apply([{ type: "checked", id: "f1", version: old, counts: COUNTS }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "checking" });
    expect(rows[0].check).toEqual({ state: "idle" });
  });

  it("says when nothing parses, and when a file is over the cap", () => {
    expect(rowStatus(apply([add("a.csv"), read("f1", [GRID[0]]), choose("Card")])[0])).toEqual({ kind: "nothing" });
    const big = [GRID[0], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => GRID[1])];
    expect(rowStatus(apply([add("a.csv"), read("f1", big), choose("Card")])[0]))
      .toEqual({ kind: "tooMany", rows: MAX_IMPORT_ROWS + 1 });
  });

  it("tells a refusal from a failed check", () => {
    const base = apply([add("a.csv"), read(), choose("Card")]);
    const v = base[0].version;
    const refused = apply([{ type: "checkFailed", id: "f1", version: v, message: "The file has rows the import refuses", errors: ["bad"], refused: true }], base);
    expect(rowStatus(refused[0])).toEqual({ kind: "refused", message: "The file has rows the import refuses", errors: ["bad"] });
    const down = apply([{ type: "checkFailed", id: "f1", version: v, message: "Request failed (500)", refused: false }], base);
    expect(rowStatus(down[0])).toEqual({ kind: "checkFailed", message: "Request failed (500)" });
  });

  it("imports, fails and retries a row, and re-checks only rows not yet imported", () => {
    let rows = checked(checked(apply([add("a.csv", "b.csv"), read("f1"), read("f2"), choose("Card", "f1"), choose("Card", "f2")])), "f2");
    const result = { batchId: 7, ...COUNTS };
    rows = apply([{ type: "importStart", id: "f1" }, { type: "imported", id: "f1", result }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "imported", result });
    rows = apply([{ type: "recheck", ids: ["f1", "f2"] }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "imported", result });
    expect(rowStatus(rows[1])).toEqual({ kind: "checking" });
    rows = apply([{ type: "importStart", id: "f2" }, { type: "importFailed", id: "f2", message: "down", errors: ["x"] }], rows);
    expect(rowStatus(rows[1])).toEqual({ kind: "importFailed", message: "down", errors: ["x"] });
    rows = apply([{ type: "importStart", id: "f2" }], rows);
    expect(rowStatus(rows[1])).toEqual({ kind: "importing" });
  });

  it("checks a failed row again once its source or columns change", () => {
    const fail: Action[] = [{ type: "importStart", id: "f1" }, { type: "importFailed", id: "f1", message: "down" }];
    const failed = (choice: string) => apply(fail, checked(apply([add("a.csv"), read(), choose(choice)])));
    const edits: Action[] = [
      choose("Other"),
      { type: "rename", id: "f1", name: "Other", saved: SAVED },
      { type: "mapping", id: "f1", mapping: { ...MAP, typeMode: "expense" } },
      { type: "confirm", id: "f1" },
    ];
    for (const edit of edits) {
      let rows = failed(edit.type === "rename" ? NEW_SOURCE : "Card");
      expect(rows[0].run.state).toBe("failed");
      rows = apply([edit], rows);
      expect(rows[0].run, edit.type).toEqual({ state: "no" });
    }
  });

  it("clears sameAs on rows that pointed at a removed row", () => {
    let rows = apply([add("a.csv"), { type: "add", files: [{ id: "f2", file: file("a.csv") }] }]);
    expect(rows[1].sameAs).toBe("f1");
    rows = apply([{ type: "remove", id: "f1" }], rows);
    expect(rows[0].sameAs).toBeNull();
  });

  it("asks for a name when New source is chosen and the name is blank", () => {
    let rows = apply([add("a.csv"), read(), choose(NEW_SOURCE)]);
    expect(rowStatus(rows[0])).toEqual({ kind: "needsMapping", missing: [] });
    rows = apply([{ type: "rename", id: "f1", name: "   ", saved: SAVED }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "needsName" });
    rows = apply([{ type: "rename", id: "f1", name: "Card", saved: SAVED }], rows);
    expect(rowStatus(rows[0])).toEqual({ kind: "checking" });
  });

  it("leaves an imported row's version and check alone on a recheck", () => {
    let rows = checked(apply([add("a.csv"), read(), choose("Card")]));
    rows = apply([{ type: "importStart", id: "f1" }, { type: "imported", id: "f1", result: { batchId: 1, ...COUNTS } }], rows);
    const before = rows[0];
    rows = apply([{ type: "recheck", ids: ["f1"] }], rows);
    expect(rows[0].version).toBe(before.version);
    expect(rows[0].check).toEqual(before.check);
  });

  it("ignores actions for rows that are gone", () => {
    expect(apply([add("a.csv"), { type: "remove", id: "f1" }, read()])).toEqual([]);
    expect(apply([add("a.csv"), { type: "reset" }, read()])).toEqual([]);
  });

  it("gives a source named constructor no saved mapping", () => {
    const rows = apply([add("a.csv", "b.csv"), read(), choose("constructor")]);
    expect(rowStatus(rows[0])).toEqual({ kind: "needsMapping", missing: [] });
  });

  it("takes a new source's name when it is committed", () => {
    let rows = apply([add("a.csv", "b.csv"), read(), choose(NEW_SOURCE)]);
    expect(rows[0].source).toBe("CSV Import");
    rows = apply([{ type: "rename", id: "f1", name: "  Card  ", saved: SAVED }], rows);
    expect(rows[0].source).toBe("Card");
    expect(rowStatus(rows[0])).toEqual({ kind: "checking" });
  });

  it("builds the request from the parsed rows", () => {
    const rows = apply([add("a.csv"), read(), choose("Card")]);
    expect(requestFor(rows[0], true)).toEqual({
      source: "Card", filename: "a.csv", mapping: MAP, dryRun: true,
      rows: [
        { date: "2026-09-01", merchant: "Corner Shop", amountCents: 655, type: "expense" },
        { date: "2026-09-02", merchant: "Acme Payroll", amountCents: 10000, type: "income" },
      ],
    });
    expect(requestFor(rows[0], false)).not.toHaveProperty("dryRun");
  });
});
