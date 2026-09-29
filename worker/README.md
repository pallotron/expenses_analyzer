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

# 2. Apply the schema to the local D1, every migration in order.
cd worker && for f in drizzle/*.sql; do
    npx wrangler d1 execute expenses --local --file="$f"
done

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

Needs a Cloudflare account, and these are not yet done:

```sh
npx wrangler d1 create expenses     # put the returned id in wrangler.toml
sqlite3 expenses.db .dump | npx wrangler d1 execute expenses --remote --file=-
npx wrangler secret put TRUELAYER_CLIENT_ID
npx wrangler secret put TRUELAYER_CLIENT_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in `wrangler.toml` come from the
Cloudflare Access application that fronts this Worker. They are not secrets, but
the Worker must verify the Access JWT against them rather than trusting the
`Cf-Access-Authenticated-User-Email` header.
