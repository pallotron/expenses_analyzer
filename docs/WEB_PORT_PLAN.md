# Web Port Plan

Status of the TypeScript rewrite of the Textual TUI, and the order the rest of
it should be done in. This file is the working state; the *reasoning* behind the
stack choices is deliberately not repeated here.

Delete this file at cutover, together with `expenses/` and `tests/`.

## Ground rules

The TUI stays live and is the **reference implementation** until cutover. Nothing
is ported from scratch — every piece is ported *against* the Python, and proved
equal to it before it is wired in. `tools/crosscheck/` and the existing pytest
suite are what make the old implementation an executable spec. That technique has
already caught two real bugs (a `spending_type` bucketing difference worth
€7,672, and a cents rounding error where both sides agreed on the wrong answer
because they shared a broken helper).

Two invariants to protect while building. Both are cheap now and a refactor later:

1. **Auth lives behind a single `getUser(request)`.** No `Cf-Access-*` header
   read and no JWT verification anywhere else. Never trust
   `Cf-Access-Authenticated-User-Email` on its own — verify the signature and
   the `aud` claim.
2. **`env.DB` is touched only by the Drizzle setup.** No D1-specific calls
   (`.prepare()`, `.batch()`) in query code. `createDb()` in
   `worker/src/db/client.ts` is that setup; everything else takes a `Db`.

Money is integer cents everywhere. Never multiply a float by 100.

## Done (PR #23, merged)

- `worker/src/db/schema.ts` — the Drizzle schema, 13 tables, single source of
  truth. Generated DDL in `worker/drizzle/`.
- `tools/migrate_to_sqlite.py` — parquet + JSON → SQLite, one-shot. Imports the
  live `expenses` package so aliasing/tags/normalisation are literally the same
  code. Has a `verify()` that re-derives everything from SQLite and compares to
  the parquet. Run on real data: 2,294 transactions.
- `tools/money.py` — the one `to_cents`, shared so two tools cannot disagree.
- `tools/dump_for_d1.sh` — dumps INSERTs parents-first. `sqlite3 .dump` emits
  CREATE order and includes `sqlite_sequence`, both of which D1 rejects.
- `tools/crosscheck/` — 10 checks, 8 SQL queries, exact diff against the Python.
  Green on real data.
- `frontend/src/payslips/` — `payslip_parser.py` ported, 27 tests, verified
  byte-identical across 9 scenarios × 21 fields.
- CI: `build` (Python, job id unchanged so required checks resolve),
  `Frontend Tests`, `Worker Checks` including a drizzle drift check.

Local development works with no Cloudflare account: local D1 + `wrangler dev`.

## Decided: no sync (2026-09-29)

**(a) One mode per install**: desktop *or* cloud, never both over the same
data. The schema gets no change-tracking columns, and the service layer is
unblocked.

The rejected option was (b), desktop as an offline client of the cloud. It
needs change tracking, conflict resolution and a merge story for two people
editing one transaction, which is a project about the size of the rest of the
port. Revisiting it means adding those columns to a live schema.

The TrueLayer client secret can never ship inside a desktop app, so bank sync
needs the hosted Worker either way. Everything else works offline. If a desktop
mode happens, prefer SQLite WASM + OPFS in the browser (installed as a PWA) over
Electron — same schema, same queries, no 150MB bundle, no code signing.

## Order of work

### 1. Service layer (`worker/`)

Port the analysis first: the SQL already exists and is already proved correct.
`tools/crosscheck/queries/*.sql` is the source — move each query into a Drizzle
query module and keep the cross-check pointed at the SQL files so they stay the
thing that was verified.

- ~~`analysis.py` (368) → query modules.~~ Done: `worker/src/queries/analysis.ts`
  over `v_summary`/`v_live`. `src/__tests__/queries/analysis.test.ts` proves
  each function returns exactly what its SQL file returns, on a synthetic
  fixture in CI and on real data with
  `CROSSCHECK_DB=<db built by migrate_to_sqlite.py> npm test`. The chain is
  Python = SQL (cross-check) and SQL = TypeScript (this test). Query modules
  take a `Db` (`src/db/types.ts`), never a D1 binding, and `/health` now goes
  through `createDb`, so invariant 2 holds everywhere.
