# Local development helpers. Run from worker/. `make` lists the targets.

# Where the local D1 lives; empty means wrangler's default (.wrangler/state).
PERSIST ?=
SNAPSHOT ?= $(HOME)/.config/expenses_analyzer/snapshot.db
WRANGLER_STATE = $(if $(PERSIST),--persist-to "$(PERSIST)",)
# The seeded user must be the DEV_USER_EMAIL in .dev.vars.
EMAIL ?= $(shell sed -n 's/^DEV_USER_EMAIL=//p' .dev.vars 2>/dev/null)

.PHONY: help dev test migrate-local reset-local seed-demo seed-snapshot

# List the targets.
help:
	@echo "dev            build the frontend if needed, then run the Worker on :8787"
	@echo "test           typecheck and run the Worker tests"
	@echo "migrate-local  apply pending migrations to the local D1"
	@echo "reset-local    empty the local D1 and re-apply the schema"
	@echo "seed-demo      reset-local, then load the made-up demo household (you@example.com)"
	@echo "seed-snapshot  reset-local, then load tools/snapshot.sh's copy of production (EMAIL=)"
	@echo "(dev, migrate-local, reset-local and the seed targets take PERSIST=<dir>)"

# Run the Worker locally, building the frontend first if it has never been built.
dev:
	@[ -f ../frontend/dist/index.html ] || (cd ../frontend && npm run build)
	npm run dev -- $(WRANGLER_STATE)

# Typecheck, then run the test suite.
test:
	npm run typecheck && npm test

# Apply pending migrations to the local D1.
migrate-local:
	npx wrangler d1 migrations apply expenses --local $(WRANGLER_STATE)

# Discards the local D1 (only <state>/v3/d1, never the directory itself), including any real data loaded into it.
reset-local:
	@case "$(PERSIST)" in \
	  /|/.|./|.|..|../|"~"|"~/"|"$(HOME)"|"$(HOME)/") \
	    echo "refusing to reset: PERSIST=$(PERSIST) is not a wrangler state directory"; exit 1;; \
	esac
	rm -rf "$(or $(PERSIST),.wrangler/state)/v3/d1"
	$(MAKE) migrate-local

# Reset the local D1 and load the made-up demo household.
seed-demo: reset-local
	@set -eu; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	npx tsx scripts/demo-data.ts "$$tmp/demo.db"; \
	../tools/dump_for_d1.sh "$$tmp/demo.db" > "$$tmp/data.sql"; \
	npx wrangler d1 execute expenses --local $(WRANGLER_STATE) --file="$$tmp/data.sql"; \
	if [ ! -e .dev.vars ]; then echo 'DEV_USER_EMAIL=you@example.com' > .dev.vars; \
	elif ! grep -qx 'DEV_USER_EMAIL=you@example.com' .dev.vars; then \
	  echo "note: the demo user is you@example.com; run 'npx wrangler dev $(if $(PERSIST),--persist-to \"$(PERSIST)\" ,)--var DEV_USER_EMAIL:you@example.com' or edit .dev.vars"; fi

# Reset the local D1 and load a tools/snapshot.sh copy of production, signed in as you.
seed-snapshot:
	@[ -n "$(EMAIL)" ] || { echo "EMAIL is empty: set DEV_USER_EMAIL in .dev.vars or pass EMAIL="; exit 1; }
	@[ -f "$(SNAPSHOT)" ] || { echo "no snapshot at $(SNAPSHOT): run tools/snapshot.sh first"; exit 1; }
	$(MAKE) reset-local
	@set -eu; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	cp "$(SNAPSHOT)" "$$tmp/s.db"; \
	sqlite3 "$$tmp/s.db" "UPDATE users SET email = '$(EMAIL)' WHERE owner_key = 'self';"; \
	../tools/dump_for_d1.sh "$$tmp/s.db" > "$$tmp/data.sql"; \
	npx wrangler d1 execute expenses --local $(WRANGLER_STATE) --file="$$tmp/data.sql"
