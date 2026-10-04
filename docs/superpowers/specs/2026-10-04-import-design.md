# Web import — design

Ports the TUI's Import screen (`expenses/screens/import_screen.py`) to the web
and extends it to the files the household actually gets: bank CSVs and the
bank's binary `.xls` exports. One PR.

## Decisions (owner, 2026-10-04)

- **Mappings are remembered per source**, by column name, so a repeat import
  is: pick the file, check the parsed preview, import. A file whose columns
  no longer fit falls back to the mapping form.
- **Parse in the browser**, send clean rows. The raw file never leaves the
  browser; the Worker reuses `importTransactions` unchanged.
- **`.xls` and `.xlsx` are read directly** with SheetJS, besides `.csv`.
- **An optional row filter** per source ("only rows where State is
  COMPLETED"), counted as its own skip reason. PayPal's built-in rule stays.

What the owner's September files look like (layouts only, nothing from them
is committed):

- Card-app CSV: `Type, Product, Started Date, Completed Date, Description,
  Amount, Fee, Currency, State, Balance`; dates `2026-09-01 12:34:19`;
  signed amounts; `State` all COMPLETED.
- Bank `.xls` (BIFF8, JasperReports): 12–17 summary/filter rows above the
  table; header `Date | | Description | Money In (€) | Money Out (€) | |
  Balance (€)` (credit card: `| Transaction Date | | Posting Date |
  Description | | Money In (€) | Money Out (€)`); blank spacer columns in
  different places per account type; dates as text; amounts as number cells,
  money out negative.

## Parsing (`frontend/src/import/`, pure, no React)

### Reading the file → a grid

`readGrid(file): Promise<string[][]>` turns a file into rows of text cells.

- `.csv`: Papa Parse (`papaparse`), no header handling, delimiter detected
  (`,` or `;`), BOM stripped, quoted fields and embedded newlines honoured.
- `.xls`, `.xlsx`: SheetJS, imported with a dynamic `import()` so only the
  import page loads it. First sheet. Number cells → their number as text
  (`-71.35`); date cells → ISO `YYYY-MM-DD`; text cells → the text; empty →
  `""`.
- SheetJS comes from its own CDN tarball
  (`https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`, pinned in
  `frontend/package.json`), not the npm registry copy, which is stale and has
  open advisories. Frontend only; the Worker gets no new dependency.
- Anything else is refused: "Choose a .csv, .xls or .xlsx file".

### Header and columns

- **Header row:**
  - with a saved mapping, the first row (from the top) containing every
    mapped column name;
  - otherwise the first row with at least 3 non-empty cells;
  - the mapping can pin it: `headerRow` (0-based), shown 1-based in the UI.
- Columns whose header is blank are dropped. A repeated name gets " (2)",
  " (3)" appended in order. Names are trimmed.
- Rows below the header with every cell blank are ignored and not counted.

### Mapping

```ts
interface ImportMapping {
  date: string;          // column names
  merchant: string;
  amount: string;
  amountOut?: string;    // two-column mode: amount = money in, amountOut = money out
  typeMode: "auto" | "expense" | "income";
  dateOrder: "dmy" | "mdy";         // for D/M/Y-shaped dates; default "dmy"
  headerRow?: number;               // pinned header row, 0-based
  filter?: { column: string; value: string };
}
```

A saved mapping **fits** a file when every named column (date, merchant,
amount, amountOut, filter.column) exists in its header.

### Rows (`processRows(grid, mapping)`)

Per data row, in `_process_row`'s order:

1. **Date** (`parseDate(raw, dateOrder)`), first match wins:
   - ISO: `YYYY-MM-DD` or `YYYY/MM/DD`, optionally followed by a time
     (`" 12:34:19"`, `"T12:00:00Z"`): the date part is kept.
   - Numeric day/month/year with `/`, `-` or `.`: `D/M/YYYY`, `DD-MM-YYYY`,
     `D.M.YY` and so on, read day first (`dmy`) or month first (`mdy`).
     Two-digit years are 20YY.
   - Text months, English: `12 Mar 2026`, `12 March 2026`, `Mar 12, 2026`,
     `March 12 2026`.
   - Anything else, or an impossible date (`31/02/2026`): skip as
     `invalidDate`.

   Deliberate difference from the Python: `01.09.2026` is 1 September (the
   TUI only reads `/` and `-` day-first, so pandas returns 9 January).
2. **Merchant:** blank after trimming → skip as `emptyMerchant`. Kept as
   written otherwise; the Worker resolves aliases.
3. **Amount** via the existing `parseAmountCents` (worker/src/domain/money.ts,
   already held to `clean_amount`): blank, `-` and non-numbers are 0.
   - Single column: 0 → skip as `zeroAmount`; `typeMode` decides the type
     (`auto`: negative = expense, positive = income); cents become positive.
   - Two columns: the non-zero one decides (in = income, out = expense); both
     non-zero → the larger absolute value wins; both 0 → `zeroAmount`.
     `typeMode` is ignored in this mode, as in the TUI.
4. **PayPal rule:** single column, `typeMode = "auto"`, and the header has
   `Balance Impact` whose value is not `Debit` → skip as `notDebit`.
5. **Filter:** when set, a value not equal to `filter.value` (trimmed,
   ignoring case) → skip as `filtered`. Checked after the TUI's rules, so the
   TUI's counts stay comparable.

Output:

```ts
interface ParsedImport {
  header: string[];
  headerRow: number;
  rows: { line: number; date: string; merchant: string; amountCents: number; type: TransactionType }[];
  skipped: Record<"invalidDate" | "emptyMerchant" | "zeroAmount" | "notDebit" | "filtered", number[]>; // line numbers
}
```

