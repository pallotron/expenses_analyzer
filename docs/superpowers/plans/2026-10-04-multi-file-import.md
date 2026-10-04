# Multi-file import: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/import` into a list, so that a month's statements go in together in one
pass. Each file gets a source picked by hand and a dry-run status. One button imports
every ready file in order, then makes one Gemini call.

**Architecture:**
- **Worker:** `importTransactions` gains `dryRun`, which returns before its first
  write. `POST /api/import` passes it through. A new `GET /api/import/sources` returns
  each source's saved mapping and its last live date.
- **Frontend:** the page becomes a pure reducer over file rows (`importList.ts`) plus a
  small check scheduler (`checkQueue.ts`), with presentational `FileRow` and `FilePanel`
  components. `useDryRun` runs the checks and `useImportAll` runs the imports.

**Tech stack:**
- Worker: Hono, drizzle 0.44 on D1, zod 4.
- Frontend: React 19, TanStack Query, Tailwind.
- Tests: Vitest with Testing Library.
- No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-multi-file-import-design.md`

## Global Constraints

- **VCS:** jj only, never git write commands. Each task is one jj change: `jj describe -m "<message>"`, then `jj new`.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Privacy:** the repo is public.
  - Test data is synthetic: no real names, banks, merchants, paths or account numbers.
  - Never open, copy or quote anything from `~/Downloads/CSVs`.
- **Dependencies:** in `worker/`, never `npm install <pkg>`. This plan adds no dependency anywhere.
- **D1:** at most 100 bound parameters per statement. Lists go as one `JSON.stringify` value read with `json_each`.
- **Sources:** chosen by hand per file. Nothing is guessed from file names or account numbers.
- **Saved mapping:** the column mapping remembered per source name (`settings.import_mappings`). File names are never stored or compared.
- **Import all:** one `POST /api/import` per file, in list order. A failed file never stops the others.
- **Gemini:** at most one `POST /api/merchants/suggest` per run, and only when the box is ticked, Gemini is configured, and some file reported new merchants.
- **Cap:** 5,000 rows per file (`MAX_IMPORT_ROWS`).
- **Copy, verbatim:**
  - Intro: "Pick each statement's account. Nothing is saved until you press Import."
  - Section: "Where each source left off".
  - Drop zone: "Drop statements here or choose files" and ".csv, .xls or .xlsx".
  - Statuses: as in Task 5's `statusText`.
- **Tooling:**
  - Worker tests: `cd worker && npx vitest run <path>`. Typecheck: `cd worker && npm run -s typecheck`.
  - Frontend tests: `cd frontend && npx vitest run <path>`. Typecheck: `cd frontend && npx tsc -b --noEmit`. Build: `cd frontend && npm run -s build`.
- **Tests with large tables** (100+ rows) use DOM or label queries, not role queries. Role queries over big tables time out in CI.

## Review Focus

1. **A dry-run answer that lands after the row's mapping or source changed** must be
   ignored. Pinned by `version`: Task 3 (reducer) and Task 6 (page test "ignores a check
   answer for an older mapping").
2. **Two files of the same source in one run:** the second is re-checked against the
   first file's rows before it imports, so its counts are true. Task 7, "re-checks a
   second file of the same source before importing it".
3. **A file still reading when its row is removed, or when Start over is pressed,** must
   not come back when the read lands. Task 3, "ignores actions for rows that are gone".
4. **A file that fails mid-run:** the others still import, and Retry imports only that
   file. Task 7, "keeps going after a failed file, and Retry imports just that file".
5. **A source named `constructor`** (user-typed names over a plain object) must not
   pick up `Object.prototype`. Task 2 (route) and Task 3 (reducer).

---

### Task 1: Dry run on the import

**Files:**
- Modify: `worker/src/services/transactions.ts`. Change `ImportOptions` and `ImportResult` (around lines 59–75), and return early before the `import_batches` insert (around line 235).
- Modify: `worker/src/api/import.ts`. Change `ImportRequest` and `ImportResponse`.
- Modify: `worker/src/routes/import.ts`. Add `dryRun` to the body schema, and skip the mapping save on a dry run.
- Test: `worker/src/__tests__/app/importRoute.test.ts` (append).

**Interfaces:**
- Consumes: none from other tasks.
- Produces:
  - `ImportOptions.dryRun?: boolean`.
  - `ImportResult.batchId: number | null`.
  - `ImportRequest.dryRun?: boolean`.
  - `ImportResponse.batchId: number | null`.
  - `POST /api/import` accepts `dryRun: true`. It answers with the same counts and `batchId: null`, writes nothing, and saves no mapping.

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/__tests__/app/importRoute.test.ts`, after the `describe("POST /api/import", …)` block:

```ts
describe("POST /api/import with dryRun", () => {
  const tally = (s: ReturnType<typeof setup>) => s.sqlite.prepare(`
    SELECT (SELECT count(*) FROM transactions) AS t, (SELECT count(*) FROM merchants) AS m,
           (SELECT count(*) FROM import_batches) AS b
  `).get();

  it("reports what the import would do, and writes nothing", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: [ROWS[0]] });
    const before = tally(s);
    const res = await s.send("POST", "/api/import", {
      source: "Other", mapping: { ...MAPPING, dateOrder: "mdy" }, rows: ROWS, dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: null, inserted: 1, duplicates: 1, suppressedDeleted: 0, newMerchants: ["Acme Payroll"],
    });
    expect(tally(s)).toEqual(before);
    expect(await s.mappings()).toEqual({ mappings: { Card: MAPPING } });
  });

  it("counts deleted rows and repeats exactly as the import then does", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: [ROWS[0]] });
    s.sqlite.prepare(`UPDATE transactions SET deleted_at = unixepoch()`).run();
    const body = { source: "Card", mapping: MAPPING, rows: [ROWS[0], ROWS[1], ROWS[1]] };
    const dry = await (await s.send("POST", "/api/import", { ...body, dryRun: true })).json();
    expect(dry).toEqual({ batchId: null, inserted: 2, duplicates: 0, suppressedDeleted: 1, newMerchants: ["Acme Payroll"] });
    const real = await (await s.send("POST", "/api/import", body)).json();
    expect(real).toEqual({ ...dry, batchId: expect.any(Number) });
  });

  it("refuses the rows the import refuses", async () => {
    const res = await setup().send("POST", "/api/import", {
      source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], merchant: " " }], dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "The file has rows the import refuses",
      errors: ["Found 1 row(s) with empty or missing merchant names"],
    });
  });

  it("takes only a boolean", async () => {
    const res = await setup().send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS, dryRun: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input: expected boolean, received string" });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd worker && npx vitest run src/__tests__/app/importRoute.test.ts`

Expected: the four new tests FAIL. `dryRun` is an unrecognized key, so you get a 400 "Unrecognized key".

- [ ] **Step 3: Implement**

In `worker/src/services/transactions.ts`, add to `ImportOptions`:

```ts
  /** Count what the import would do, and write nothing. */
  dryRun?: boolean;
```

Change `ImportResult.batchId` to:

```ts
  /** Null for a dry run, which records no batch. */
  batchId: number | null;
```

Directly after `const newMerchants = names.filter((n) => !known.has(n)).sort();`, and
before the `// Created outside the atomic write…` comment, add:

```ts
  // Everything above only reads, so a dry run's counts are the import's own.
  if (options.dryRun) {
    return { batchId: null, inserted: toInsert.length, duplicates, suppressedDeleted, newMerchants };
  }
```

In `worker/src/api/import.ts`, replace the two interfaces:

```ts
/** `dryRun`: answer with the counts the import would give, writing nothing. */
export interface ImportRequest { source: string; filename?: string; mapping: ImportMapping; rows: ImportRequestRow[]; dryRun?: boolean }
/** `batchId` is null for a dry run. */
export interface ImportResponse { batchId: number | null; inserted: number; duplicates: number; suppressedDeleted: number; newMerchants: string[] }
```

In `worker/src/routes/import.ts`, add to `ImportBody` (inside the object, after `rows`):

```ts
  dryRun: z.boolean().optional(),
```

Then replace the route body's destructuring, call and save with:

```ts
    const { source, filename, mapping, rows, dryRun } = body.data;
    const userId = c.get("user").id;
    try {
      const result = await importTransactions(c.get("db"), rows, { source, filename, userId, dryRun });
      if (dryRun) return c.json(result satisfies ImportResponse);
      // The rows are in: failing to remember the mapping must not read as a failed import.
      try {
        await saveImportMapping(c.get("db"), source, mapping, userId);
      } catch (e) {
        console.error("Import: could not save the column mapping", e instanceof Error ? e.message : "unknown error");
      }
      return c.json(result satisfies ImportResponse);
```

Update the file's top comment to mention the dry run: "…the mappings it remembers. With
`dryRun`, only the counts."

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd worker && npx vitest run src/__tests__/app/importRoute.test.ts && npm run -s typecheck`

Expected: everything passes. If the typecheck flags another caller that assumes
`batchId: number`, narrow it there (`batchId!` is wrong; check for `null`, or assert in
the test).

Then run the whole Worker suite: `cd worker && npx vitest run`. Everything passes.

- [ ] **Step 5: Commit**

```bash
jj describe -m "Let the import answer a dry run with its own counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 2: Sources with their mapping and last date

**Files:**
- Modify: `worker/src/api/import.ts`. Add `ImportSource` and `ImportSourcesResponse`.
- Modify: `worker/src/services/importMappings.ts`. Add `listImportSources`.
- Modify: `worker/src/routes/import.ts`. Add `GET /import/sources`, and keep `/import/mappings` until Task 6.
- Test: `worker/src/__tests__/app/importRoute.test.ts` (append).

**Interfaces:**
- Consumes: `loadImportMappings`, `saveImportMapping` (existing).
- Produces:
  - `interface ImportSource { name: string; lastDate: string | null; mapping: ImportMapping | null }`
  - `interface ImportSourcesResponse { sources: ImportSource[] }`
  - `listImportSources(db: Db): Promise<ImportSource[]>`
  - `GET /api/import/sources` → `ImportSourcesResponse`

- [ ] **Step 1: Write the failing tests**

In `worker/src/__tests__/app/importRoute.test.ts`, add this import beside the existing
`import * as importMappings …`:

```ts
import { saveImportMapping } from "../../services/importMappings";
```

Append:

```ts
describe("GET /api/import/sources", () => {
  const sources = async (s: ReturnType<typeof setup>) => (await (await s.send("GET", "/api/import/sources")).json());
  const userId = (s: ReturnType<typeof setup>) => (s.sqlite.prepare(`SELECT id FROM users LIMIT 1`).get() as { id: number }).id;

  it("is empty with no transactions and no mappings", async () => {
    expect(await sources(setup())).toEqual({ sources: [] });
  });

  it("lists each source, sorted, with its last live date and its saved mapping", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: ROWS });
    await s.send("POST", "/api/import", { source: "Card", mapping: MAPPING, rows: [{ ...ROWS[0], date: "2026-09-20", merchant: "Late Shop" }] });
    await s.send("POST", "/api/import", { source: "Cash", mapping: MAPPING, rows: [{ ...ROWS[0], date: "2026-08-15", merchant: "Kiosk" }] });
    // A deleted row is not where a source left off; a source with only deleted rows has no date.
    s.sqlite.prepare(`UPDATE transactions SET deleted_at = unixepoch() WHERE merchant_raw IN ('Late Shop', 'Kiosk')`).run();
    await saveImportMapping(s.db, "Bank", { ...MAPPING, amountOut: "Out" }, userId(s));
    expect(await sources(s)).toEqual({
      sources: [
        { name: "Bank", lastDate: null, mapping: { ...MAPPING, amountOut: "Out" } },
        { name: "Card", lastDate: "2026-09-02", mapping: MAPPING },
        { name: "Cash", lastDate: null, mapping: MAPPING },
      ],
    });
  });

  it("takes a source named like an object's own property", async () => {
    const s = setup();
    await s.send("POST", "/api/import", { source: "constructor", mapping: MAPPING, rows: ROWS });
    expect(await sources(s)).toEqual({ sources: [{ name: "constructor", lastDate: "2026-09-02", mapping: MAPPING }] });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd worker && npx vitest run src/__tests__/app/importRoute.test.ts`

Expected: the new tests FAIL with a 404, or with JSON parsing of the fallback answer.

- [ ] **Step 3: Implement**

In `worker/src/api/import.ts`, add after `ImportMappingsResponse`:

```ts
/** A source the import page offers: its saved mapping, and where its rows stop. */
export interface ImportSource {
  name: string;
  /** YYYY-MM-DD of its latest live transaction; null when it has none. */
  lastDate: string | null;
  mapping: ImportMapping | null;
}
export interface ImportSourcesResponse { sources: ImportSource[] }
```

In `worker/src/services/importMappings.ts`, change the imports and add the function:

```ts
import { eq, sql } from "drizzle-orm";
import type { ImportMapping, ImportSource } from "../api/import";
import { settings, transactions } from "../db/schema";
import type { Db } from "../db/types";
```

```ts
/**
 * Every source with transactions or a saved mapping, by name. `lastDate`
 * counts live rows only, so a deletion never claims a month is imported.
 */
export async function listImportSources(db: Db): Promise<ImportSource[]> {
  const [mappings, last] = await Promise.all([
    loadImportMappings(db),
    db.select({
      source: transactions.source,
      lastDate: sql<string | null>`date(MAX(CASE WHEN ${transactions.deletedAt} IS NULL THEN ${transactions.date} END), 'unixepoch')`,
    }).from(transactions).groupBy(transactions.source),
  ]);
  const dates = new Map(last.map((r) => [r.source, r.lastDate]));
  const names = [...new Set([...dates.keys(), ...Object.keys(mappings)])].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({
    name,
    lastDate: dates.get(name) ?? null,
    // Source names are typed by people; the settings value is a plain object.
    mapping: Object.hasOwn(mappings, name) ? mappings[name] : null,
  }));
}
```

(If the schema's column property is not `deletedAt`, use its actual name; it maps the
`deleted_at` column.)

In `worker/src/routes/import.ts`, import `listImportSources` and
`type ImportSourcesResponse`, and add before `return routes;`:

```ts
  routes.get("/import/sources", async (c) =>
    c.json({ sources: await listImportSources(c.get("db")) } satisfies ImportSourcesResponse));
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd worker && npx vitest run src/__tests__/app/importRoute.test.ts && npm run -s typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "List import sources with their mapping and last date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 3: The file list as a reducer

**Files:**
- Modify: `frontend/src/lib/types.ts`. Re-export `ImportSource` and `ImportSourcesResponse` beside the other import types.
- Create: `frontend/src/import/importList.ts`
- Test: `frontend/src/__tests__/import/importList.test.ts`

**Interfaces:**
- Consumes:
  - `startMapping(header, saved?)` → `{ mapping, fits, missing }` (existing, `frontend/src/import/startMapping.ts`).
  - From `lib/types`: `processRows`, `findHeaderRow`, `columnNames`, `missingColumns`, and `MAX_IMPORT_ROWS`.
  - The types `ImportMapping`, `ImportRequest`, `ImportResponse` and `ParsedImport`.
- Produces (`frontend/src/import/importList.ts`):
  - `NEW_SOURCE = "__new__"`
  - `interface Counts { inserted: number; duplicates: number; suppressedDeleted: number; newMerchants: string[] }`
  - `type Check`, `type Run`, `interface FileRow` (fields below)
  - `type RowStatus` (the union below), `rowStatus(row): RowStatus`, `isReady(row): boolean`
  - `type Action` (the union below), `importList(rows: FileRow[], action: Action): FileRow[]`
  - `requestFor(row: FileRow, dryRun: boolean): ImportRequest`
  - `type SavedMappings = Record<string, ImportMapping>`

- [ ] **Step 1: Re-export the new types**

In `frontend/src/lib/types.ts`, extend the import-types export:

```ts
export type {
  ImportMapping, ImportMappingsResponse, ImportRequest, ImportRequestRow, ImportResponse,
  ImportSource, ImportSourcesResponse,
} from "../../../worker/src/api/import";
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/__tests__/import/importList.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd frontend && npx vitest run src/__tests__/import/importList.test.ts`

Expected: FAIL with "Cannot find module '../../import/importList'".

- [ ] **Step 4: Implement**

Create `frontend/src/import/importList.ts`:

```ts
/**
 * The import page's files, one row each, as a pure reducer. Every change
 * that can alter what a row would import bumps its `version`; check answers
 * carry the version they were asked for, and older ones are ignored.
 */

import {
  columnNames, findHeaderRow, MAX_IMPORT_ROWS, missingColumns, processRows,
  type ImportMapping, type ImportRequest, type ImportResponse, type ParsedImport,
} from "../lib/types";
import { startMapping } from "./startMapping";

export const NEW_SOURCE = "__new__";
const NEW_SOURCE_NAME = "CSV Import";

export type SavedMappings = Record<string, ImportMapping>;
export interface Counts { inserted: number; duplicates: number; suppressedDeleted: number; newMerchants: string[] }

export type Check =
  | { state: "idle" }
  | { state: "checking"; version: number }
  | { state: "done"; version: number; counts: Counts }
  | { state: "failed"; version: number; message: string; errors?: string[]; refused: boolean };

export type Run =
  | { state: "no" }
  | { state: "importing" }
  | { state: "done"; result: ImportResponse }
  | { state: "failed"; message: string; errors?: string[] };

export interface FileRow {
  id: string;
  file: File;
  /** Name, size and modified time: the same file dropped twice. */
  fingerprint: string;
  /** The earlier row holding the same file, if any. */
  sameAs: string | null;
  grid: string[][] | null;
  readError: string | null;
  /** The select's value: a source name, NEW_SOURCE, or "". */
  choice: string;
  newName: string;
  /** The source the row imports into; "" for none. */
  source: string;
  mapping: ImportMapping | null;
  parsed: ParsedImport | null;
  /** A saved mapping fitted, or the user accepted the columns. */
  confirmed: boolean;
  open: boolean;
  editing: boolean;
  version: number;
  check: Check;
  run: Run;
}

export type RowStatus =
  | { kind: "reading" }
  | { kind: "readFailed"; message: string }
  | { kind: "sameFile" }
  | { kind: "leftOut" }
  | { kind: "needsMapping"; missing: string[] }
  | { kind: "nothing" }
  | { kind: "tooMany"; rows: number }
  | { kind: "checking" }
  | { kind: "ready"; counts: Counts; skipped: number }
  | { kind: "checkFailed"; message: string }
  | { kind: "refused"; message: string; errors: string[] }
  | { kind: "importing" }
  | { kind: "imported"; result: ImportResponse }
  | { kind: "importFailed"; message: string; errors: string[] };

export type Action =
  | { type: "add"; files: { id: string; file: File }[] }
  | { type: "read"; id: string; grid: string[][]; saved: SavedMappings }
  | { type: "readFailed"; id: string; message: string }
  | { type: "choose"; id: string; choice: string; saved: SavedMappings }
  | { type: "rename"; id: string; name: string; saved: SavedMappings }
  | { type: "mapping"; id: string; mapping: ImportMapping }
  | { type: "confirm"; id: string }
  | { type: "toggle"; id: string }
  | { type: "edit"; id: string }
  | { type: "checkStart"; id: string; version: number }
  | { type: "checked"; id: string; version: number; counts: Counts }
  | { type: "checkFailed"; id: string; version: number; message: string; errors?: string[]; refused: boolean }
  | { type: "recheck"; ids: string[] }
  | { type: "importStart"; id: string }
  | { type: "imported"; id: string; result: ImportResponse }
  | { type: "importFailed"; id: string; message: string; errors?: string[] }
  | { type: "remove"; id: string }
  | { type: "reset" };

const IDLE: Check = { state: "idle" };
const fingerprintOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const sourceOf = (choice: string, newName: string) => (choice === NEW_SOURCE ? newName.trim() : choice);
// Source names are typed by people and the map is a plain object.
const savedFor = (saved: SavedMappings, name: string) => (Object.hasOwn(saved, name) ? saved[name] : undefined);
const complete = (m: ImportMapping) => m.date !== "" && m.merchant !== "" && m.amount !== "";
const skippedCount = (p: ParsedImport) => Object.values(p.skipped).reduce((n, lines) => n + lines.length, 0);

