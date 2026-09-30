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
    much for a Worker.
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

Summary first — it is the biggest screen (1,694 lines) and the one whose numbers
the cross-check already guarantees. Then Transactions (971), Import (406),
Categorize (292), Payslips (229), Link Banks (674).

- ~~Summary, core views.~~ Done: one Worker serves the app and the API
  (`[assets]`, `run_worker_first`), `GET /api/summary` and `/periods`, and the
  dashboard with tiles, spending split, monthly chart, breakdowns and the
  monthly grid. The grid's anomaly flags and the merchant lists are held to
  the Python by the `summary` section of `python_vectors.json`. Still to come
  for Summary: the pension-aware savings rate, drill-down (with
  Transactions), editing the exclusion patterns, the payslip-only month note.

Payslips are parsed **client-side** with pdf.js and only the parsed numbers are
POSTed. A Worker has no filesystem, so the folder scanner cannot survive — and
keeping the PDF off Cloudflare keeps the employer name off third-party
infrastructure. There is deliberately no `payslip_folders` table.

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

Still to do:
- Add Google login to Access. Login is currently one-time PIN (plus the
  Cloudflare-account option). Needs a Google Cloud OAuth client ("Web
  application"; origin `https://pallotron.cloudflareaccess.com`, redirect
  `https://pallotron.cloudflareaccess.com/cdn-cgi/access/callback`; consent
  screen External, both Gmail addresses as test users), then add **Google**
  (not Google Workspace) under Integrations → Identity providers.
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
