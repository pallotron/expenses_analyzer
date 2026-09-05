#!/bin/sh
# Dump a migrated SQLite database as INSERT statements D1 will accept.
#
# Two things make a plain `sqlite3 .dump` unusable here:
#   - it emits tables in CREATE order, which is not foreign-key order, so the
#     load fails on the first row pointing at a table that has no rows yet;
#   - it includes sqlite_sequence, which D1 rejects.
#
# Tables are listed parents-first below. Schema is not included: apply
# worker/drizzle/*.sql first, so the database matches worker/src/db/schema.ts.
#
# Usage: tools/dump_for_d1.sh expenses.db > data.sql
set -eu

DB="${1:?usage: dump_for_d1.sh <path-to-sqlite-db>}"

TABLES="
users
categories
spending_type_budgets
merchants
merchant_aliases
tags
tag_exclusion_patterns
import_batches
transactions
transaction_tags
payslips
bank_connections
settings
"

for table in $TABLES; do
  printf '%s\n' "-- $table"
  sqlite3 "$DB" ".mode insert $table" "SELECT * FROM $table;"
done
