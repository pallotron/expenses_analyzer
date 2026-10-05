import { describe, expect, it } from "vitest";

import { entriesOf, filesFromEntries } from "../../payslips/droppedFiles";

const pdf = (name: string) => new File([new Uint8Array([1])], name, { type: "application/pdf" });

/** A fake FileSystemFileEntry: jsdom has no file system entries. */
function fileEntry(file: File): FileSystemEntry {
  return { isFile: true, isDirectory: false, name: file.name, file: (ok: (f: File) => void) => ok(file) } as unknown as FileSystemEntry;
}

/** A fake directory whose reader hands out its children two at a time, like a real one in batches. */
function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          const batch = children.slice(at, at + 2);
          at += batch.length;
          ok(batch);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

const names = (files: File[]) => files.map((f) => f.name).sort();

describe("filesFromEntries", () => {
  it("collects the PDFs of a dropped folder, nested ones too", async () => {
    const folder = dirEntry("payslips", [
      fileEntry(pdf("2026-01 pay.pdf")),
      fileEntry(new File(["x"], "notes.txt")),
      dirEntry("2025", [fileEntry(pdf("2025-12 pay.PDF")), dirEntry("empty", []), fileEntry(pdf("2025-11 pay.pdf"))]),
      fileEntry(pdf("2026-02 pay.pdf")),
    ]);
    expect(names(await filesFromEntries([folder]))).toEqual(["2025-11 pay.pdf", "2025-12 pay.PDF", "2026-01 pay.pdf", "2026-02 pay.pdf"]);
  });

  it("passes dropped files through as they are", async () => {
    const got = await filesFromEntries([fileEntry(pdf("2026-01 pay.pdf")), fileEntry(new File(["x"], "notes.txt"))]);
    expect(names(got)).toEqual(["2026-01 pay.pdf", "notes.txt"]);
  });
});

describe("entriesOf", () => {
  it("is null when the browser gives no entries, so the plain file list is used", () => {
    const dt = { items: [{ kind: "file", getAsFile: () => pdf("a.pdf") }], files: [] } as unknown as DataTransfer;
    expect(entriesOf(dt)).toBeNull();
  });

  it("takes each dropped item's entry", () => {
    const entry = fileEntry(pdf("a.pdf"));
    const dt = { items: [{ kind: "file", webkitGetAsEntry: () => entry }, { kind: "string" }], files: [] } as unknown as DataTransfer;
    expect(entriesOf(dt)).toEqual([entry]);
  });
});
