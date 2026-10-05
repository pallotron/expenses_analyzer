# Payslips — design

Port of the TUI's Payslips screen (`y`, `payslips_screen.py`) and of the
pension-aware savings rate it feeds on the Summary
(`analysis.get_enhanced_savings_totals`).

## Goal

Either household user imports payslip PDFs, for themselves or the other user,
through the browser. The figures are checked, stored per person, per file and
per month. The Summary's savings rate gains a "with pension" figure.

Success means:

- A month's PDF, or a whole folder of them, can be dropped and imported. Doing
  it again changes nothing that is already right.
- A later bonus or on-call PDF joins its month instead of replacing it.
- The year-to-date pension check works across separate imports.
- The Summary shows the rate with pension, for the people whose accounts are
  selected.
- The browser parser's output on the owner's real PDFs matches
  `payslips.parquet` month by month (checked locally, never committed).

## Usage this is built for

Monthly imports as a habit (one PDF, sometimes a second for a bonus or on-call
run, possibly on different days), plus an occasional whole-folder re-import.

## Constraints

- PDFs are read in the browser with pdf.js (`frontend/src/payslips/pdf.ts`,
  already ported). Only parsed figures reach the Worker. No PDF, PDF text,
  employer name or password is ever sent or stored.
- Money is integer cents throughout.
- Lists go to D1 as one JSON value read with `json_each` (D1 binds at most 100
  parameters).
- Multi-statement writes go through `atomic()` in one D1 batch.
- The repo is public: fixtures are synthetic, and no personal names, banks or
  paths go into code, tests, docs or commits.
- Only the layout the existing parser reads is supported. The second user's
  payslips use a different layout; they show "Layout not recognised" until a
  follow-up adds a parser for it.

## Out of scope (follow-ups)

- A parser for the second payslip layout, built from a local sample, with
  synthetic fixtures.
- A Dropbox button: Dropbox's browser-only sign-in (OAuth with PKCE) to list
  the payslip folder and download PDFs straight into the browser. The import
  takes `File`s from any source, so it slots in without changes. A
  server-side fetch is ruled out, since it would put PDFs on Cloudflare.
- The TUI's note for months with a payslip but no bank data: the web's period
  picker is built from transactions, so those months cannot be selected.

## Data

### New table `payslip_runs`: one row per payslip PDF

| column | type | meaning |
|---|---|---|
| `id` | integer PK | |
| `user_id` | integer → `users.id`, not null | whose payslip |
| `source_file` | text, not null | the PDF's file name |
| `month` | text `YYYY-MM`, not null | from the file name (`monthFromFilename`) |
| `salary_cents` | integer | basic salary, including back pay or unpaid-leave adjustments (may be negative) |
| `bonus_cents` | integer | |
| `on_call_cents` | integer | |
| `reimbursements_cents` | integer | taxable reimbursements, counted in gross |
| `non_taxable_adj_cents` | integer | non-taxable adjustments, added after tax (may be negative) |
| `misc_deductions_cents` | integer | other deductions taken from net |
| `pension_ee_cents` | integer | employee pension |
| `avc_cents` | integer | additional voluntary contribution |
| `pension_er_cents` | integer | employer pension |
| `paye_cents`, `prsi_ee_cents`, `usc_cents` | integer | the three taxes |
| `pension_ee_ytd_cents`, `avc_ytd_cents`, `pension_er_ytd_cents` | integer | the payslip's year-to-date figures |
| `stated_net_cents` | integer, nullable | the net printed on the payslip; null when not found |
| `gross_cents` | integer | derived: salary + bonus + on-call + reimbursements |
| `tax_total_cents` | integer | derived: PAYE + PRSI + USC |
| `net_cents` | integer | derived: gross − (pension EE + AVC) − tax − misc deductions + non-taxable adjustments |
| `net_reconciled` | boolean | derived: `stated_net` is null, or `abs(net − stated_net) < 1` |
| `imported_by` | integer → `users.id`, not null | who uploaded it |
| `created_at`, `updated_at` | integer | |

The money columns are not null and default to 0, except `stated_net_cents`.
Unique on (`user_id`, `source_file`): re-importing a file replaces its row.

The four derived columns are computed by the Worker, never taken from the
client. The formulas move out of `frontend/src/payslips/parser.ts` into a
shared pure module, `worker/src/domain/payslips.ts`, which both `PayslipRun`
and the Worker use, so they cannot drift.

### New table `source_owners`

| column | type | meaning |
|---|---|---|
| `source` | text PK | an import source name, as in `transactions.source` |
| `user_id` | integer → `users.id`, nullable | the account's owner; null means no one (a shared account, or one belonging to neither user) |

A source with no row counts as owned by no one.

### Existing table `payslips`: the month totals, unchanged in shape