- ~~`data_handler.py` (954)~~ Done. The parquet I/O is gone, and the rest is in
  `worker/src/domain/` (merchant normalisation and aliasing, amount parsing)
  and `worker/src/services/transactions.ts` (import with dedup and
  soft-delete suppression, delete, restore, tag, edit).
  - **Verification.** `tools/crosscheck/vectors.py` runs the Python's own
    functions, including `append_transactions` on 14 scenarios, and writes
    the answers to `worker/src/__tests__/fixtures/python_vectors.json`. The
    Worker's tests replay that file, and CI fails if it is stale. With
    `CROSSCHECK_DB`, every real transaction resolves to the merchant the
    migration gave it, and re-importing all of them adds nothing.
  - **Differences from the Python.** Delete, restore and edit act on ids. The
    Python matched on (date, merchant, amount) and so hit every identical twin.
    Occurrence values are only kept free; which copies are duplicates is still
    decided by counting, as in the Python.
  - **Amounts.** Python stored `round(x * 100)` half-to-even in binary floats
    (pandas `.round(2)`), so "2.675" is 268 cents but "1.005" is 100.
    `parseAmountCents` reproduces that, or re-imports would miss their
    duplicates by a cent.
  - **Left for later.**
    - Gemini category suggestions on import move with `gemini_utils.py`.
    - Exact dedup on `external_id` moves with the TrueLayer port. It has to
      decide how provider ids meet rows migrated without one.
    - Dedup uses each row's stored merchant. When the merchant editor adds an
      alias, it must re-point the matching rows, as the Python re-derived
      display names on every load.
- ~~`tags.py`~~ Done, in `worker/src/domain/tags.ts`, held to the same vectors.
- ~~`transaction_filter.py`, `validation.py`, `merchant_editor.py`~~ Done.
  - `domain/filters.ts` and `queries/transactions.ts` (`listTransactions`).
    Quoted text matches the whole field, so a quoted tag only matches a row
    with that one tag, as in the Python.
  - `domain/validation.ts`: same limits and messages. `importTransactions`
    validates first and writes nothing on failure.
  - `services/merchants.ts`: `previewAliasChange` and `saveMerchantDecision`.
    Saving re-points every row whose name the new table changes, which the
    Python got for free by re-deriving names on each load. Only rows the
    edited pattern matches are resolved: a full pass took ~140ms of CPU, too
    much for a Worker. `repointRows` is the one place rows change merchant;
    `deleteMerchantRule` and `setMerchantCategory` sit beside it.
  - All held to the Python by new sections of `python_vectors.json`. On real
    data, re-saving each of the 180 existing rules moves nothing, and the
    list totals exactly what `v_live` totals.
- ~~`getUser(request)` + Cloudflare Access JWT verification with `jose`.~~ Done:
  `worker/src/auth.ts`. Checks signature (RS256 only), issuer, audience and
  expiry, then maps the email claim to `users`. Unknown or missing email is a
  403, and an empty `CF_ACCESS_AUD`/`CF_ACCESS_TEAM_DOMAIN` is a 500. Every
  route goes through it, including `/health`. `DEV_USER_EMAIL` in `.dev.vars`
  stands in for Access, but only for requests to localhost. `/api/me` is the
  route to hit first after deploying.
- ~~Promote the analysis views into the schema.~~ Done, see
  [Local analysis snapshot](#local-analysis-snapshot).

### 2. Frontend screens (`frontend/`)

The service layer for most of this already exists (`services/transactions.ts`,
`services/merchants.ts`); what is missing is routes and screens. The inventory
below was taken from the TUI on 2026-09-30 so that nothing is lost at cutover.
Each line is a TUI feature, where it lives, and what the web does with it.

**Order**, one PR each unless noted: Transactions (read) → Transactions
(edit) → Summary drill-down + hidden-tag editor (done) → Merchants page (done) +
Gemini (done) →
Import (done) → Budget types (done) → Payslips (done) → Link Banks (step 3) → PDF (step 4).

#### Summary (`summary_screen.py`) — core done in PR #30

- ~~Tiles, spending split with budgets, monthly chart, breakdowns, grid with
  anomaly flags, source filter, include-hidden toggle (`x`).~~ Done.
- ~~Drill-down (`enter` on a category/merchant/month cell) → link into
  Transactions with the matching filters.~~ Done: every list row, grid cell
  and chart bar or month column links to `/transactions` with the
  Summary's period, sources and hidden-tag scope (`drillDown` in
  `worker/src/api/transactions.ts`).