`line` is the 1-based row number in the file as a spreadsheet shows it.

### Held to the Python

A new `import` section in `worker/src/__tests__/fixtures/python_vectors.json`,
recorded by `tools/crosscheck/vectors.py` running the real
`ImportScreen._parse_date_smart` and `_process_row` on synthetic inputs:

- dates: every shape listed above except the dot form (recorded as the
  Python's answer and asserted as a known difference);
- rows: single and two-column modes, each `typeMode`, the PayPal rule, zero
  and blank amounts, empty merchants.

The TS tests replay them; `--check` in CI keeps them current.

## Worker

### `POST /api/import`

Body:

```ts
interface ImportRequest {
  source: string;        // trimmed, 1–100 chars
  filename?: string;     // ≤ 255 chars
  mapping: ImportMapping;
  rows: { date: string; merchant: string; amountCents: number; type: "expense" | "income" }[]; // 1–5,000
}
```

- zod checks the shape (the mapping's fields too, strict). Over 5,000 rows →
  400 "At most 5,000 rows per import: split the file". The rows go to D1 as
  one JSON value, capped near 2 MB; 5,000 rows is about 600 KB.
- Calls `importTransactions(db, rows, { source, filename, userId })`.
  `ValidationError` → 400 `{ error: "The file has rows the import refuses", errors: string[] }`
  with the Python's messages; nothing is written.
- After a successful import, saves the mapping: `settings` key
  `import_mappings`, value `{ [source]: ImportMapping }`, read-modify-write of
  that one key.
- 200 `ImportResult` (`batchId, inserted, duplicates, suppressedDeleted,
  newMerchants`).

### `GET /api/import/mappings`

`{ mappings: { [source]: ImportMapping } }`, `{}` when none.

Both routes sit behind the Origin check. `ImportMapping` and the request and
response types live in `worker/src/api/import.ts`, shared with the frontend.

## Frontend: `/import`

Top bar gains **Import**. One page, top to bottom:

1. **File and source.**
   - The file input accepts `.csv,.xls,.xlsx`.
   - **Source:** existing sources (`lookups.sources`) plus "New source…",
     which reveals a name field defaulting to "CSV Import". The source is
     always chosen by hand; nothing is guessed from the file name.
2. **Mapping.**
   - Saved mapping that fits: one collapsed line, e.g. "Date ← Completed
     Date · Merchant ← Description · Amount ← Amount · State = COMPLETED",
     with **Edit**.
   - No mapping, or it doesn't fit: the form, pre-filled with the fields that
     still match, and a notice naming each missing column ("This file has no
     'Completed Date' column").
   - The form: date, merchant, amount, amount out (optional) — selects of the
     header names; type (Auto from sign / All expenses / All income); date
     order (Day first / Month first); header row; filter (column + value,
     optional). Every change re-parses.
3. **Preview.**
   - The first 10 parsed rows: date, merchant, amount (signed by type), type.
   - A count line: "84 to import (79 expenses, 5 income) · skipped: 3 not
     COMPLETED, 1 empty merchant". Each skip reason expands to its row
     numbers.
   - No rows to import → the Import button is disabled with "Nothing to
     import".
4. **Import.**
   - "Suggest categories for new merchants" — shown when `lookups.gemini`,
     ticked by default.
   - **Import N transactions**; over 5,000 rows disabled with the split
     message. Nothing is saved before this.
5. **Result.**
   - "Imported 80 · 4 already there · 0 previously deleted · 3 new
     merchants".
   - When the box was ticked and `newMerchants` is non-empty, the page calls
     `POST /api/merchants/suggest` and adds its `suggestMessage`, or the
     Gemini error with Retry; the import itself stands either way.
   - Links: **View in Transactions** (that source, the file's first to last
     date) and, after suggestions, **Review suggestions**
     (`/merchants?attention=suggested`).
   - A 400 lists the Worker's `errors`; nothing was saved.
   - **Import another file** clears the page, keeping the source list fresh.
   - The import invalidates the queries every transaction write already
     invalidates, plus `merchants` and `lookups`.

Works at phone width; the preview table scrolls sideways inside its card.

## Testing

- `parse` (Vitest, synthetic fixtures):
  - grid readers: a CSV with quotes, `;` and a BOM; an `.xls`/`.xlsx`
    fixture built in the test with SheetJS (preamble rows, spacer columns,
    number cells, a date cell);
  - header detection: preamble skipped; saved mapping finds a moved header;
    pinned row;
  - blank and repeated column names;
  - every date shape, both orders, impossible dates, the dot difference;
  - single and two-column amounts, each type mode, PayPal, the filter, skip
    line numbers;
  - the Python vectors.
- Worker: route validation (each field, 5,000 cap, strict mapping), a
  `ValidationError` returning the messages with nothing written, mapping
  saved only on success and merged per source, `GET` mappings, Origin check,
  and a 5,000-row import through `fakeD1`.
- Page: fitting mapping collapsed; non-fitting mapping opens the form with
  the missing-column notice; preview counts and skip line numbers; the cap;
  Gemini box hidden without a key; result summary and links; suggest failure
  keeps the import; 400 errors listed.
- Before the PR: `wrangler dev` on a throwaway D1 copy, importing the owner's
  September files through the page, checking counts against the files and
  that a second import of the same file inserts nothing. Gemini is only
  called with the owner's OK.

## Out of scope

- Editing or deleting saved mappings outside the import page (re-mapping
  overwrites).
- Using the `Fee` column, currency conversion, or `Type`-column rules.
- Undoing a whole import batch (rows can be deleted from Transactions).
- Bank sync (Link Banks).