One row per (user, month). The Summary keeps reading it. For a month that has
runs, the row is rebuilt from them:

- `gross/net/tax_total/pension_ee/avc/pension_er/bonus/on_call_cents`: sums
  over the month's runs.
- `source_files`: the runs' file names, sorted.
- `net_reconciled`: true only if every run reconciles.
- `ytd_reconciled`: the month's period pension (EE + AVC summed) equals its
  ending YTD minus the prior, within a tolerance of under 1 cent.
  - The ending YTD is the max of `pension_ee_ytd + avc_ytd` over the month's
    runs.
  - The prior is the ending YTD of the latest earlier month in the same
    calendar year that has a `payslips` row (as `aggregate_runs` takes the
    previous month in its sorted list, gaps allowed). With no such month the
    prior is 0, as for January.
  - If the ending YTD is lower than the prior, a new employer started its own
    count, so the prior is 0 (`aggregate_runs`).
  - If that earlier month has no runs (TUI-era data has no YTD), the flag is
    null.

Months with no runs (the 13 imported from the TUI) are never touched by a
rebuild. A month whose last run is removed is deleted.

### Migration

One drizzle migration (`0002_*`) adds both tables. It leaves the existing
data alone. Prod D1 needs it applied before the deploy; the owner runs that
command.

## Worker

### Domain: `worker/src/domain/payslips.ts` (pure)

- `deriveRun(parts) → { grossCents, taxTotalCents, netCents, netReconciled }`.
- `aggregateMonths(runs, existingMonths) → MonthRow[]`, a port of
  `payslip_handler.aggregate_runs` plus the null-prior rule above. It takes
  every run for one user and returns the rows for the months that have runs.
- `enhancedSavings(...)`, a port of `get_enhanced_savings_totals`, extended
  with the per-person rule (see the Summary section).

`tools/crosscheck/vectors.py` gains cases for `aggregate_runs` and
`get_enhanced_savings_totals`, so the TypeScript is held to the Python's
numbers. The cases cover several runs in one month, a missing month, January,
a new employer starting mid-year, a net mismatch, partial-year coverage and a
payslip month with no bank data.

### Service: `worker/src/services/payslips.ts`

- `listPayslips(db)`: the users (id, display name) and, per user, the months
  (newest first) with their runs. A TUI-era month comes with an empty run list.
- `importRuns(db, userId, runs, importedBy)`:
  1. Read the user's existing runs and months.
  2. Merge in the new runs, replacing by `source_file`.
  3. Rebuild the affected months, plus, for each, the next later month of the
     same year that has runs, since its YTD check depends on them.
  4. In one `atomic` batch: upsert the runs and upsert those month rows.
  5. Return `{ months: string[], replaced: number, ytdMismatches: string[] }`.
- `removeRuns(db, userId, sourceFiles)`: the same, deleting the runs, then
  rebuilding their months and the next later month of each, and deleting any
  month left without runs.
- `listSourceOwners(db)` / `setSourceOwner(db, source, userId | null)`. The
  list holds every distinct `transactions.source` with its owner, or null.

Two concurrent imports for the same user could race; the last batch wins on
whole month rows, so a month is never left half-built. Acceptable for a
two-person household.

### Routes

| route | body / answer |
|---|---|
| `GET /api/payslips` | `PayslipsResponse` |
| `POST /api/payslips/import` | `{ userId, runs: RunParts[] }` → `{ months, replaced, ytdMismatches }` |
| `POST /api/payslips/remove` | `{ userId, sourceFiles: string[] }` → `{ months }` |
| `GET /api/source-owners` | `{ sources: { source, userId: number \| null }[], users: { id, name }[] }` |
| `POST /api/source-owners` | `{ source, userId: number \| null }` |

Validation (zod, strict, every 400 with a readable message):

- `userId` must exist.
- 1–500 runs per import, with file names non-empty and unique in the request.
- `month` is `YYYY-MM` and equals `monthFromFilename(sourceFile)`.
- Every part is whole cents within ±1,000,000,000 (10M euros). `stated_net` may
  be null.
- `remove` takes 1–500 file names. Removing an unknown file is a no-op, not an
  error.
- `source-owners` 404s on a source no transaction has.

Shared API types live in `worker/src/api/payslips.ts` (no imports), re-exported
from `frontend/src/lib/types.ts`.

## Summary: savings rate with pension

`SummaryResponse` gains:

```ts
pension: {
  pensionCents: number;        // EE + AVC + ER over the counted people and months
  savedCents: number;          // bank net over those months + pension
  incomeCents: number;         // bank income over those months + pension
  rate: number;                // saved / income * 100, 0 when income <= 0
  months: number[];            // 1–12, the months covered
  coverageLabel: string;       // "Jan–Sep", "Mar" or "3 mo"
  reconciled: boolean;         // every counted month's ytd_reconciled is not false
  people: string[];            // display names counted
} | null
```