- ~~Hidden-tag editor (`X`, `tag_exclusion_screen.py`): edit
  `tag_exclusion_patterns`, entries may end in `*`.~~ Done: "Edit…" beside
  the hidden-tags status opens a checkbox sheet laid out like the TUI's
  (`ns:*` rows, tags in use, stale patterns); `POST
  /api/summary/hidden-tags` replaces the list, and a save turns the
  exclusion back on.
- ~~Pension-aware savings rate (`get_enhanced_savings_totals`)~~ Done with
  Payslips, on the Savings rate tile. The payslip-only month note is dropped:
  the period picker is built from transactions, so such a month can't be chosen.
- Compact mode (`ctrl+m`), focus mode (`f`): **dropped**, the responsive
  layout replaces them.
- Export PDF (`e`): step 4.

#### Transactions (`transaction_screen.py` + modals)

Read PR:
- ~~List with filters: date range, merchant, category, source (quoted =
  exact), amount range, tags, type (all/income/expense), budget type
  (all/essential/discretionary). Filters live in the URL so Summary can
  link in.~~
- ~~Phone: card rows; desktop: table with sortable columns.~~ Done in PR
  #34: `GET /api/transactions` and `/api/lookups`; `sources` and
  `excludeHidden` match the Summary's scope, and a test checks that every
  Summary number drills down to a list with the same total. Opens on the
  latest month with data; filters stay in the URL.

Edit PR A (row actions) and PR B (merchant editor, budget type):
- ~~Edit one transaction (`edit_single_transaction_screen.py`): date,
  merchant, amount, source, type → `updateTransaction`.~~
- ~~Bulk edit selected (`b`, `bulk_edit_transaction_screen.py`): merchant,
  source, type for many rows.~~
- ~~Tag selected (`g`) / tag all filtered (`G`), add or remove
  (`tag_transactions_screen.py`) → `tagTransactions`. Tag inputs autocomplete
  from known tags (`tag_suggester.py`).~~
- ~~Select, select all, delete selected (soft delete) →
  `softDeleteTransactions`. The TUI has no restore UI although
  `restore_deleted_transactions` exists; the web adds an "Undo" after delete
  using `restoreTransactions`.~~
- ~~**Bulk delete screen (`d`, `delete_screen.py`) folds in here**: its
  filters (date, merchant regex/glob, category, source, amount) are the
  Transactions filters plus "select all filtered → delete". Regex/glob
  matching is dropped in favour of the list's contains/exact match.~~

  Done: five routes `PATCH /api/transactions/:id`, `POST /api/transactions/bulk-edit`,
  `/delete`, `/restore`, and `/tags`. An Origin check on every non-GET `/api/*` request
  allows local dev ports. A per-transaction category override, new and not in the TUI,
  is stored separately and resolved on read. Row selection shows an action bar (Tag,
  Untag, Edit, Delete) with bulk-edit sheets; delete asks for confirmation above 20
  rows and offers an Undo toast. PR B also: edit sheet shows dot decimals and
  refuses a signed amount ("use Expense/Income for the direction"); Undo
  restores only rows actually deleted; tagging skips deleted rows;
  delete-confirm total is signed; phone checkboxes have 44px tap targets.

- ~~Edit merchant (`e`, `edit_merchant_screen.py`): regex pattern, display
  alias, category, tags, live preview of affected rows →
  `previewAliasChange` / `saveMerchantDecision`. Suggests a pattern from the
  raw name (`_suggest_pattern`).~~ Done: `MerchantEditor`, from a
  transaction's edit sheet ("Merchant rule…") and from the Merchants page;
  rules can also be deleted. `suggestPattern` cuts the raw name at its first
  " dd/dd" stamp (as `normalizeMerchantName` does), drops a trailing number,
  escapes once, and always appends `.*`, so a suggestion always matches the
  name it came from.
