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
   (`.prepare()`, `.batch()`) in query code. The stub `/health` in
   `worker/src/index.ts` currently violates this and must not set a precedent —
   fix it when the first real route lands.

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

## Blocked: the sync decision

**This is due before the service layer is built**, because option (b) needs
change-tracking columns in the schema and those are far cheaper to add now than
to retrofit.

- **(a) One mode per install** — desktop *or* cloud, no sync. Nearly free.
- **(b) Desktop as an offline client of the cloud** — change tracking, conflict
  resolution, and a merge story for two people editing one transaction. A
  project comparable in size to the rest of the port.

"Use it offline on my laptop, same data my wife sees" is (b). "Desktop for me,
website for both of us" is (a).

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

- `analysis.py` (368) → query modules. Covered by the cross-check.
- `data_handler.py` (954) → most of this is parquet I/O that simply disappears.
  What survives is alias resolution, category resolution and dedup. Note
  `merchant_aliases.priority` exists because the Python walks the alias dict and
  takes the *first* regex match — insertion order was load-bearing.
- `transaction_filter.py`, `tags.py`, `validation.py`, `merchant_editor.py`.
- `getUser(request)` + Cloudflare Access JWT verification with `jose`.

### 2. Frontend screens (`frontend/`)

Summary first — it is the biggest screen (1,694 lines) and the one whose numbers
the cross-check already guarantees. Then Transactions (971), Import (406),
Categorize (292), Payslips (229), Link Banks (674).

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

## Cloudflare wiring (manual, not scripted)

Needed before anything can deploy:

- `wrangler d1 create expenses`, put the id in `worker/wrangler.toml`
  (currently a placeholder).
- Seed remote D1 via `tools/dump_for_d1.sh`.
- Secrets: `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET`, `GEMINI_API_KEY`,
  `TOKEN_ENCRYPTION_KEY`.
- Create the Access application (two users), then set `CF_ACCESS_TEAM_DOMAIN`
  and `CF_ACCESS_AUD`.
- `deploy.yml` — deferred until there is something deployable.

## Known issue carried over

`append_transactions` builds `deleted_keys` as a **set**, so soft-deleting one
of two identical same-day transactions suppresses both on re-import. The port
removes this structurally (real primary key + partial unique index on
`(date, merchant_id, amount_cents, occurrence)` over live rows only, verified
against 64 same-day repeats in real data). Fix it in Python only if the TUI
stays in use long enough to matter.