Rules, matching the TUI except for the per-person filter:

- **People counted:**
  - With all sources selected (no source filter): every user.
  - Otherwise: each user who owns at least one selected source in
    `source_owners`.
  - If nobody is counted, `pension` is null.
- **Months covered:** months in the period where at least one counted person
  has a `payslips` row and the bank scope has transactions. In a month view,
  only that month. None means null.
- **Bank side:** income and net (income − expenses) over the covered months
  only, under the same scope as the rest of the Summary: sources, and hidden
  tags excluded unless "include hidden" is on.
- **Pension** is added to both saved and income. Net pay is not, since it
  already lands in the bank.
- **reconciled:** a null `ytd_reconciled` (no prior to compare with) does not
  count as a failure. Only `false` does, so TUI-era months do not raise a
  warning.

The rounding of `rate` follows the frontend's existing `formatPercent`.

The Savings rate tile shows a second line, "31.2% with pension · Jan–Sep", with
⚠ and an explanation (hover or tap) when `reconciled` is false. The coverage
label follows the TUI's `_coverage_label`: a contiguous run is "Jan–Sep" (or
"Mar" for one month), and gaps fall back to a count, "3 mo", since a range
would imply full coverage.

## Frontend

### `/payslips` page (top-bar link "Payslips")

- **Person:** a picker of the household users, defaulting to the signed-in
  user (`/api/me` matched by email).
- **Password:** a box next to the picker, remembered per person in
  `localStorage` (try/catch around every access), with a "Forget" link. It is
  never sent to the Worker.
- **Drop zone and file picker:** PDFs only, multiple at once. Each file is
  parsed as soon as it is added.
- **Preview, one line per file:** file name, month, gross, net, pension
  (EE+AVC / ER), and a status:
  - `Reading…`.
  - `New`, or `Replaces the saved copy` (same file name already saved for this
    person).
  - `Net doesn't match the payslip`: a warning, still importable.
  - `Needs password` / `Wrong password`: re-parsed automatically when the
    password changes.
  - `Layout not recognised` / `No month in the file name`: left out.
  - `Left out (name contains "draft")`, and likewise for the TUI's other
    ignore tokens except its profane one. The "Use anyway" button includes
    it.
  - ✕ removes the line.
- **Import N files:** one request, with the button disabled while files are
  reading. The result names the months saved and the files replaced, and
  flags any YTD mismatch. On error nothing changes, and the page shows the
  message with a Retry button.
- **Saved payslips** for the chosen person, one line per month: month, gross,
  net, pension, and both checks (✓ / ⚠ / "—" for unknown). Expanding a month
  lists its files, each with Remove (confirm first). TUI-era months show
  "from the TUI" and have no files.
- **Accounts:** every import source with an owner picker (each user, or "No
  one"), saved on change. A short line explains that this decides whose
  pension counts when Summary is filtered by source.

The parsing uses the existing `parsePayslip(file, password, extractor)`. The
extractor is injectable, so tests use a fake.

## Errors

- PDF failures stay in the browser, as line statuses; nothing is sent for them.
- Worker 400s show their message on the page. 5xx and network errors show a
  generic message with Retry, and change nothing (batched writes).
- An import whose file was removed elsewhere in the meantime simply re-adds
  it; there are no stale-version checks (YAGNI for two users).

## Testing

- **Domain:**
  - `deriveRun` and `aggregateMonths` against the new Python vectors and
    hand-written cases (null prior, rebuild of the following month);
  - `enhancedSavings` against the Python vectors for the all-sources case,
    plus per-person cases.
- **Service:**
  - import, replace, add-to-month, remove, and removing a month's last run;
  - TUI-era months untouched;
  - more than 100 runs and file names on the D1 fake (bound-parameter cap);
  - a failure part-way leaves nothing written.
- **Routes:** each validation rule, the 404, origin check, and the response
  shapes.
- **Frontend:** the page with a fake extractor (password retry, wrong
  password, unrecognised layout, ignored names and "Use anyway", replacement,
  import result, error and Retry, remove with confirm), password storage
  failure tolerated, the Accounts picker, and the Summary line (shown, hidden,
  ⚠).
- **Real data, local only:** run the browser parser (through Node) over the
  owner's payslip folders listed in `payslip_settings.json`. Compare the
  aggregated months with `payslips.parquet`; every month must match. Nothing
  from this run is committed.

## Delivery

One PR, one commit per piece (domain + vectors, migration + service + routes,
Summary pension, page, Accounts), via the subagent-driven plan. The second
layout's parser and Dropbox are separate follow-ups.