/** Start the row's mapping for `source`: its saved one when it fits, else a guess to confirm. */
function withSource(row: FileRow, source: string, saved: SavedMappings): FileRow {
  const version = row.version + 1;
  if (!row.grid || !source) {
    return { ...row, source, mapping: null, parsed: null, confirmed: false, editing: false, version, check: IDLE };
  }
  const own = savedFor(saved, source);
  const at = findHeaderRow(row.grid, own);
  const header = at < 0 ? [] : columnNames(row.grid[at]).filter((n): n is string => n !== null);
  const start = startMapping(header, own);
  return {
    ...row, source, mapping: start.mapping, parsed: processRows(row.grid, start.mapping),
    confirmed: start.fits, open: row.open || !start.fits, editing: !start.fits, version, check: IDLE,
  };
}

export function rowStatus(row: FileRow): RowStatus {
  if (row.run.state === "importing") return { kind: "importing" };
  if (row.run.state === "done") return { kind: "imported", result: row.run.result };
  if (row.run.state === "failed") return { kind: "importFailed", message: row.run.message, errors: row.run.errors ?? [] };
  if (row.readError !== null) return { kind: "readFailed", message: row.readError };
  if (!row.grid) return { kind: "reading" };
  if (!row.source) return row.sameAs ? { kind: "sameFile" } : { kind: "leftOut" };
  if (!row.mapping || !row.parsed) return { kind: "needsMapping", missing: [] };
  const missing = missingColumns(row.parsed.header, row.mapping);
  if (!row.confirmed || missing.length > 0 || !complete(row.mapping)) return { kind: "needsMapping", missing };
  const n = row.parsed.rows.length;
  if (n === 0) return { kind: "nothing" };
  if (n > MAX_IMPORT_ROWS) return { kind: "tooMany", rows: n };
  const c = row.check;
  if (c.state === "done" && c.version === row.version) return { kind: "ready", counts: c.counts, skipped: skippedCount(row.parsed) };
  if (c.state === "failed" && c.version === row.version) {
    return c.refused ? { kind: "refused", message: c.message, errors: c.errors ?? [] } : { kind: "checkFailed", message: c.message };
  }
  return { kind: "checking" };
}

export const isReady = (row: FileRow) => rowStatus(row).kind === "ready";

/** What POST /api/import takes for this row. Call only for a row with a mapping and parsed rows. */
export function requestFor(row: FileRow, dryRun: boolean): ImportRequest {
  return {
    source: row.source,
    filename: row.file.name,
    mapping: row.mapping as ImportMapping,
    rows: (row.parsed as ParsedImport).rows.map(({ date, merchant, amountCents, type }) => ({ date, merchant, amountCents, type })),
    ...(dryRun && { dryRun: true }),
  };
}

function update(rows: FileRow[], id: string, change: (row: FileRow) => FileRow): FileRow[] {
  // A row that is gone (removed, or the list reset) ignores late answers.
  return rows.map((r) => (r.id === id ? change(r) : r));
}