- ~~`x` cycles the budget type filter from a row (All → Essential →
  Discretionary).~~ Done: the Budget filter. Changing a category's type
  belongs to Budget types; the merchant editor shows it read-only and will
  offer it once that service exists.
- Export PDF (`p`): step 4.

#### Merchants page (`/merchants`) (replaces Categorize)

- ~~Merchant list with its category, filter by merchant and by category,
  multi-select, assign an existing category or type a new one.~~ Done: columns
  (category, budget, count, signed total, last seen, rules); filters (name,
  category, needs attention: uncategorized/suggested, type); sortable columns;
  multi-select to set or clear the category on many merchants; "→" links to
  the merchant's transactions (exact match).
- ~~"Auto-categorize uncategorized" → Gemini, below.~~ Done.

#### Gemini categorization (`gemini_utils.py`)

Two entry points in the TUI: the import checkbox "Suggest categories for new
merchants with AI" and Categorize's "Auto-Categorize Uncategorized". Both send
the merchant names not yet in `categories.json` to Gemini in one call, with the
existing categories as guidance (income and expense prompts differ), and
merge the returned `{merchant: category}` map.

~~Port~~ Done: `worker/src/services/categorize.ts` calls the Gemini REST API
(`services/gemini.ts`, key in the `x-goog-api-key` header) from the Worker.
The key is a Worker secret (`wrangler secret put GEMINI_API_KEY`), never
sent to the browser; `GEMINI_MODEL` in `[vars]` (default
`gemini-2.5-flash`). Prompt building and parsing (`domain/gemini.ts`) are
held to the Python by the `gemini` section of `python_vectors.json`.
"Suggest categories" on the Merchants page sends every uncategorized
merchant the page lists (live rows or a rule), 100 per call, and saves the
answers at once flagged as suggested (`merchants.category_suggested`); the
Suggested filter and the selection bar's Confirm review them. New categories
are allowed. "Ask Gemini" in the selection bar is a second opinion on the
chosen merchants, asked blind with the same prompt: `POST
/api/merchants/ask` saves nothing, a sheet lists current → suggested for
the disagreements, and `POST /api/merchants/categories` applies the ticked
ones in one batch, as the user's own choice. Import will reuse
`suggestCategories` when it is ported. Only merchant and category names are
sent, as today.

#### Import (`import_screen.py`, `file_browser_screen.py`)

- ~~File picker, preview, column mapping, type, source, AI-suggest; smart
  dates; PayPal rows; per-reason skip counts.~~ Done: `/import` reads
  `.csv` (Papa Parse) and the banks' `.xls`/`.xlsx` exports (SheetJS, loaded
  only there) into a grid; `domain/importRows.ts` finds the header below any
  summary rows, maps columns by name and parses or skips each row with a
  reason, held to the Python by the `import` section of `python_vectors.json`
  (except "." dates and short years, which the TUI misread). Mappings are
  remembered per source (`settings.import_mappings`), with an optional row
  filter (e.g. State = COMPLETED). `POST /api/import` (5,000 rows at most)
  runs `importTransactions` and then saves the mapping; the page asks Gemini
  for the new merchants when ticked.
