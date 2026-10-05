import { describe, expect, it } from "vitest";

import { addFiles, ignoredBy, isImportable, needsReparse, type PayslipFile } from "../../payslips/fileList";
import { PayslipRun } from "../../payslips/parser";

const file = (name: string) => new File([new Uint8Array([1])], name, { type: "application/pdf" });
let n = 0;
const nextId = () => ++n;

describe("ignoredBy", () => {
  it.each([
    ["2026-01 DRAFT.pdf", "draft"], ["2026-01 old copy.pdf", "old"], ["Wrong 2026-01.pdf", "wrong"],
    ["2026-01 pay.pdf", null], ["2026-01 golden.pdf", "old"],
  ])("%j -> %j", (name, token) => {
    expect(ignoredBy(name)).toBe(token);
  });
});

describe("addFiles", () => {
  it("adds new files as reading, and a file with the same name replaces the old line", () => {
    const first = addFiles([], [file("a.pdf"), file("b.pdf")], nextId);
    expect(first.map((f) => [f.file.name, f.status.kind])).toEqual([["a.pdf", "reading"], ["b.pdf", "reading"]]);
    const again = addFiles(first, [file("a.pdf")], nextId);
    expect(again.map((f) => f.file.name)).toEqual(["b.pdf", "a.pdf"]);
    expect(again[1].id).not.toBe(first[0].id);
  });
});

describe("isImportable and needsReparse", () => {
  const ready = (name: string, useAnyway = false): PayslipFile =>
    ({ id: 1, file: file(name), status: { kind: "ready", run: new PayslipRun("2026-01", name) }, useAnyway, version: 0 });

  it("imports ready files, and ignored ones only when asked", () => {
    expect(isImportable(ready("2026-01 pay.pdf"))).toBe(true);
    expect(isImportable(ready("2026-01 draft.pdf"))).toBe(false);
    expect(isImportable(ready("2026-01 draft.pdf", true))).toBe(true);
    expect(isImportable({ ...ready("x.pdf"), status: { kind: "unrecognised" } })).toBe(false);
  });

  it("re-parses only files that wanted a password", () => {
    expect(needsReparse({ ...ready("a.pdf"), status: { kind: "needsPassword" } })).toBe(true);
    expect(needsReparse({ ...ready("a.pdf"), status: { kind: "wrongPassword" } })).toBe(true);
    expect(needsReparse(ready("a.pdf"))).toBe(false);
  });
});