export function importList(rows: FileRow[], action: Action): FileRow[] {
  switch (action.type) {
    case "add": {
      const next = [...rows];
      for (const { id, file } of action.files) {
        const fingerprint = fingerprintOf(file);
        next.push({
          id, file, fingerprint, sameAs: next.find((r) => r.fingerprint === fingerprint)?.id ?? null,
          grid: null, readError: null, choice: "", newName: NEW_SOURCE_NAME, source: "",
          mapping: null, parsed: null, confirmed: false, open: false, editing: false,
          version: 0, check: IDLE, run: { state: "no" },
        });
      }
      // A lone file opens, as the single-file page did.
      if (rows.length === 0 && next.length === 1) next[0] = { ...next[0], open: true };
      return next;
    }
    case "read":
      return update(rows, action.id, (r) => withSource({ ...r, grid: action.grid, readError: null }, r.source, action.saved));
    case "readFailed":
      return update(rows, action.id, (r) => ({ ...r, grid: null, readError: action.message }));
    case "choose":
      return update(rows, action.id, (r) => withSource({ ...r, choice: action.choice }, sourceOf(action.choice, r.newName), action.saved));
    case "rename":
      return update(rows, action.id, (r) => {
        const next = { ...r, newName: action.name };
        const source = sourceOf(r.choice, action.name);
        return r.choice === NEW_SOURCE && source !== r.source ? withSource(next, source, action.saved) : next;
      });
    case "mapping":
      return update(rows, action.id, (r) => (r.grid
        ? { ...r, mapping: action.mapping, parsed: processRows(r.grid, action.mapping), version: r.version + 1, check: IDLE }
        : r));
    case "confirm":
      return update(rows, action.id, (r) => ({ ...r, confirmed: true, editing: false, version: r.version + 1, check: IDLE }));
    case "toggle":
      return update(rows, action.id, (r) => ({ ...r, open: !r.open }));
    case "edit":
      return update(rows, action.id, (r) => ({ ...r, open: true, editing: true }));
    case "checkStart":
      return update(rows, action.id, (r) => (r.version === action.version ? { ...r, check: { state: "checking", version: action.version } } : r));
    case "checked":
      return update(rows, action.id, (r) => (r.version === action.version
        ? { ...r, check: { state: "done", version: action.version, counts: action.counts } } : r));
    case "checkFailed":
      return update(rows, action.id, (r) => (r.version === action.version
        ? { ...r, check: { state: "failed", version: action.version, message: action.message, errors: action.errors, refused: action.refused } }
        : r));
    case "recheck": {
      const ids = new Set(action.ids);
      return rows.map((r) => (ids.has(r.id) && r.run.state === "no" ? { ...r, version: r.version + 1, check: IDLE } : r));
    }
    case "importStart":
      return update(rows, action.id, (r) => ({ ...r, run: { state: "importing" } }));
    case "imported":
      return update(rows, action.id, (r) => ({ ...r, run: { state: "done", result: action.result } }));
    case "importFailed":
      return update(rows, action.id, (r) => ({ ...r, run: { state: "failed", message: action.message, errors: action.errors } }));
    case "remove":
      return rows.filter((r) => r.id !== action.id);
    case "reset":
      return [];
  }
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd frontend && npx vitest run src/__tests__/import/importList.test.ts && npx tsc -b --noEmit`

Expected: PASS. If a date in `requestFor`'s expectation differs from what `processRows`
gives for `01/09/2026` with `dmy` (it should be `2026-09-01`), read `processRows` before
touching the test. Never weaken an assertion to make it pass.

- [ ] **Step 6: Commit**

```bash
jj describe -m "Model the import page's files as a reducer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 4: The check scheduler

**Files:**
- Create: `frontend/src/import/checkQueue.ts`
- Test: `frontend/src/__tests__/import/checkQueue.test.ts`

**Interfaces:**
- Produces:
  - `interface CheckQueue { schedule(id: string, version: number): void; cancel(id: string): void; cancelAll(): void }`
  - `createCheckQueue(opts: { run: (id: string, version: number) => Promise<void>; delayMs?: number; limit?: number }): CheckQueue`. The defaults are 400 ms and 3.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/import/checkQueue.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCheckQueue } from "../../import/checkQueue";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the check queue", () => {
  it("waits for a pause and runs only the latest schedule for a row", async () => {
    const run = vi.fn(async () => {});
    const q = createCheckQueue({ run });
    q.schedule("a", 1);
    await vi.advanceTimersByTimeAsync(200);
    q.schedule("a", 2);
    await vi.advanceTimersByTimeAsync(399);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.mock.calls).toEqual([["a", 2]]);
  });

  it("runs at most three at once, starting the next as one finishes", async () => {
    const done: (() => void)[] = [];
    const run = vi.fn(() => new Promise<void>((resolve) => done.push(resolve)));
    const q = createCheckQueue({ run });
    for (const id of ["a", "b", "c", "d", "e"]) q.schedule(id, 1);
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(3);
    done[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps going when a run fails", async () => {
    const run = vi.fn(async (id: string) => { if (id === "a") throw new Error("down"); });
    const q = createCheckQueue({ run, limit: 1 });
    q.schedule("a", 1);
    q.schedule("b", 1);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("drops a cancelled row, waiting or not yet due", async () => {
    const run = vi.fn(async () => {});
    const q = createCheckQueue({ run, limit: 1 });
    q.schedule("a", 1);
    q.schedule("b", 1);
    q.cancel("b");
    await vi.advanceTimersByTimeAsync(400);
    q.schedule("c", 1);
    q.cancelAll();
    await vi.advanceTimersByTimeAsync(400);
    expect(run.mock.calls).toEqual([["a", 1]]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd frontend && npx vitest run src/__tests__/import/checkQueue.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

Create `frontend/src/import/checkQueue.ts`:

```ts
/**
 * Dry runs for the import list: each row waits for a pause in editing
 * (`delayMs`), only its latest schedule counts, and at most `limit` run at
 * once. Answers are matched to rows by version elsewhere; this only paces.
 */

export interface CheckQueue {
  schedule(id: string, version: number): void;
  cancel(id: string): void;
  cancelAll(): void;
}

export function createCheckQueue(opts: {
  run: (id: string, version: number) => Promise<void>; delayMs?: number; limit?: number;
}): CheckQueue {
  const delay = opts.delayMs ?? 400;
  const limit = opts.limit ?? 3;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let waiting: { id: string; version: number }[] = [];
  let active = 0;

  const pump = () => {
    while (active < limit && waiting.length > 0) {
      const job = waiting.shift() as { id: string; version: number };
      active += 1;
      opts.run(job.id, job.version)
        .catch(() => {}) // the run reports its own failure; the queue only keeps going
        .finally(() => { active -= 1; pump(); });
    }
  };
  const cancel = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    waiting = waiting.filter((j) => j.id !== id);
  };

  return {
    schedule(id, version) {
      cancel(id);
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        waiting.push({ id, version });
        pump();
      }, delay));
    },
    cancel,
    cancelAll() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      waiting = [];
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/__tests__/import/checkQueue.test.ts && npx tsc -b --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "Pace the import list's dry runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 5: A file's row and its panel

**Files:**
- Create: `frontend/src/import/FileRow.tsx`. Exports `FileRowView` and `statusText`.
- Create: `frontend/src/import/FilePanel.tsx`
- Test: `frontend/src/__tests__/import/FileRow.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 3: `FileRow`, `RowStatus`, `rowStatus`, `Action`, `NEW_SOURCE` and `SavedMappings`.
  - Existing: `MappingForm` (props `header`, `headerRow`, `gridRows`, `mapping`, `onChange`), `mappingSummary`, `RawGrid` (props `grid`, `headerRow`), and `Preview` (props `parsed`, `mapping`).
  - From `lib/types`: `commaDecimalSample(grid, mapping): string | null` and `missingColumns`.
- Produces:
  - `statusText(status: RowStatus): string`
  - `FileRowView(props: { row: FileRow; sources: string[]; saved: SavedMappings; locked: boolean; dispatch: (a: Action) => void; onRetryCheck: (id: string) => void; onRetryImport: (id: string) => void })`
  - `FilePanel(props: { row: FileRow; locked: boolean; dispatch: (a: Action) => void })`
  - Accessible names, which later tests rely on:
    - `Source for <file name>` (the select);
    - `New source name for <file name>`;
    - `Status of <file name>`;
    - `Remove <file name>`;
    - the toggle `Show <file name>` / `Hide <file name>`;
    - the buttons `Use these columns` and `Retry`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/import/FileRow.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileRowView, statusText } from "../../import/FileRow";
import { importList, type Action, type FileRow } from "../../import/importList";
import type { ImportMapping } from "../../lib/types";

afterEach(cleanup);

const GRID = [["Date", "Description", "Amount"], ["01/09/2026", "Corner Shop", "-6,55"]];
const MAP: ImportMapping = { date: "Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const result = { batchId: 1, inserted: 3, duplicates: 2, suppressedDeleted: 1, newMerchants: [] };
const counts = { inserted: 33, duplicates: 26, suppressedDeleted: 0, newMerchants: [] };

function rowAfter(actions: Action[]): FileRow {
  return actions.reduce(importList, [] as FileRow[])[0];
}
const base: Action[] = [
  { type: "add", files: [{ id: "f1", file: new File(["x"], "sept.csv") }, { id: "f2", file: new File(["y"], "other.csv") }] },
  { type: "read", id: "f1", grid: GRID, saved: { Card: MAP } },
];

describe("statusText", () => {
  it.each([
    [{ kind: "reading" }, "Reading…"],
    [{ kind: "readFailed", message: "Choose a .csv, .xls or .xlsx file" }, "Couldn't read: Choose a .csv, .xls or .xlsx file"],
    [{ kind: "sameFile" }, "Same file as above"],
    [{ kind: "leftOut" }, "Left out"],
    [{ kind: "needsMapping", missing: [] }, "Needs mapping: choose its columns"],
    [{ kind: "needsMapping", missing: ["Started Date"] }, "Needs mapping: no 'Started Date' column"],
    [{ kind: "needsMapping", missing: ["A", "B"] }, "Needs mapping: no 'A', 'B' columns"],
    [{ kind: "nothing" }, "Nothing to import"],
    [{ kind: "tooMany", rows: 5001 }, "Too many rows (5001): split the file"],
    [{ kind: "checking" }, "Checking…"],
    [{ kind: "ready", counts, skipped: 0 }, "Ready · 33 new · 26 already there"],
    [{ kind: "ready", counts: { ...counts, suppressedDeleted: 4 }, skipped: 1 }, "Ready · 33 new · 26 already there · 4 deleted · 1 skipped"],
    [{ kind: "checkFailed", message: "Request failed (500)" }, "Couldn't check: Request failed (500)"],
    [{ kind: "refused", message: "The file has rows the import refuses", errors: [] }, "Refused: The file has rows the import refuses"],
    [{ kind: "importing" }, "Importing…"],
    [{ kind: "imported", result }, "Imported 3 · 2 already there · 1 deleted"],
    [{ kind: "importFailed", message: "Request failed (500)", errors: [] }, "Failed: Request failed (500)"],
  ] as const)("%o", (status, text) => {
    expect(statusText(status)).toBe(text);
  });
});

describe("a file's row", () => {
  function show(row: FileRow, locked = false) {
    const dispatch = vi.fn();
    const onRetryCheck = vi.fn();
    const onRetryImport = vi.fn();
    render(<ul><FileRowView row={row} sources={["Card", "Cash"]} saved={{ Card: MAP }} locked={locked}
      dispatch={dispatch} onRetryCheck={onRetryCheck} onRetryImport={onRetryImport} /></ul>);
    return { dispatch, onRetryCheck, onRetryImport };
  }

  it("picks a source, removes, and opens", async () => {
    const { dispatch } = show(rowAfter(base));
    expect(screen.getByLabelText("Status of sept.csv")).toHaveTextContent("Left out");
    await userEvent.selectOptions(screen.getByLabelText("Source for sept.csv"), "Card");
    expect(dispatch).toHaveBeenCalledWith({ type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } });
    await userEvent.click(screen.getByRole("button", { name: "Remove sept.csv" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "remove", id: "f1" });
    await userEvent.click(screen.getByRole("button", { name: "Show sept.csv" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggle", id: "f1" });
  });

  it("asks to confirm the columns for a source without a saved mapping", async () => {
    const row = rowAfter([...base, { type: "choose", id: "f1", choice: "Cash", saved: { Card: MAP } }]);
    const { dispatch } = show(row);
    expect(screen.getByRole("group", { name: "Mapping" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use these columns" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm", id: "f1" });
  });

  it("warns about comma decimals on the row itself", () => {
    show(rowAfter([...base, { type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } }]));
    expect(screen.getByRole("alert")).toHaveTextContent(`Some amounts use a comma for decimals (e.g. "-6,55")`);
  });

  it("offers Retry for a failed check and a failed import", async () => {
    const chosen = rowAfter([...base, { type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } }]);
    const failedCheck = importList([chosen], { type: "checkFailed", id: "f1", version: chosen.version, message: "down", refused: false })[0];
    const a = show(failedCheck);
    await userEvent.click(within(screen.getByLabelText("Status of sept.csv")).getByRole("button", { name: "Retry" }));
    expect(a.onRetryCheck).toHaveBeenCalledWith("f1");
    cleanup();
    const failedImport = importList([chosen], { type: "importFailed", id: "f1", message: "The file has rows the import refuses", errors: ["Found 1 bad date"] })[0];
    const b = show(failedImport);
    expect(screen.getByText("Found 1 bad date")).toBeInTheDocument();
    await userEvent.click(within(screen.getByLabelText("Status of sept.csv")).getByRole("button", { name: "Retry" }));
    expect(b.onRetryImport).toHaveBeenCalledWith("f1");
  });

  it("locks its controls while importing", () => {
    show(rowAfter([...base, { type: "choose", id: "f1", choice: "Card", saved: { Card: MAP } }]), true);
    expect(screen.getByLabelText("Source for sept.csv")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove sept.csv" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd frontend && npx vitest run src/__tests__/import/FileRow.test.tsx`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the panel**

Create `frontend/src/import/FilePanel.tsx`:

```tsx
import { MappingForm, mappingSummary } from "./MappingForm";
import { Preview } from "./Preview";
import { RawGrid } from "./RawGrid";
import { missingColumns } from "../lib/types";
import type { Action, FileRow } from "./importList";

/**
 * One file's detail: its columns (form or summary), the file as read, and
 * the parsed preview. Mapping edits re-check the row; nothing is saved here.
 */
export function FilePanel(props: { row: FileRow; locked: boolean; dispatch: (a: Action) => void }) {
  const { row, dispatch } = props;
  const { mapping, parsed, grid } = row;
  const complete = !!mapping && mapping.date !== "" && mapping.merchant !== "" && mapping.amount !== "";
  const missing = mapping && parsed ? missingColumns(parsed.header, mapping) : [];
  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 py-3 dark:border-slate-800">
      {!row.source && grid && (
        <p className="text-sm text-slate-600 dark:text-slate-400">Choose a source to map its columns.</p>
      )}
      {mapping && parsed && (row.editing ? (
        <fieldset disabled={props.locked} className="contents">
          <MappingForm header={parsed.header} headerRow={parsed.headerRow} gridRows={grid?.length ?? 0}
            mapping={mapping} onChange={(m) => dispatch({ type: "mapping", id: row.id, mapping: m })} />
        </fieldset>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span>{mappingSummary(mapping)}</span>
          <button type="button" disabled={props.locked} onClick={() => dispatch({ type: "edit", id: row.id })} className="underline">Edit</button>
        </p>
      ))}
      {mapping && parsed && !row.confirmed && (
        <div>
          <button type="button" disabled={props.locked || !complete || missing.length > 0}
            onClick={() => dispatch({ type: "confirm", id: row.id })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900">
            Use these columns
          </button>
        </div>
      )}
      {grid && <RawGrid grid={grid} headerRow={parsed?.headerRow ?? -1} />}
      {mapping && parsed && <Preview key={row.version} parsed={parsed} mapping={mapping} />}
    </div>
  );
}
```

`MappingForm` renders its own `<fieldset aria-label="Mapping">`. The wrapper
`<fieldset disabled className="contents">` disables its controls while locked without
changing the layout.

- [ ] **Step 4: Implement the row**

Create `frontend/src/import/FileRow.tsx`:

```tsx
import { commaDecimalSample } from "../lib/types";
import { FilePanel } from "./FilePanel";
import { NEW_SOURCE, rowStatus, type Action, type FileRow, type RowStatus, type SavedMappings } from "./importList";

const field = "rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";

const quoted = (cols: string[]) => cols.map((c) => `'${c}'`).join(", ");
const counted = (inserted: number, duplicates: number, deleted: number) =>
  `${inserted} · ${duplicates} already there${deleted > 0 ? ` · ${deleted} deleted` : ""}`;

/** One line per status; the row adds the errors list and Retry where they apply. */
export function statusText(s: RowStatus): string {
  switch (s.kind) {
    case "reading": return "Reading…";
    case "readFailed": return `Couldn't read: ${s.message}`;
    case "sameFile": return "Same file as above";
    case "leftOut": return "Left out";
    case "needsMapping": return s.missing.length === 0 ? "Needs mapping: choose its columns"
      : `Needs mapping: no ${quoted(s.missing)} column${s.missing.length === 1 ? "" : "s"}`;
    case "nothing": return "Nothing to import";
    case "tooMany": return `Too many rows (${s.rows}): split the file`;
    case "checking": return "Checking…";
    case "ready": return `Ready · ${s.counts.inserted} new · ${s.counts.duplicates} already there`
      + `${s.counts.suppressedDeleted > 0 ? ` · ${s.counts.suppressedDeleted} deleted` : ""}`
      + `${s.skipped > 0 ? ` · ${s.skipped} skipped` : ""}`;
    case "checkFailed": return `Couldn't check: ${s.message}`;
    case "refused": return `Refused: ${s.message}`;
    case "importing": return "Importing…";
    case "imported": return `Imported ${counted(s.result.inserted, s.result.duplicates, s.result.suppressedDeleted)}`;
    case "importFailed": return `Failed: ${s.message}`;
  }
}

const ALERT = new Set<RowStatus["kind"]>(["readFailed", "needsMapping", "tooMany", "checkFailed", "refused", "importFailed"]);

export function FileRowView(props: {
  row: FileRow; sources: string[]; saved: SavedMappings; locked: boolean;
  dispatch: (a: Action) => void; onRetryCheck: (id: string) => void; onRetryImport: (id: string) => void;
}) {
  const { row, dispatch, locked } = props;
  const name = row.file.name;
  const status = rowStatus(row);
  const errors = status.kind === "refused" || status.kind === "importFailed" ? status.errors : [];
  const comma = row.grid && row.mapping && row.source ? commaDecimalSample(row.grid, row.mapping) : null;
  return (
    <li className="border-b border-slate-200 py-2 dark:border-slate-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="flex min-w-0 items-center gap-2 sm:w-64">
          <button type="button" aria-expanded={row.open} aria-label={`${row.open ? "Hide" : "Show"} ${name}`}
            onClick={() => dispatch({ type: "toggle", id: row.id })} className="w-5 shrink-0">{row.open ? "▾" : "▸"}</button>
          <span className="truncate text-sm" title={name}>{name}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <select aria-label={`Source for ${name}`} value={row.choice} disabled={locked}
            onChange={(e) => dispatch({ type: "choose", id: row.id, choice: e.target.value, saved: props.saved })}
            className={`${field} h-9`}>
            <option value="" disabled>Choose a source…</option>
            {props.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value={NEW_SOURCE}>New source…</option>
          </select>
          {row.choice === NEW_SOURCE && (
            <input aria-label={`New source name for ${name}`} defaultValue={row.newName} maxLength={100} disabled={locked}
              className={`${field} h-9`}
              onBlur={(e) => dispatch({ type: "rename", id: row.id, name: e.target.value, saved: props.saved })}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          )}
        </span>
        <div aria-label={`Status of ${name}`} className={`flex-1 text-sm ${ALERT.has(status.kind) ? "text-expense" : ""}`}>
          <span>{statusText(status)}</span>
          {(status.kind === "checkFailed" || status.kind === "refused") && (
            <button type="button" disabled={locked} onClick={() => props.onRetryCheck(row.id)} className="ml-2 underline">Retry</button>
          )}
          {status.kind === "importFailed" && (
            <button type="button" disabled={locked} onClick={() => props.onRetryImport(row.id)} className="ml-2 underline">Retry</button>
          )}
          {errors.length > 0 && <ul className="list-disc pl-5">{errors.map((e, i) => <li key={`${i}:${e}`}>{e}</li>)}</ul>}
        </div>
        <button type="button" aria-label={`Remove ${name}`} disabled={locked}
          onClick={() => dispatch({ type: "remove", id: row.id })} className="self-start px-2 sm:self-auto">✕</button>
      </div>
      {comma !== null && (
        <p role="alert" className="text-sm text-expense">
          {`Some amounts use a comma for decimals (e.g. "${comma}"); they would import 100 times too large. Fix the file's number format before importing.`}
        </p>
      )}
      {row.open && <FilePanel row={row} locked={locked} dispatch={dispatch} />}
    </li>
  );
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd frontend && npx vitest run src/__tests__/import/FileRow.test.tsx && npx tsc -b --noEmit`

Expected: PASS. The "asks to confirm" test needs the row open: `withSource` opens a row
whose mapping doesn't fit.

- [ ] **Step 6: Commit**

```bash
jj describe -m "Show each import file as a row with its own panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 6: The list page, with dry runs

The page lists files and checks them, but has no Import button until Task 7. That
intermediate state is fine on the branch.

**Files:**
- Rewrite: `frontend/src/import/ImportPage.tsx`
- Modify: `frontend/src/import/queries.ts`. `useImportSources` and `postImport` replace `useImportMappings` and `useImport`.
- Create: `frontend/src/import/useDryRun.ts`
- Modify: `frontend/src/App.tsx`. The route becomes `<ImportPage />`.
- Delete: `frontend/src/import/ImportAction.tsx` and `frontend/src/__tests__/import/importAction.test.tsx`
- Rewrite: `frontend/src/__tests__/import/harness.tsx`
- Rewrite: `frontend/src/__tests__/import/ImportPage.test.tsx`
- Modify:
  - `worker/src/routes/import.ts`: remove `GET /import/mappings`.
  - `worker/src/api/import.ts`: remove `ImportMappingsResponse`.
  - `frontend/src/lib/types.ts`: drop that re-export.
  - `worker/src/__tests__/app/importRoute.test.ts`: read mappings through `/import/sources`, and delete the `describe("GET /api/import/mappings")` block.

**Interfaces:**
- Consumes:
  - Tasks 3–5.
  - `readGrid(file)` (`frontend/src/import/grid.ts`).
  - `useLookups()` (`frontend/src/transactions/queries.ts`).
  - `ApiError` (`frontend/src/lib/api.ts`; `.status`, `.errors`).
- Produces:
  - `useImportSources()`, with query key `["import-sources"]`.
  - `postImport(body: ImportRequest): Promise<ImportResponse>`.
  - `IMPORT_WRITES: string[]`.
  - `useDryRun(rows, dispatch, paused): { retry(id: string): void }`.
  - `checkFailure(id, version, e): Action`, exported from `useDryRun.ts` for Task 7.
  - Page labels:
    - the file input `Files` (`multiple`);
    - the list `Files to import`;
    - the section `Where each source left off`.

- [ ] **Step 1: Point the Worker's route tests at `/import/sources`**

In `worker/src/__tests__/app/importRoute.test.ts`, replace the `mappings` helper in
`setup()` with:

```ts
  const mappings = async () => {
    const { sources } = (await (await send("GET", "/api/import/sources")).json()) as { sources: { name: string; mapping: ImportMapping | null }[] };
    return { mappings: Object.fromEntries(sources.filter((x) => x.mapping).map((x) => [x.name, x.mapping])) };
  };
```

Delete the `describe("GET /api/import/mappings", …)` block. Task 2's "is empty" test
covers it.

In `worker/src/routes/import.ts`, delete the `routes.get("/import/mappings", …)` handler
and the `ImportMappingsResponse` import. If `loadImportMappings` is no longer imported
there, remove it from that import too. In `worker/src/api/import.ts`, delete
`ImportMappingsResponse`. In `frontend/src/lib/types.ts`, remove it from the re-export.

Run: `cd worker && npx vitest run src/__tests__/app/importRoute.test.ts && npm run -s typecheck`

Expected: PASS.

- [ ] **Step 2: Write the new harness**

Replace `frontend/src/__tests__/import/harness.tsx` with:

```tsx
// Shared by the import page tests; Vitest only collects *.test.*.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";

import { ImportPage } from "../../import/ImportPage";
import type { ImportRequest, ImportSource } from "../../lib/types";

export type Call = { path: string; method: string; body: unknown };
type Reply = { status?: number; body: unknown };
type Answer = (body: unknown) => Reply | Promise<Reply>;

/** A dry run or an import of every row as new, unless a test answers otherwise. */
export const asNew = (body: unknown): Reply => {
  const b = body as ImportRequest;
  return { body: { batchId: b.dryRun ? null : 1, inserted: b.rows.length, duplicates: 0, suppressedDeleted: 0, newMerchants: [] } };
};

export function api(opts: { sources?: ImportSource[]; gemini?: boolean; routes?: Record<string, Answer> } = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const route = opts.routes?.[`${method} ${url.pathname}`];
    if (route) { const r = await route(body); return json(r.body, r.status); }
    const sources = opts.sources ?? [];
    if (url.pathname === "/api/lookups") {
      return json({ categories: [], tags: [], sources: sources.map((s) => s.name), essentialCategories: [], gemini: opts.gemini ?? false });
    }
    if (url.pathname === "/api/import/sources") return json({ sources });
    if (method === "POST" && url.pathname === "/api/import") { const r = asNew(body); return json(r.body, r.status); }
    return json({});
  };
  /** The POST /api/import calls, dry or real. */
  const imports = (dry: boolean) => calls.filter((c) => c.path === "/api/import" && !!(c.body as ImportRequest).dryRun === dry)
    .map((c) => c.body as ImportRequest);
  return { fetch, calls, imports };
}

export function renderImport(mock: ReturnType<typeof api>) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/import"]}>
        <Routes><Route path="*" element={<ImportPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

export const csvFile = (text: string, name = "sept.csv") => new File([text], name, { type: "text/csv" });

export async function addFiles(files: File[]) {
  await userEvent.upload(await screen.findByLabelText("Files"), files);
}
export const statusOf = (name: string) => screen.getByLabelText(`Status of ${name}`);

export function useHarness() {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
}
```

- [ ] **Step 3: Write the failing page tests**

Replace `frontend/src/__tests__/import/ImportPage.test.tsx` with:

```tsx
/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ImportMapping, ImportRequest, ImportSource } from "../../lib/types";
import { addFiles, api, asNew, csvFile, renderImport, statusOf, useHarness } from "./harness";

useHarness();

const CARD_CSV = "Started Date,Description,Amount\n2026-09-01 10:00:00,Corner Shop,-6.55\n2026-09-02 09:00:00,Acme Payroll,100.00\n";
const CARD: ImportMapping = { date: "Started Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const SOURCES: ImportSource[] = [
  { name: "Bank", lastDate: null, mapping: null },
  { name: "Card", lastDate: "2026-08-31", mapping: CARD },
];
const pickSource = (file: string, source: string) => userEvent.selectOptions(screen.getByLabelText(`Source for ${file}`), source);

describe("the import list", () => {
  it("shows where each source left off", async () => {
    renderImport(api({ sources: SOURCES }));
    const section = await screen.findByRole("region", { name: "Where each source left off" });
    expect(within(section).getByText("Card").closest("li")).toHaveTextContent("Card 31 Aug 2026");
    expect(within(section).getByText("Bank").closest("li")).toHaveTextContent("Bank no transactions");
  });

  it("lists several files, and checks one once its source's mapping fits", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv"), csvFile(CARD_CSV, "b.csv")]);
    expect(statusOf("a.csv")).toHaveTextContent("Left out");
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new · 0 already there"));
    expect(statusOf("b.csv")).toHaveTextContent("Left out");
    expect(mock.imports(true)).toEqual([expect.objectContaining({ source: "Card", filename: "a.csv", dryRun: true })]);
    expect(mock.imports(false)).toEqual([]);
  });

  it("names the columns a file lacks and opens it", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile("Date,Description,Amount\n01/09/2026,Corner Shop,-6.55\n", "a.csv"), csvFile(CARD_CSV, "b.csv")]);
    await pickSource("a.csv", "Card");
    expect(statusOf("a.csv")).toHaveTextContent("Needs mapping: no 'Started Date' column");
    expect(screen.getByRole("group", { name: "Mapping" })).toBeInTheDocument();
  });

  it("checks a source without a saved mapping once its columns are confirmed", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "Bank");
    expect(statusOf("a.csv")).toHaveTextContent("Needs mapping: choose its columns");
    await userEvent.click(screen.getByRole("button", { name: "Use these columns" }));
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new"));
  });

  it("marks the same file added twice", async () => {
    renderImport(api({ sources: SOURCES }));
    const f = csvFile(CARD_CSV, "a.csv");
    await addFiles([f]);
    await addFiles([f]);
    const statuses = screen.getAllByLabelText("Status of a.csv");
    expect(statuses[1]).toHaveTextContent("Same file as above");
  });

  it("ignores a check answer for an older mapping", async () => {
    // A holder, not a `let`: TypeScript narrows a let assigned only in a callback to never.
    const first: { resolve?: (r: { body: unknown }) => void } = {};
    const mock = renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => (first.resolve === undefined
          ? new Promise((resolve) => { first.resolve = resolve; })
          : asNew(body)),
      },
    }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(first.resolve).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(screen.getByLabelText("Type"), "expense");
    first.resolve?.({ body: { batchId: null, inserted: 99, duplicates: 0, suppressedDeleted: 0, newMerchants: [] } });
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new"));
    expect(statusOf("a.csv")).not.toHaveTextContent("99");
    expect(mock.imports(true)).toHaveLength(2);
  });

  it("refuses a file over the cap without checking it", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    const big = "Started Date,Description,Amount\n" + "2026-09-01 10:00:00,Corner Shop,-1.00\n".repeat(5001);
    await addFiles([csvFile(big, "big.csv")]);
    await pickSource("big.csv", "Card");
    expect(statusOf("big.csv")).toHaveTextContent("Too many rows (5001): split the file");
    await new Promise((r) => setTimeout(r, 500));
    expect(mock.imports(true)).toEqual([]);
  });

  it("reports a file it cannot read", async () => {
    renderImport(api({ sources: SOURCES }));
    const zone = (await screen.findByText("Drop statements here or choose files")).closest("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });
    await waitFor(() => expect(statusOf("notes.txt")).toHaveTextContent("Couldn't read: Choose a .csv, .xls or .xlsx file"));
  });

  it("gives a source named constructor no saved mapping", async () => {
    renderImport(api({ sources: [...SOURCES, { name: "constructor", lastDate: null, mapping: null }] }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "constructor");
    expect(statusOf("a.csv")).toHaveTextContent("Needs mapping: choose its columns");
  });

  it("removes a file", async () => {
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CARD_CSV, "a.csv"), csvFile(CARD_CSV, "b.csv")]);
    await userEvent.click(screen.getByRole("button", { name: "Remove a.csv" }));
    expect(screen.queryByLabelText("Status of a.csv")).not.toBeInTheDocument();
    expect(statusOf("b.csv")).toBeInTheDocument();
  });

  it("retries a check that failed", async () => {
    let fail = true;
    renderImport(api({
      sources: SOURCES,
      routes: { "POST /api/import": (body) => (fail ? { status: 500, body: { error: "down" } } : asNew(body)) },
    }));
    await addFiles([csvFile(CARD_CSV, "a.csv")]);
    await pickSource("a.csv", "Card");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Couldn't check"));
    fail = false;
    await userEvent.click(within(statusOf("a.csv")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready · 2 new"));
  });
});
```

The `ImportRequest` import is used by `asNew`'s typing in the harness. If the linter flags
it as unused here, drop it from this file.

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd frontend && npx vitest run src/__tests__/import/ImportPage.test.tsx`

Expected: FAIL. There is no "Files" input, and no "Where each source left off".

- [ ] **Step 5: Queries and the dry-run hook**

Replace `frontend/src/import/queries.ts` with:

```ts
import { useQuery } from "@tanstack/react-query";
import { getJson, send } from "../lib/api";
import type { ImportRequest, ImportResponse, ImportSourcesResponse } from "../lib/types";

export function useImportSources() {
  return useQuery({ queryKey: ["import-sources"], queryFn: () => getJson<ImportSourcesResponse>("/api/import/sources") });
}

export const postImport = (body: ImportRequest) => send<ImportResponse>("POST", "/api/import", body);

/** New rows touch every list and total, the sources' last dates, and the saved mappings. */
export const IMPORT_WRITES = ["transactions", "summary", "periods", "lookups", "merchants", "import-sources"];
```

Create `frontend/src/import/useDryRun.ts`:

```ts
import { useEffect, useRef, type Dispatch } from "react";

import { ApiError } from "../lib/api";
import { createCheckQueue, type CheckQueue } from "./checkQueue";
import { requestFor, rowStatus, type Action, type FileRow } from "./importList";
import { postImport } from "./queries";

/** The failure action for a check: a 400 is the Worker refusing rows, anything else is retryable. */
export function checkFailure(id: string, version: number, e: unknown): Action {
  return {
    type: "checkFailed", id, version,
    message: e instanceof Error ? e.message : String(e),
    errors: e instanceof ApiError ? e.errors : undefined,
    refused: e instanceof ApiError && e.status === 400,
  };
}

/**
 * Checks every row waiting for one, by a dry run of its import. Paused while
 * the list imports, which does its own checks in order.
 */
export function useDryRun(rows: FileRow[], dispatch: Dispatch<Action>, paused: boolean) {
  const latest = useRef(rows);
  latest.current = rows;
  // id -> the version already handed to the queue, so a render never schedules twice.
  const scheduled = useRef(new Map<string, number>());
  const queue = useRef<CheckQueue | null>(null);
  queue.current ??= createCheckQueue({
    run: async (id, version) => {
      const row = latest.current.find((r) => r.id === id);
      if (!row || row.version !== version) return;
      dispatch({ type: "checkStart", id, version });
      try {
        const r = await postImport(requestFor(row, true));
        dispatch({ type: "checked", id, version, counts: r });
      } catch (e) {
        dispatch(checkFailure(id, version, e));
      }
    },
  });

  useEffect(() => {
    if (paused) return;
    for (const row of rows) {
      if (rowStatus(row).kind !== "checking" || row.check.state !== "idle") continue;
      if (scheduled.current.get(row.id) === row.version) continue;
      scheduled.current.set(row.id, row.version);
      queue.current?.schedule(row.id, row.version);
    }
  }, [rows, paused]);

  useEffect(() => () => queue.current?.cancelAll(), []);

  return { retry: (id: string) => dispatch({ type: "recheck", ids: [id] }) };
}
```

- [ ] **Step 6: The page**

Replace `frontend/src/import/ImportPage.tsx` with:

```tsx
import { useMemo, useReducer, useRef, useState } from "react";

import { useLookups } from "../transactions/queries";
import { FileRowView } from "./FileRow";
import { readGrid } from "./grid";
import { importList, type SavedMappings } from "./importList";
import { useImportSources } from "./queries";
import { useDryRun } from "./useDryRun";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A month's statements at once: each file gets a source picked by hand and
 * is checked by a dry run; nothing is saved until Import.
 */
export function ImportPage() {
  const lookups = useLookups();
  const sources = useImportSources();
  const [rows, dispatch] = useReducer(importList, []);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  const running = false; // Task 7: true while the list imports
  const dry = useDryRun(rows, dispatch, running);

  const saved = useMemo<SavedMappings>(() => Object.fromEntries(
    (sources.data?.sources ?? []).filter((s) => s.mapping).map((s) => [s.name, s.mapping]),
  ) as SavedMappings, [sources.data]);
  // A read lands later than the render that started it: it uses the mappings known by then.
  const savedNow = useRef(saved);
  savedNow.current = saved;

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])].map((file) => ({ id: `f${++nextId.current}`, file }));
    if (files.length === 0) return;
    dispatch({ type: "add", files });
    for (const { id, file } of files) {
      readGrid(file).then(
        (grid) => dispatch({ type: "read", id, grid, saved: savedNow.current }),
        (e) => dispatch({ type: "readFailed", id, message: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const loadError = lookups.error ?? sources.error;
  if (loadError) {
    return (
      <main className="mx-auto max-w-6xl p-4 text-sm">
        <p className="mb-2">{loadError.message}</p>
        <button type="button" onClick={() => { lookups.refetch(); sources.refetch(); }} className="rounded-md border px-3 py-1">Retry</button>
      </main>
    );
  }
  if (!lookups.data || !sources.data) {
    return <main className="mx-auto max-w-6xl p-4" aria-busy="true"><div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" /></main>;
  }
  const names = sources.data.sources.map((s) => s.name);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Import</h1>
      <p className="-mt-2 text-sm text-slate-600 dark:text-slate-400">
        Pick each statement's account. Nothing is saved until you press Import.
      </p>
      {sources.data.sources.length > 0 && (
        <section aria-label="Where each source left off" className="text-sm">
          <h2 className="mb-1 font-medium">Where each source left off</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
            {sources.data.sources.map((s) => (
              <li key={s.name}><span className="text-slate-900 dark:text-slate-100">{s.name}</span> {s.lastDate ? day(s.lastDate) : "no transactions"}</li>
            ))}
          </ul>
        </section>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Files</span>
        <span data-dropzone
          onDragOver={(e) => { e.preventDefault(); if (!running) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (!running) addFiles(e.dataTransfer.files); }}
          className={`flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-3 py-2 ${
            dragging ? "border-slate-500 bg-slate-100 dark:border-slate-400 dark:bg-slate-800" : "border-slate-300 dark:border-slate-700"}`}>
          <input aria-label="Files" type="file" multiple accept=".csv,.xls,.xlsx" disabled={running}
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              // Cleared so choosing the same files again still fires.
              e.target.value = "";
              addFiles(picked);
            }}
            className="w-56 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1 file:text-sm hover:file:bg-slate-50 dark:file:border-slate-700 dark:file:bg-slate-900 dark:hover:file:bg-slate-800" />
          <span>Drop statements here or choose files</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">.csv, .xls or .xlsx</span>
        </span>
      </label>
      {rows.length > 0 && (
        <ul aria-label="Files to import" className="flex flex-col">
          {rows.map((row) => (
            <FileRowView key={row.id} row={row} sources={names} saved={saved} locked={running}
              dispatch={dispatch} onRetryCheck={dry.retry} onRetryImport={() => {}} />
          ))}
        </ul>
      )}
    </main>
  );
}
```

In `frontend/src/App.tsx`, remove the `ImportAction` import and make the route:

```tsx
          <Route path="/import" element={<ImportPage />} />
```

Delete `frontend/src/import/ImportAction.tsx` and
`frontend/src/__tests__/import/importAction.test.tsx`.

- [ ] **Step 7: Run the tests, the typecheck and the build**

Run: `cd frontend && npx vitest run src/__tests__/import && npx tsc -b --noEmit && npm run -s build`

Expected: PASS, and the build succeeds with `xlsx` still in its own chunk. If a test
about the old single-file page remains in another file and fails, check whether its
behaviour moved to a row or panel test. Remove it only if so, and say which in the report.

- [ ] **Step 8: Commit**

```bash
jj describe -m "Turn the import page into a list of checked files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 7: Import all, the result, and one Gemini call

**Files:**
- Create: `frontend/src/import/useImportAll.ts`
- Create: `frontend/src/import/ImportResult.tsx`
- Modify: `frontend/src/import/ImportPage.tsx` (the footer, the result, the lock, and the leave warning)
- Test: `frontend/src/__tests__/import/importAll.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 6: `postImport`, `IMPORT_WRITES` and `checkFailure`.
  - From Task 3: `requestFor`, `isReady`, `rowStatus` and `Action`.
  - Existing: `useSuggestCategories()` (`frontend/src/merchants/mutations.ts`), `suggestMessage(r)` (`frontend/src/merchants/suggest.ts`), `toTransactionsSearch` (`frontend/src/lib/types.ts`) and `useQueryClient`.
- Produces:
  - `useImportAll(rows, dispatch, askGemini: boolean)`, returning:
    - `start(ids: string[]): Promise<void>`
    - `running: boolean`
    - `lastRun: string[] | null`
    - `gemini: { message: string; ok: boolean } | null`
    - `asking: boolean`
    - `askAgain(): void`
    - `clear(): void`
  - `ImportResult(props)`.
  - Labels:
    - the button `Import <n> file(s) · <m> transaction(s)`;
    - the section `Import result`;
    - the links `View in Transactions` and `Review suggestions`;
    - the button `Start over`;
    - the checkbox `Suggest categories for new merchants`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/import/importAll.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ImportMapping, ImportRequest, ImportSource } from "../../lib/types";
import { addFiles, api, asNew, csvFile, renderImport, statusOf, useHarness } from "./harness";

useHarness();

const CSV = "Started Date,Description,Amount\n2026-09-01 10:00:00,Corner Shop,-6.55\n2026-09-02 09:00:00,Acme Payroll,100.00\n";
const MAP: ImportMapping = { date: "Started Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const SOURCES: ImportSource[] = ["Alpha", "Beta", "Gamma"].map((name) => ({ name, lastDate: "2026-08-31", mapping: MAP }));

async function ready(files: [string, string][]) {
  await addFiles(files.map(([name]) => csvFile(CSV, name)));
  for (const [name, source] of files) {
    await userEvent.selectOptions(screen.getByLabelText(`Source for ${name}`), source);
  }
  for (const [name] of files) await waitFor(() => expect(statusOf(name)).toHaveTextContent("Ready"));
}
const importButton = () => screen.getByRole("button", { name: /^Import \d+ files? · / });

describe("importing the list", () => {
  it("imports every ready file in order, then shows one result", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"]]);
    expect(importButton()).toHaveTextContent("Import 2 files · 4 transactions");
    await userEvent.click(importButton());
    const result = await screen.findByRole("region", { name: "Import result" });
    expect(mock.imports(false).map((b) => b.source)).toEqual(["Alpha", "Beta"]);
    expect(within(result).getByText("Total").closest("tr")).toHaveTextContent("Total4");
    const link = within(result).getByRole("link", { name: "View in Transactions" });
    expect(link.getAttribute("href")).toContain("from=2026-09-01");
    expect(link.getAttribute("href")).toContain("to=2026-09-02");
  });

  it("keeps going after a failed file, and Retry imports just that file", async () => {
    let failBeta = true;
    const mock = renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => {
          const b = body as ImportRequest;
          if (!b.dryRun && b.source === "Beta" && failBeta) {
            return { status: 400, body: { error: "The file has rows the import refuses", errors: ["Found 1 bad date"] } };
          }
          return asNew(body);
        },
      },
    }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"], ["c.csv", "Gamma"]]);
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    expect(statusOf("a.csv")).toHaveTextContent("Imported 2");
    expect(statusOf("b.csv")).toHaveTextContent("Failed: The file has rows the import refuses");
    expect(within(statusOf("b.csv")).getByText("Found 1 bad date")).toBeInTheDocument();
    expect(statusOf("c.csv")).toHaveTextContent("Imported 2");
    failBeta = false;
    await userEvent.click(within(statusOf("b.csv")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(statusOf("b.csv")).toHaveTextContent("Imported 2"));
    expect(mock.imports(false).map((b) => b.source)).toEqual(["Alpha", "Beta", "Gamma", "Beta"]);
  });

  it("re-checks a second file of the same source before importing it", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Alpha"]]);
    const before = mock.calls.length;
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    const sequence = mock.calls.slice(before).filter((c) => c.path === "/api/import")
      .map((c) => `${(c.body as ImportRequest).dryRun ? "check" : "import"} ${(c.body as ImportRequest).filename}`);
    expect(sequence).toEqual(["import a.csv", "check b.csv", "import b.csv"]);
  });

  it("asks Gemini once for all the new merchants", async () => {
    const mock = renderImport(api({
      sources: SOURCES, gemini: true,
      routes: {
        "POST /api/import": (body) => ({ body: { ...asNew(body).body as object, newMerchants: ["Corner Shop"] } }),
        "POST /api/merchants/suggest": () => ({ body: { asked: 1, suggested: 1, newCategories: [], unanswered: 0 } }),
      },
    }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"]]);
    expect(screen.getByLabelText("Suggest categories for new merchants")).toBeChecked();
    await userEvent.click(importButton());
    const result = await screen.findByRole("region", { name: "Import result" });
    await within(result).findByRole("link", { name: "Review suggestions" });
    expect(mock.calls.filter((c) => c.path === "/api/merchants/suggest")).toHaveLength(1);
  });

  it("does not ask Gemini when no file has new merchants, or the box is unticked", async () => {
    const mock = renderImport(api({ sources: SOURCES, gemini: true }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    expect(mock.calls.filter((c) => c.path === "/api/merchants/suggest")).toHaveLength(0);
  });

  it("locks the list while importing, and warns before leaving", async () => {
    const pending: { finish?: () => void } = {};
    renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => ((body as ImportRequest).dryRun
          ? asNew(body)
          : new Promise((resolve) => { pending.finish = () => resolve(asNew(body)); })),
      },
    }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(importButton());
    await waitFor(() => expect(pending.finish).toBeDefined());
    expect(screen.getByLabelText("Source for a.csv")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove a.csv" })).toBeDisabled();
    expect(screen.getByLabelText("Files")).toBeDisabled();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    pending.finish?.();
    await screen.findByRole("region", { name: "Import result" });
    expect(screen.getByLabelText("Files")).toBeEnabled();
  });

  it("starts over", async () => {
    renderImport(api({ sources: SOURCES }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(importButton());
    await userEvent.click(await screen.findByRole("button", { name: "Start over" }));
    expect(screen.queryByLabelText("Status of a.csv")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Import result" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd frontend && npx vitest run src/__tests__/import/importAll.test.tsx`

Expected: FAIL. There is no Import button.

- [ ] **Step 3: The run hook**

Create `frontend/src/import/useImportAll.ts`:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type Dispatch } from "react";

import { ApiError } from "../lib/api";
import { useSuggestCategories } from "../merchants/mutations";
import { suggestMessage } from "../merchants/suggest";
import { requestFor, type Action, type FileRow } from "./importList";
import { IMPORT_WRITES, postImport } from "./queries";
import { checkFailure } from "./useDryRun";

/**
 * Imports the given rows one after another. A row whose source an earlier
 * file of this run already imported into is checked again first, so its
 * counts are true; a failed file never stops the rest. Then one Gemini call
 * for every new merchant, when asked.
 */
export function useImportAll(rows: FileRow[], dispatch: Dispatch<Action>, askGemini: boolean) {
  const client = useQueryClient();
  const suggest = useSuggestCategories();
  const latest = useRef(rows);
  latest.current = rows;
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string[] | null>(null);
  const [gemini, setGemini] = useState<{ message: string; ok: boolean } | null>(null);

  const ask = () => suggest.mutate(undefined, {
    onSuccess: (r) => setGemini({ message: suggestMessage(r), ok: r.suggested > 0 }),
    onError: (e) => setGemini({ message: e.message, ok: false }),
  });

  // Leaving mid-run would drop the files not yet sent.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const start = async (ids: string[]) => {
    setRunning(true);
    setGemini(null);
    setLastRun((prev) => [...new Set([...(prev ?? []), ...ids])]);
    const into = new Set<string>();
    const fresh = new Set<string>();
    try {
      for (const id of ids) {
        const row = latest.current.find((r) => r.id === id);
        if (!row) continue;
        if (into.has(row.source)) {
          const version = row.version + 1;
          dispatch({ type: "recheck", ids: [id] });
          dispatch({ type: "checkStart", id, version });
          try {
            dispatch({ type: "checked", id, version, counts: await postImport(requestFor(row, true)) });
          } catch (e) {
            dispatch(checkFailure(id, version, e));
            continue;
          }
        }
        dispatch({ type: "importStart", id });
        try {
          const result = await postImport(requestFor(row, false));
          dispatch({ type: "imported", id, result });
          into.add(row.source);
          for (const m of result.newMerchants) fresh.add(m);
        } catch (e) {
          dispatch({
            type: "importFailed", id, message: e instanceof Error ? e.message : String(e),
            errors: e instanceof ApiError ? e.errors : undefined,
          });
        }
      }
    } finally {
      await Promise.all(IMPORT_WRITES.map((key) => client.invalidateQueries({ queryKey: [key] })));
      // Rows outside the run that share a source now count against the new rows.
      dispatch({ type: "recheck", ids: latest.current.filter((r) => into.has(r.source)).map((r) => r.id) });
      setRunning(false);
      if (askGemini && fresh.size > 0) ask();
    }
  };

  return {
    start, running, lastRun, gemini, asking: suggest.isPending,
    askAgain: () => { setGemini(null); ask(); },
    clear: () => { setLastRun(null); setGemini(null); },
  };
}
```

The reducer's `recheck` only touches rows not yet imported, so passing every
same-source id is safe.

- [ ] **Step 4: The result**

Create `frontend/src/import/ImportResult.tsx`:

```tsx
import { Link } from "react-router";

import { toTransactionsSearch } from "../lib/types";
import type { FileRow } from "./importList";

/** One line per file of the run, a total, Gemini's answer, and where to go next. */
export function ImportResult(props: {
  rows: FileRow[]; gemini: { message: string; ok: boolean } | null; asking: boolean;
  onAskAgain: () => void; onStartOver: () => void;
}) {
  const done = props.rows.filter((r) => r.run.state === "done");
  const total = (pick: (r: { inserted: number; duplicates: number; suppressedDeleted: number }) => number) =>
    done.reduce((n, r) => n + (r.run.state === "done" ? pick(r.run.result) : 0), 0);
  const dates = done.flatMap((r) => r.parsed?.rows.map((x) => x.date) ?? []).sort();
  const view = dates.length > 0
    ? `/transactions?${toTransactionsSearch({ from: dates[0], to: dates[dates.length - 1], sources: [...new Set(done.map((r) => r.source))] })}`
    : null;
  const cell = "px-2 py-1 text-right tabular-nums";
  return (
    <section aria-label="Import result" className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-slate-500"><tr>
            <th className="px-2 py-1 text-left font-medium">File</th><th className="px-2 py-1 text-left font-medium">Source</th>
            <th className={cell}>Imported</th><th className={cell}>Already there</th><th className={cell}>Deleted</th>
          </tr></thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-1">{r.file.name}</td><td className="px-2 py-1">{r.source}</td>
                {r.run.state === "done" ? (
                  <><td className={cell}>{r.run.result.inserted}</td><td className={cell}>{r.run.result.duplicates}</td><td className={cell}>{r.run.result.suppressedDeleted}</td></>
                ) : <td colSpan={3} className="px-2 py-1 text-right text-expense">Not imported</td>}
              </tr>
            ))}
            <tr className="font-medium">
              <td className="px-2 py-1">Total</td><td />
              <td className={cell}>{total((x) => x.inserted)}</td><td className={cell}>{total((x) => x.duplicates)}</td><td className={cell}>{total((x) => x.suppressedDeleted)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {props.asking && <p>Asking Gemini…</p>}
      {props.gemini && (
        <p className={props.gemini.ok ? "" : "text-expense"}>
          {props.gemini.message}
          {!props.gemini.ok && <button type="button" onClick={props.onAskAgain} className="ml-2 underline">Retry</button>}
        </p>
      )}
      <p className="flex flex-wrap gap-4">
        {view && <Link to={view} className="underline">View in Transactions</Link>}
        {props.gemini?.ok && <Link to="/merchants?attention=suggested" className="underline">Review suggestions</Link>}
        <button type="button" onClick={props.onStartOver} className="underline">Start over</button>
      </p>
    </section>
  );
}
```

The test asserts the total row's text as `"Total4"`: the cells' text content
concatenated, with the blank source cell between. If the markup changes, assert the
`Imported` total cell instead. Never drop the assertion.

- [ ] **Step 5: Wire the page**

In `frontend/src/import/ImportPage.tsx`:

1. Add imports: `useEffect` is not needed. Add `ImportResult` from `./ImportResult`, `useImportAll` from `./useImportAll`, and `isReady` and `rowStatus` from `./importList`.
2. Replace `const running = false; // Task 7 …` and the `useDryRun` line with:

```tsx
  const [askGemini, setAskGemini] = useState(true);
  const geminiOn = lookups.data?.gemini === true;
  const run = useImportAll(rows, dispatch, geminiOn && askGemini);
  const running = run.running;
  const dry = useDryRun(rows, dispatch, running);
```

3. Pass `onRetryImport={(id) => run.start([id])}` to `FileRowView`, in place of `() => {}`.
4. After the `</ul>` of the list (still inside `rows.length > 0 &&`, wrapped in a fragment), add the footer:

```tsx
          {(() => {
            const ready = rows.filter(isReady);
            const kinds = rows.map((r) => rowStatus(r).kind);
            const checking = kinds.includes("checking");
            const leftOut = kinds.filter((k) => k === "leftOut" || k === "sameFile").length;
            const attention = kinds.filter((k) => ["readFailed", "needsMapping", "nothing", "tooMany", "checkFailed", "refused", "importFailed"].includes(k)).length;
            const total = ready.reduce((n, r) => n + (r.check.state === "done" ? r.check.counts.inserted : 0), 0);
            const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
            return (
              <div className="flex flex-col gap-2">
                {geminiOn && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={askGemini} disabled={running} onChange={(e) => setAskGemini(e.target.checked)}
                      aria-label="Suggest categories for new merchants" />
                    Suggest categories for new merchants
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <button type="button" onClick={() => run.start(ready.map((r) => r.id))}
                    disabled={ready.length === 0 || checking || running}
                    className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                    {running ? "Importing…" : `Import ${plural(ready.length, "file")} · ${plural(total, "transaction")}`}
                  </button>
                  {leftOut > 0 && <span className="text-slate-600 dark:text-slate-400">{leftOut} left out</span>}
                  {attention > 0 && <span className="text-expense">{attention} need attention</span>}
                </div>
              </div>
            );
          })()}
```

5. After that, still in `main`, render the result when a run has finished:

```tsx
      {run.lastRun && !running && (
        <ImportResult rows={rows.filter((r) => run.lastRun?.includes(r.id))} gemini={run.gemini} asking={run.asking}
          onAskAgain={run.askAgain} onStartOver={() => { run.clear(); dispatch({ type: "reset" }); }} />
      )}
```

The "Import N files" button label must match `/^Import \d+ files? · /`. While running it
reads "Importing…", which the tests don't query.

- [ ] **Step 6: Run the tests, the typecheck and the build**

Run: `cd frontend && npx vitest run src/__tests__/import && npx tsc -b --noEmit && npm run -s build`

Expected: PASS. Then run the full frontend suite: `cd frontend && npx vitest run`.

- [ ] **Step 7: Commit**

```bash
jj describe -m "Import every ready file in order, with one result and one Gemini call

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

---

### Task 8: Docs, checks and a real run

**Files:**
- Modify: `docs/WEB_PORT_PLAN.md` (the Import section)

- [ ] **Step 1: The port plan**

In `docs/WEB_PORT_PLAN.md`, add this bullet after the Import section's "Done: `/import`
reads…" bullet:

```markdown
- Done: several files at once. Each gets a source picked by hand and a dry run
  (`dryRun` on `POST /api/import`, the import's own counting) showing what is new;
  "Import all" sends one request per file in order, re-checking same-source files
  first, then asks Gemini once. `GET /api/import/sources` (replacing
  `/import/mappings`) gives each source's saved mapping and last live date.
```

- [ ] **Step 2: Full verification**

```bash
(cd worker && npx vitest run && npm run -s typecheck)
(cd frontend && npx vitest run && npx tsc -b --noEmit && npm run -s build)
PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py --check
```

Expected: everything passes, the build succeeds, and the vectors are current.

- [ ] **Step 3: Privacy scan**

```bash
jj diff -r 'main..@' | grep '^+' | grep -n -i -E "/Users/|@gmail|Downloads/CSVs|IE[0-9]{2}[A-Z]{4}"
```

Expected: no output.

- [ ] **Step 4: Real run (controller only, with the owner's OK)**

1. Copy `worker/.wrangler/state` to `$CLAUDE_JOB_DIR/tmp/d1`. From `worker/`, run `npx wrangler dev --port 8790 --persist-to $CLAUDE_JOB_DIR/tmp/d1 --local-upstream localhost:8790`.
2. With `uv run --with playwright` and Chrome, drop all of `~/Downloads/CSVs/` at once.
   - Pick each file's source by hand, and leave the savings file out.
   - Report only counts: each file's dry-run counts, then its imported counts. They must match.
   - The total inserted must equal the first run's 219.
3. Drop the same files again. Every row checks as 0 new.
4. Gemini only with the owner's OK. Otherwise untick the box.
5. Stop wrangler and delete the copy.

- [ ] **Step 5: Commit**

```bash
jj describe -m "Record the multi-file import in the port plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
jj new
```

After the final whole-branch review passes, delete this plan and the spec in their own
change, "Remove the finished multi-file import spec and plan".
