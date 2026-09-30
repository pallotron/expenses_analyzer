# Local development helpers. Run from worker/. `make` lists the targets.

NAME ?= Me
# The seeded user must be the DEV_USER_EMAIL in .dev.vars.
EMAIL ?= $(shell sed -n 's/^DEV_USER_EMAIL=//p' .dev.vars 2>/dev/null)

.PHONY: help dev test migrate-local reset-local seed-fixture seed-real

# List the targets.
help:
	@echo "dev            build the frontend if needed, then run the Worker on :8787"
	@echo "test           typecheck and run the Worker tests"
	@echo "migrate-local  apply pending migrations to the local D1"
	@echo "reset-local    empty the local D1 and re-apply the schema"
	@echo "seed-fixture   reset-local, then load the synthetic fixture"
	@echo "seed-real      reset-local, then load your real parquet data (EMAIL=, NAME=)"

# Run the Worker locally, building the frontend first if it has never been built.
dev:
	@[ -f ../frontend/dist/index.html ] || (cd ../frontend && npm run build)
	npm run dev

# Typecheck, then run the test suite.
test:
	npm run typecheck && npm test

# Apply pending migrations to the local D1.
migrate-local:
	npx wrangler d1 migrations apply expenses --local

# Discards the local D1, including any real data loaded into it.
reset-local:
	rm -rf .wrangler/state
	$(MAKE) migrate-local

# Load the synthetic cross-check fixture into a fresh local D1, and create
# .dev.vars naming its user if there is none.
seed-fixture: reset-local
	@set -eu; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	../.venv/bin/python ../tools/crosscheck/make_fixture.py "$$tmp"; \
	EXPENSES_ANALYZER_CONFIG_DIR="$$tmp" PYTHONPATH=.. ../.venv/bin/python ../tools/migrate_to_sqlite.py \
	  --out "$$tmp/dev.db" --tokens-plaintext --user you@example.com:You:self; \
	../tools/dump_for_d1.sh "$$tmp/dev.db" > "$$tmp/data.sql"; \
	npx wrangler d1 execute expenses --local --file="$$tmp/data.sql"; \
	if [ -e .dev.vars ]; then \
	  echo "note: .dev.vars exists; DEV_USER_EMAIL must be you@example.com to see the fixture"; \
	else echo 'DEV_USER_EMAIL=you@example.com' > .dev.vars; fi

# Load your real data (default config dir) into a fresh local D1. It is read
# from the parquet files and written only to .wrangler/state: it never leaves
# this machine. Bank tokens are dropped, as they are useless locally.
seed-real:
	@[ -n "$(EMAIL)" ] || { echo "EMAIL is empty: set DEV_USER_EMAIL in .dev.vars or pass EMAIL=you@example.com"; exit 1; }
	$(MAKE) reset-local
	@set -eu; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	PYTHONPATH=.. ../.venv/bin/python ../tools/migrate_to_sqlite.py \
	  --out "$$tmp/real.db" --tokens-plaintext --user "$(EMAIL)":"$(NAME)":self; \
	sqlite3 "$$tmp/real.db" "DELETE FROM bank_connections;"; \
	../tools/dump_for_d1.sh "$$tmp/real.db" > "$$tmp/data.sql"; \
	npx wrangler d1 execute expenses --local --file="$$tmp/data.sql"