- Done: several files at once. Each gets a source picked by hand and a dry run
  (`dryRun` on `POST /api/import`, the import's own counting) showing what is new,
  with the source's last live date beside it; "Import all" sends one request per
  file in order, re-checking same-source files first, then asks Gemini once.
  `GET /api/import/sources` (replacing `/import/mappings`) gives each source's
  saved mapping and last live date.

#### Budget types (`u`, `budget_types_screen.py`)

- ~~Toggle each category essential/discretionary; set the annual essential and
  discretionary budgets (`spending_type_budgets`). Small settings screen.~~
  Done: `/budgets`, also opened as a sheet from the Summary's split card.
  Unused categories are folded; untyped income-only ones are not listed.
- ~~Also make the budget type editable in the merchant editor, under its
  category.~~ Done: it saves at once, for the whole category.

#### Payslips (`y`, `payslips_screen.py`)

- ~~Owners (people), import payslip PDFs, preview, save. The parser is already
  ported (`frontend/src/payslips/`). Folders become a multi-file picker.~~
  Done: `/payslips`. PDFs (or a dropped folder) are read in the browser, one
  `payslip_runs` row per file, and the `payslips` month rows are rebuilt from
  them, so a later bonus PDF joins its month and a re-import replaces its file.
  An Accounts section says whose account each source is, and the Summary shows
  the savings rate with pension for the owners of the selected sources. Text
  is read in the PDF's own order, as pypdf did; checked against both people's
  real payslips. A Dropbox button is a possible follow-up.

Payslips are parsed **client-side** with pdf.js and only the parsed numbers are
POSTed. A Worker has no filesystem, so the folder scanner cannot survive — and
keeping the PDF off Cloudflare keeps the employer name off third-party
infrastructure. There is deliberately no `payslip_folders` table.

#### Not ported

- Backups (`b`, `backup.py`, `backup_screen.py`) and auto-recovery from a
  corrupt parquet: D1 Time Travel (point-in-time restore: 7 days on the free plan, 30 on paid) and
  `tools/snapshot.sh` replace them. Restoring is a manual
  `wrangler d1 time-travel restore`, documented in the README.
- Log viewer widget and `app.log`: `wrangler tail` / Workers Logs.
- Command palette, keybindings, notifications: normal web navigation and
  toasts.

### 3. Bank integration

`truelayer_handler.py` (713) → a Hono route; `oauth_server.py` (95) folds into
it, since the Worker *is* the callback server. The redirect URI changes from
`localhost:3000` to the deployed origin, which means re-registering it with
TrueLayer.

### 4. PDF export

`pdf_export.py` (543) → `pdfmake`. Last, because nothing depends on it.

### 5. Cutover

Delete `expenses/`, `tests/`, `tools/crosscheck/` and this file in one change.
Only do it once `tools/snapshot.sh` has replaced the parquet for ad-hoc
analysis. The script and the views stay after cutover.

## Local analysis snapshot

The TUI goes at cutover, but asking Claude questions about the data from a
terminal has to keep working. Today that means reading `transactions.parquet`
with pandas. Afterwards it means a local SQLite copy of D1. Keeping the TUI
alive for this would be the wrong trade: a second writer is sync option (b), and
a read-only TUI means maintaining Python that nothing checks any more.

**The views (done).** `v_live` (live rows, category resolved override →
merchant → `"Other"`), `v_excluded_ids`, `v_summary` (Summary totals with the
tag exclusions applied) and `v_transactions` are `sqliteView`s in
`worker/src/db/schema.ts`, generated into `worker/drizzle/0001_*.sql`. The
cross-check runs against the migrated views, so the definitions that were
verified are the ones that ship. It also diffs `v_transactions` against the
parquet row by row.

`v_transactions` has the same shape as the parquet rows, so ad-hoc questions
need no joins:

| column         | from                                                          |
|----------------|---------------------------------------------------------------|
| `id`           | `transactions.id`                                             |
| `date`         | `date(t.date, 'unixepoch')` — ISO text, not epoch seconds     |
| `merchant`     | `merchants.canonical_name`, falling back to `merchant_raw`    |
| `merchant_raw` | as imported                                                   |
| `amount_cents` | the integer. Aggregate on this, never on `amount`             |
| `amount`       | `amount_cents / 100.0`, for display only                      |
| `type`         | `expense` / `income`                                          |
| `category`     | as in `v_live`                                                |
| `spending_type`| as in `v_live`                                                |
| `tags`         | sorted, comma-separated tag names, like the parquet `Tags`    |
| `source`       | import source                                                 |

Only live rows, same as `v_live`. For `tags`, sort the names in a subquery
before `group_concat`. Don't depend on `ORDER BY` inside the aggregate, which
needs SQLite 3.44.

**The snapshot (working since 2026-09-29).** `tools/snapshot.sh`:

1. `npx wrangler d1 export expenses --remote --output=<tmp>.sql`
2. Loads it into a fresh SQLite file: `sqlite3 <db> < <tmp>.sql`
3. Clears `bank_connections`. The tokens are encrypted and the key never
   leaves Cloudflare, but they have no use locally.
4. Prints the row count of `v_transactions` and the latest date, so a stale or
   empty export is obvious.

The target path comes from `EXPENSES_SNAPSHOT_DB`, defaulting to
`~/.config/expenses_analyzer/snapshot.db`. It is never inside the repo. In
desktop mode (option (a), SQLite in OPFS) the data is not reachable from a
shell, so that mode needs an "Export database" button that downloads the same
file.

Before cutover, check that a snapshot answers the questions currently asked of
the parquet: yearly and monthly totals, category breakdowns, and the savings
rate joined with `payslips`.

## Cloudflare wiring (manual, not scripted)

The steps themselves are in `worker/README.md` under "Deploying".

Done 2026-09-29:
- D1 `expenses` created, id in `worker/wrangler.toml`. Migrations `0000` and
  `0001` applied to it (schema and views, no data).
- Access: team `pallotron.cloudflareaccess.com`, a self-hosted application for
  `expenses.angelofailla.com` with an Allow policy for the two household emails.
  Both values are in `wrangler.toml`.
- Deployed to `expenses.angelofailla.com` (custom domain; `workers.dev` and
  preview URLs off). Anonymous and forged-header requests are redirected to the
  Access login before reaching the Worker. A logged-in user with no `users` row
  gets a 403 from `getUser`, confirmed in `wrangler tail`.
- Seeded from the parquet with two users, owner keys `self` and `katia`, whose
  emails match the Access policy. The
  cross-check passed on the seed database before upload. `bank_connections`
  was emptied first, so no TrueLayer tokens are on Cloudflare; the banks get
  re-linked when bank sync is ported. D1 matches the seed on 13 counts and
  totals.

Login: Google (an OAuth client in its own Google Cloud project, consent
screen External in Testing mode, household Gmail addresses as test users)
under Integrations → Identity providers, with the one-time PIN kept as a
fallback. The Access application's session duration is longer than the
24-hour default, so a login lasts across days.

Still to do:
- The parquet is still the TUI's live data, so D1 is a copy as of
  2026-09-29. Anything imported in the TUI from now on is not in D1. Decide
  when to stop writing through the TUI, or re-seed (wipe the tables and repeat
  the seed) before cutover.
- Secrets: `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET`, `GEMINI_API_KEY`,
  `TOKEN_ENCRYPTION_KEY`, when bank sync and categorisation are ported.

Done 2026-09-30:
- **Tracked migrations.** `migrations_dir = "drizzle"` on the D1 binding.
  Remote `d1_migrations` was backfilled with `0000` and `0001`, after checking
  the remote schema had their 13 tables and 4 views. `wrangler d1 migrations
  apply` now applies drizzle-kit's files, verified on a fresh local D1.
- **Deploy pipeline**, like `~/code/audax_tracker`'s plus a schema step. On a
  merge to main touching `worker/` or `frontend/`: build and test the frontend,
  typecheck, test and run the drift check on the Worker, then
  log the D1 Time Travel restore point, apply migrations, deploy, and confirm
  the hostname still redirects to Access. Migrations go before the code, so
  each must keep the previous Worker working. Time Travel (7 days on the free
  plan) is the rollback, so no snapshots are taken.

  CI never needs real data. Worker tests build in-memory SQLite from the
  migrations, the Python cross-check runs on `make_fixture.py` output, and
  `CROSSCHECK_DB` checks stay local and opt-in, since the repo is public.

## Known issue carried over

The soft-delete collision is fixed on both sides. The Python now counts deleted
rows instead of collecting them in a set (`_drop_reimported_deletions`), and
the port does the same, held to it by the import vectors. What the Python
still gets wrong is deleting and restoring by (date, merchant, amount), which
touches every identical twin; the port acts on ids.
