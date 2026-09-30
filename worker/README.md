# Worker

Cloudflare Worker serving the API, backed by D1.

`src/db/schema.ts` is the single source of truth for the schema. `drizzle-kit`
generates SQL from it into `drizzle/`, and both D1 and the local migration tool
apply those files — so a seeded database cannot drift from the code. CI fails if
`schema.ts` changes without a matching generated migration.

## Running locally

No Cloudflare account needed. `wrangler dev` uses a local SQLite under
`.wrangler/state/`, and the placeholder `database_id` in `wrangler.toml` is fine
for local use.

```sh
npm install

# 1. Build a database from the current parquet data (from the repo root).
cd .. && PYTHONPATH=. .venv/bin/python tools/migrate_to_sqlite.py \
    --out expenses.db \
    --user you@example.com:"Your Name":self

# 2. Apply the schema to the local D1. wrangler records what it applied in
#    d1_migrations, so rerunning this only applies new migrations.
cd worker && npx wrangler d1 migrations apply expenses --local

# 3. Load the data.
#    Use the script rather than `sqlite3 .dump`: that emits tables in CREATE
#    order rather than foreign-key order, so the load fails partway through.
../tools/dump_for_d1.sh ../expenses.db > /tmp/d1_data.sql
npx wrangler d1 execute expenses --local --file=/tmp/d1_data.sql

# 4. Run it.
npx wrangler dev
```

Every route needs a user. There is no Access locally, so name one of the
`users` emails in `worker/.dev.vars` (gitignored):

```sh
echo 'DEV_USER_EMAIL=you@example.com' > .dev.vars
```

It is honoured only for requests to `localhost`, so it cannot open up a
deployment. Then `curl http://localhost:8787/api/me` shows who you are acting
as, and `curl http://localhost:8787/health` reports the live transaction count.
Without it every request gets a 500, because Access is not configured.

## Tests

```sh
npm run typecheck   # the Worker, and the tests under Node
npm test
```

`src/__tests__/queries/` proves each query module equal to its SQL file in
`../tools/crosscheck/queries/`. To run that comparison on real data too, point
it at a database built by `tools/migrate_to_sqlite.py`:

```sh
CROSSCHECK_DB=../expenses.db npm test
```

That also checks the import port on real data. It gets an in-memory copy, so
the file is never written.

`src/__tests__/fixtures/python_vectors.json` is the Python's own answers, for
merchant names, amounts, tags and whole import scenarios, which the domain and
service tests replay. Never edit it by hand. After changing the Python or the
scenarios in `tools/crosscheck/vectors.py`, regenerate it from the repo root:

```sh
PYTHONPATH=. .venv/bin/python tools/crosscheck/vectors.py
```

**Adding a dependency:** `npm install <pkg>` on an existing tree drops every
other platform's rolldown binding from the lockfile (npm's optional-dependency
bug), which breaks Vitest here and in CI. Add the package to `package.json`,
then `rm -rf node_modules package-lock.json && npm install`, and check that
`git diff package-lock.json` only adds what you meant to.

Query the local database directly at any time:

```sh
npx wrangler d1 execute expenses --local --command "SELECT COUNT(*) FROM transactions"
```

To start over, delete `.wrangler/state/v3/d1` and repeat from step 2.

## Deploying

Served at `expenses.angelofailla.com` behind Cloudflare Access. `workers.dev`
and preview URLs are off, so the custom domain is the only way in.

**Access** (Cloudflare One dashboard, Zero Trust Free):
- Team domain: `pallotron.cloudflareaccess.com`, which is `CF_ACCESS_TEAM_DOMAIN`.
- Self-hosted application "expenses" for `expenses.angelofailla.com`, with
  one Allow policy listing the household emails. Its **Application Audience
  (AUD) Tag**, under the application's **Additional settings** tab, is
  `CF_ACCESS_AUD`. Not the policy ID: that is a dashed UUID, the AUD is 64 hex
  characters.
- A new user needs adding in both places: the policy, and the `users` table.

**D1:** `npx wrangler d1 create expenses`, with the id in `wrangler.toml`.
Keep `binding = "DB"`: the code reads `env.DB`. `migrations_dir = "drizzle"`
makes wrangler apply drizzle-kit's files and record each in `d1_migrations`.
For a new database, apply the schema, then load data:

```sh
npx wrangler d1 migrations apply expenses --remote
../tools/dump_for_d1.sh ../expenses.db > /tmp/d1_data.sql
npx wrangler d1 execute expenses --remote --file=/tmp/d1_data.sql
```

Not `sqlite3 .dump`, which emits tables in CREATE order and includes
`sqlite_sequence`; D1 rejects both.

**Deploy:** automatic. `.github/workflows/deploy.yml` runs on every merge to
main that touches `worker/`. It re-runs the checks, logs a D1 Time Travel
restore point, applies pending migrations, deploys, and confirms the hostname
still redirects to the Access login. Rerun it from the Actions tab
(`workflow_dispatch`); `npx wrangler deploy` by hand still works.

It needs two repository secrets:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`, a user API token with **Workers Scripts: Edit**,
  **D1: Edit** and **Workers Routes: Edit** on `angelofailla.com`. The "Edit
  Cloudflare Workers" template, plus D1, covers it.

**Migrations run before the new code deploys**, so a migration must leave the
previous Worker working: add tables and columns, and drop them in a later
deploy. To undo a bad one, run the `wrangler d1 time-travel restore` command
the deploy logged. That also discards any writes made since, so do it quickly.

Then `https://expenses.angelofailla.com/api/me` should log you in and return
your user.

**Secrets**, needed once bank sync and categorisation are ported:

```sh
npx wrangler secret put TRUELAYER_CLIENT_ID
npx wrangler secret put TRUELAYER_CLIENT_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```
