#!/bin/sh
# Copy the remote D1 database into a local SQLite file for ad-hoc analysis.
#
# This replaces reading transactions.parquet with pandas. Query v_transactions
# for the parquet's shape, or v_live / v_summary for what the Summary totals.
#
# Usage:
#     tools/snapshot.sh [path/to/snapshot.db]
#
# The target is the argument, else $EXPENSES_SNAPSHOT_DB, else
# ~/.config/expenses_analyzer/snapshot.db. Keep it out of the repo.
#
# Needs a logged-in wrangler (`npx wrangler login`) and the D1 id set in
# worker/wrangler.toml.

set -eu

DATABASE=expenses
TARGET=${1:-${EXPENSES_SNAPSHOT_DB:-$HOME/.config/expenses_analyzer/snapshot.db}}

ROOT=$(cd "$(dirname "$0")/.." && pwd)

case "$(cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/" in
    "$ROOT"/*)
        echo "refusing to write $TARGET: the snapshot holds real financial data and must live outside the repo" >&2
        exit 1
        ;;
esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "exporting D1 database '$DATABASE'..."
(cd "$ROOT/worker" && npx wrangler d1 export "$DATABASE" --remote --output="$WORK/dump.sql")

# Build beside the target and move into place, so a failed load never leaves a
# half-written snapshot where the old one was.
mkdir -p "$(dirname "$TARGET")"
STAGING="$TARGET.partial"
rm -f "$STAGING"
sqlite3 "$STAGING" < "$WORK/dump.sql"

# The tokens are encrypted with a key that never leaves Cloudflare, so they are
# useless here. Drop them rather than carry them around.
sqlite3 "$STAGING" "DELETE FROM bank_connections; VACUUM;"

chmod 600 "$STAGING"
mv "$STAGING" "$TARGET"

sqlite3 -separator ' ' "$TARGET" \
    "SELECT 'snapshot: ' || COUNT(*) || ' live transactions, latest ' || COALESCE(MAX(date), 'none')
     FROM v_transactions;"
echo "written to $TARGET"
