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

# 2. Apply the schema to the local D1.
cd worker && npx wrangler d1 execute expenses --local --file=drizzle/0000_*.sql

# 3. Load the data.
#    Use the script rather than `sqlite3 .dump`: that emits tables in CREATE
#    order rather than foreign-key order, so the load fails partway through.
../tools/dump_for_d1.sh ../expenses.db > /tmp/d1_data.sql
npx wrangler d1 execute expenses --local --file=/tmp/d1_data.sql

# 4. Run it.
npx wrangler dev
```

Then `curl http://localhost:8787/health` reports the live transaction count.

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
