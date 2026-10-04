# Multi-file import: design

This turns the web import page (PR #41) into a list, so that a month's statements go in
together in one pass instead of one file at a time. One PR.

## Decisions (owner, 2026-10-04)

- **Sources are chosen by hand, per file.** Nothing is guessed from file names or
  account numbers. A file left without a source is not imported.
- **"Where each source left off" is shown:** each source's latest transaction date.
- **The dry run reuses the import's own code** (`dryRun` on `POST /api/import`), so the
  counts shown before importing match what the import then does.
- **Import all sends one request per file, in order.** Each file is all-or-nothing. A
  failed file doesn't stop the others and can be retried on its own.
- **Gemini is called once at the end**, for every new merchant.

A **saved mapping** is the column mapping remembered per source name
(`settings.import_mappings`, from PR #41). File names are never stored or compared.

## The page (`/import`)

```
Import
Pick each statement's account. Nothing is saved until you press Import.

Where each source left off
  Source A 31 Aug · Source B 30 Aug · Source C 31 Aug · …

┌ Drop statements here or choose files ──────── .csv, .xls or .xlsx ┐

  File                       Source             Status
▸ statement-a.csv         [Source A ▾]       Ready · 60 new · 1 already there
▸ statement-b.xls         [Source B ▾]       Ready · 33 new · 26 already there · 4 deleted · 1 skipped
▾ statement-c.csv         [Source C ▾]       Needs mapping: no 'Started Date' column
    (the file's panel: mapping form · Show the file as read · parsed preview)
▸ statement-d.xls         [Choose a source ▾] Left out                               ✕
[✓] Suggest categories for new merchants
[ Import 3 files · 93 transactions ]      1 left out
```

- **One page for one file or many.** The drop zone and the file input accept several
  files. Each file becomes a row. A single file is a list of one, opened.
- **Where each source left off.** Every source is listed with the date of its latest live
  transaction ("no transactions" when none), above the list. The list wraps on a phone.
- **Source.** Each row has a select that starts on "Choose a source…", listing the
  existing sources plus "New source…", which takes a name as today. Two rows may use the
  same source.
- **Status.** Each row is in one of these states:
  - **Left out:** no source chosen. The row is not imported.
  - **Couldn't read:** the file couldn't be read. Shows the read error.
  - **Same file as above:** a file already in the list, matched by name, size and
    modified time. The row is left out until you choose a source for it anyway.
  - **Needs mapping:** the source has no saved mapping, or this file lacks some of the
    mapped columns. Each missing column is named, and the row opens itself.
  - **Nothing to import:** the mapping fits, but no row parses.
  - **Checking…** while the dry run runs.
  - **Ready** once the dry run returns. Its counts read: *n* new · *n* already there ·
    *n* deleted (shown only when non-zero) · *n* skipped (from the parse). The
    comma-decimal warning shows here when it applies.
  - **Couldn't check:** a network error or a 5xx on the dry run. Has a Retry.
  - **Refused:** a 400 on the dry run. Lists the Worker's `errors`.
  - **Too many rows:** over 5,000 parsed rows. Reads "split the file".
  - **Importing…**, then **Imported** (with the real counts), or **Failed** (with the
    errors and a Retry that imports just this file).
- **The row's panel** (▸ or ▾) is today's single-file panel, moved out of `ImportPage`:
  - the mapping form;
  - Show the file as read;
  - the parsed preview with Show all.

  Editing the mapping re-runs that row's dry run. The mapping is saved only when the row
  imports.
- **✕** removes a row.
- **The Import button** reads "Import *F* files · *T* transactions": the Ready rows, and
  the sum of their new rows. Beside it: "*n* left out" and "*n* need attention". It is
  disabled when no row is Ready, or while any row is Checking.
- **Import all:**
  - Sends each Ready row in list order, one request at a time.
  - After each file imports, the remaining rows with the same source re-check, so overlap
    between two of your files is counted right.
  - A row that stops being Ready on that re-check is skipped and keeps its new status.
  - When the last file is done:
    - **Gemini:** if the box was ticked and any file reported new merchants, one call to
      `POST /api/merchants/suggest`.
    - **The result:** one table, a line per file with its imported, already there and
      deleted counts, and a totals line.
    - **Links:** View in Transactions (the imported sources, from the earliest imported
      date to the latest) and, after suggestions, Review suggestions.
    - **Start over** clears the list.
- **Locked while importing:** the source selects, the mapping edits, ✕, the drop zone and
  the file input. The browser warns before leaving the page (`beforeunload`).
- Works at phone width: a row's file name, source and status stack, and the panel's
  tables scroll sideways inside their boxes, as today.

## Worker

### `importTransactions(db, rows, { …, dryRun })`

In `worker/src/services/transactions.ts`, everything before the `import_batches` insert
only reads: validation, alias resolution, the duplicate walk, and the new-merchant
lookup. With `dryRun: true`, the function returns there:
`{ batchId: null, inserted, duplicates, suppressedDeleted, newMerchants }`. Nothing is
written. `ImportResult.batchId` becomes `number | null`.

### `POST /api/import`

- The body gains `dryRun?: boolean`. The zod schema stays strict.
- A dry run gets the same validation, 5,000 cap, Origin check, and 400 with `errors`. It
  never saves the mapping.
- The response is `ImportResponse`, with `batchId: number | null`.

### `GET /api/import/sources`

This replaces `GET /api/import/mappings` (and `ImportMappingsResponse`), which only the
import page uses.

```ts
interface ImportSource { name: string; lastDate: string | null; mapping: ImportMapping | null }
interface ImportSourcesResponse { sources: ImportSource[] }
```

- Lists every source with transactions, plus every source that only has a saved mapping.
- `lastDate` is the `max(date)` of live rows (`deleted_at IS NULL`) for that source, from
  one `GROUP BY source` query, as ISO `YYYY-MM-DD`. It is null when the source has no
  live rows.
- Sorted by name. Mapping keys are read with `Object.hasOwn`, so a source named
  `constructor` is safe.
- Behind the same auth as the other routes.

No migration. The Python vectors are unchanged, since parsing doesn't change.

## Frontend structure (`frontend/src/import/`)

- `importList.ts`: a pure reducer. It holds the rows (`id`, `file`, `grid`, `source`,
  `mapping`, `status`, `counts`, `errors`) and every state change: added, read,
  read failed, source chosen, mapping changed, check started, checked, check failed,
  import started, imported, import failed, removed, reset. Unit-tested without React.
- `FileRow.tsx`: one row (name, source select, status, ✕, expand).
- `FilePanel.tsx`: the panel taken from today's `ImportPage` (`MappingForm`, `RawGrid`,
  `Preview`).
- `useDryRun.ts`: checks a row. It debounces by 400 ms, keeps only the latest answer per
  row (a request id, like today's read id), and runs at most 3 checks at once.
- `useImportAll.ts`: imports in order, re-checks same-source rows, then makes the single
  suggest call. It also does the invalidations the single import does today.
- `ImportPage.tsx`: the drop zone, "where each source left off", the list, the footer and
  the result.
- `queries.ts`: `useImportSources()` replaces `useImportMappings()`.
- `ImportAction.tsx`: its result and suggest parts move into the list's result. Anything
  left unused is removed.

## Testing

- **Worker:**
  - A dry run and then a real import of the same rows return the same counts.
  - A dry run leaves the counts of `transactions`, `merchants` and `import_batches`
    unchanged.
  - A dry run with refused rows returns 400 with `errors`.
  - A dry run doesn't save the mapping.
  - `dryRun` must be a boolean (strict schema).
  - Sources:
    - `lastDate` ignores deleted rows;
    - a source that only has a mapping is listed with a null date;
    - the list is sorted;
    - `constructor` as a source name works.
- **Reducer:** every transition, including Same file, and a Ready row that stops being
  Ready after a re-check.
- **Page (mocked API):**
  - several files dropped;
  - Ready counts;
  - Needs mapping, with the missing columns named;
  - Left out;
  - the same file twice;
  - Too many rows;
  - Import all with file 2 of 3 failing, then Retry imports just that file;
  - same-source rows re-checked after an import;
  - exactly one suggest call, and none when no file has new merchants;
  - controls locked while importing;
  - the last dates shown;
  - stale dry-run answers ignored.
- **Before the PR (with the owner's OK):** a throwaway copy of the local D1.
  - Drop all of September at once, leaving the savings file out.
  - Each file's dry-run counts should equal its imported counts.
  - The total inserted should match the first real run's 219.
  - A second drop of the same files should check as 0 new everywhere.
  - Gemini only with the owner's OK.

## Out of scope

- Guessing sources from file names or account numbers.
- **Pairing transfers between the household's own accounts**, so they aren't counted.
  The owner wants this as its own design later.
- Editing or deleting saved mappings outside an import.
- Importing files in parallel.
