# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Privacy Conventions

- **Never** write the maintainer's employer/company name into any code, configuration,
  default value, committed doc, or test fixture.
- **Never** hardcode personal absolute paths (e.g. a specific payslip folder). Locations
  like this must be user-configured at runtime (file picker + persisted setting) with an
  optional env-var override; do not bake a default that reveals a real path.
- Test fixtures must be synthetic — never commit real personal financial documents.
- Before committing, grep the repo for the company name and personal paths to confirm they
  are absent.

## Project Overview

Expense Analyzer is a self-hosted household expenses app. It runs as one
Cloudflare Worker that serves both the API and the built React frontend, stores
everything in D1 (SQLite), and sits behind Cloudflare Access for login. All
code is TypeScript. Bank exports and payslip PDFs are parsed in the browser;
the Worker receives rows and figures, never files.

- `worker/`: the Worker (Hono, Drizzle, D1). `worker/README.md` covers local
  development, tests and deploying.
- `frontend/`: the React app (Vite, React Router, React Query, Tailwind v4).
- `tools/`: `snapshot.sh` (production to a local SQLite file),
  `dump_for_d1.sh` (SQLite to INSERTs D1 accepts), `screenshots.py` (retakes
  `screenshots/`).
- `docs/`: user guides for importing and payslips.
- `examples/`: synthetic CSV exports for trying the import.

## Commands

From the repo root:

```bash
make test         # worker typecheck + tests, frontend tests, frontend build
make dev          # build the frontend if needed, serve on http://localhost:8787
make seed-demo    # wipe the local D1, load the made-up demo household
```

From `worker/` (`make` lists the targets):

```bash
make seed-snapshot   # wipe the local D1, load tools/snapshot.sh's copy of production
make migrate-local   # apply pending migrations to the local D1
make reset-local     # empty the local D1 and re-apply the schema
npx drizzle-kit generate   # after editing src/db/schema.ts (also `npm run db:generate`)
```

`dev`, `migrate-local`, `reset-local` and the seed targets take
`PERSIST=<dir>` to use a separate local D1 directory. `seed-snapshot` reads
`SNAPSHOT=<file>` (default `~/.config/expenses_analyzer/snapshot.db`) and signs
the snapshot's `self` user in as `EMAIL` (default: `DEV_USER_EMAIL` in
`worker/.dev.vars`). The demo user is `you@example.com`.

From `frontend/`:

```bash
npm test          # vitest
npm run build     # tsc + vite build into frontend/dist
npm run dev       # Vite with hot reload; proxies /api to the Worker on :8787
```

Locally there is no Access. `DEV_USER_EMAIL` in `worker/.dev.vars` (gitignored)
names the user to act as, and is honoured only for requests to `localhost`.

## Architecture

### Worker (`worker/src/`)

- `index.ts` → `app.ts`: the Hono app. Every route is authenticated; there are
  no public routes, static assets included.
- `auth.ts`: the only place identity is decided. Verifies the Cloudflare Access
  JWT (`Cf-Access-Jwt-Assertion`) against the team's keys, issuer, audience and
  expiry, then maps the email claim to a row in `users`. Never read identity
  headers such as `Cf-Access-Authenticated-User-Email`.
- `routes/` → `services/` → Drizzle over D1. Routes parse and validate the
  request; services hold the logic and the writes. `domain/` is pure logic
  (merchant names, import rows, tags, payslips, pension savings). `api/` holds
  request and response types shared with the frontend.
- `queries/`: the Summary and Transactions reads. Each has a reference SQL file
  in `queries/sql/`; the tests under `__tests__/queries/` prove the two equal.
- `db/schema.ts`: the single source of truth for the schema. Money is integer
  cents everywhere. Writes go through `db/atomic.ts`, so an import, edit or
  delete lands whole or not at all. Deletes are soft (`deleted_at`).
- Views in `schema.ts`:
  - `v_live`: live (not deleted) transactions with merchant, category,
    spending type, `year` and `month`.
  - `v_summary`: `v_live` minus transactions carrying a hidden tag. What the
    Summary totals.
  - `v_transactions`: one row per live transaction with date, merchant,
    category, tags and amount. For ad-hoc analysis of a snapshot.
- Migrations: `drizzle-kit generate` writes SQL from `schema.ts` into
  `worker/drizzle/`; wrangler applies those files to D1 and records them in
  `d1_migrations`. CI fails if `schema.ts` changes without a matching migration.
- `__tests__/fixtures/python_vectors.json` holds the removed Python app's
  answers, frozen. Tests replay them. Never edit it by hand.
- Gemini (`services/gemini.ts`) is the only outbound call. It needs the
  `GEMINI_API_KEY` secret; `GEMINI_MODEL` in `wrangler.toml` picks the model.

### Frontend (`frontend/src/`)

- `App.tsx`: React Router pages, one folder each: `summary/`, `transactions/`,
  `merchants/`, `import/`, `payslips/`, `accounts/`, `budgets/`. Page state
  (filters, period, tab) lives in the URL.
- `lib/queryClient.ts`: React Query with `staleTime: Infinity` and no refetch
  on focus. Each view is fetched once per visit. Every mutation must call
  `invalidateData` on success, which marks every view stale; that is what makes
  fetching once safe. A change from another device shows after a reload.
- `lib/usePrinting.ts`: true while the browser prints, so pages render what
  tabs and phone layouts hide. PDF export is the browser's print; there is no
  PDF library.
- `import/`: CSV via PapaParse and XLS/XLSX via SheetJS, parsed in the browser.
- `payslips/`: PDFs read with pdf.js in the browser; `parser.ts` handles the
  Irish PAYE layout.
- Styling: Tailwind v4 utility classes, with `dark:` variants.

## Data analysis

The parquet and pandas are gone. To analyse real data, take a snapshot of
production and query it with `sqlite3`:

```bash
tools/snapshot.sh   # writes ~/.config/expenses_analyzer/snapshot.db; refuses paths inside the repo
sqlite3 ~/.config/expenses_analyzer/snapshot.db "SELECT ... FROM v_transactions ..."
```

- Start from `v_transactions`; use `v_summary` to match the Summary's totals.
- `year` and `month` in `v_summary` and `v_live` are TEXT: `'2026'` and
  `'2026-01'`. `WHERE year = 2026` silently matches nothing; quote the value.
- Sum `amount_cents`, not `amount`. `type` is `expense` or `income`; amounts
  are positive.
- The snapshot holds real financial data. Never copy it, or anything from it,
  into the repo.

## Deploy

Merging to main runs `.github/workflows/deploy.yml` when `worker/` or
`frontend/` changed. It re-runs the checks, logs a D1 Time Travel restore point,
applies pending migrations, deploys, and checks the hostname still redirects to
the Access login.

Migrations run **before** the new code is live, so each migration must keep the
previous Worker working: add tables and columns in one deploy, drop them in a
later one.

## Version Control

**This repository uses Jujutsu (jj), not git.** Use jj commands for all version control operations:

- `jj status` - Check working copy status
- `jj diff` - View changes
- `jj describe -m "message"` - Set commit message for current change
- `jj new` - Create a new change
- `jj squash` - Squash current change into parent
- `jj log` - View commit history
- `jj git push` - Push to git remote
- `jj op undo` - Undo last operation

The working copy (`@`) is always a commit in jj. There's no staging area - changes are automatically part of the working copy commit.

**Important Workflow:**
- **Always run `jj new` before starting a new feature or fix** - This creates a new change on top of the current one, keeping commits organized and avoiding mixing unrelated changes in the working copy.


## D1 free-plan read limits

The free plan allows 5M rows read per day. Once spent, every query fails until
midnight UTC (`readLimit.ts` turns that into a clear error). A Summary costs
about 130k rows read, so reads are kept down by fetching each view once per
visit (see `queryClient.ts` above).

- Avoid queries that scan `v_live` (or the views built on it) repeatedly, such
  as one query per month or per category in a loop. Aggregate in one query.
- Do not add refetch intervals or refetch-on-focus.
- Check per-query reads with `npx wrangler d1 insights expenses` (from
  `worker/`) after changing a query.

## Code style

- TypeScript, strict. `make test` typechecks the Worker and its tests.
- Plain, short comments that say why, not what.
- In `worker/`, never `npm install <pkg>`: it drops other platforms' rolldown
  bindings from the lockfile and breaks Vitest in CI. Edit `package.json`, then
  regenerate the lockfile (see `worker/README.md`).
