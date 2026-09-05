#!/usr/bin/env python3
"""One-shot migration: parquet + JSON config -> SQLite.

Throwaway. Run it once, verify, delete it.

It deliberately imports the live `expenses` package rather than reimplementing
merchant aliasing, tag parsing or name normalisation. Those rules have subtle
edge cases (regex-ordered alias matching, date-stamp stripping, majority-vote
category keys) and the only way to guarantee the migrated data means the same
thing is to run the same code.

Usage:
    PYTHONPATH=. python3 tools/migrate_to_sqlite.py \\
        --out expenses.db \\
        --user you@example.com:"Your Name":self \\
        --user them@example.com:"Their Name":partner

Every user is `email:display_name:owner_key`. The owner_key must match the
Owner value already in payslips.parquet ("self" for anything recorded before
multi-owner support landed); `--list-owners` prints what is actually in there.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from expenses import config
from expenses.data_handler import (
    apply_merchant_alias,
    load_categories,
    load_category_types,
    load_default_categories,
    load_merchant_aliases,
    load_tag_settings,
    load_transactions_from_parquet,
)
from expenses.tags import parse_tags

sys.path.insert(0, str(Path(__file__).resolve().parent))
from money import to_cents  # noqa: E402  (needs the path line above)

# The schema is not defined here. worker/src/db/schema.ts is the single source
# of truth, drizzle-kit generates SQL from it into worker/drizzle/, and this
# script applies those files verbatim — so a database it seeds cannot drift
# from the schema the Worker expects.
DDL_DIR = Path(__file__).resolve().parent.parent / "worker" / "drizzle"

PRAGMAS = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
"""


def load_ddl(explicit: Optional[Path]) -> str:
    """Concatenate the generated migration files, in order."""
    if explicit is not None:
        return explicit.read_text()
    files = sorted(DDL_DIR.glob("*.sql"))
    if not files:
        raise SystemExit(
            f"no migration SQL in {DDL_DIR}. Run `npm run db:generate` in worker/ first."
        )
    return "\n".join(path.read_text() for path in files)


# ----------------------------------------------------------------- helpers


def to_epoch_day(value) -> int:
    """Any date-ish value -> unix seconds at UTC midnight."""
    ts = pd.to_datetime(value)
    return int(
        datetime(ts.year, ts.month, ts.day, tzinfo=timezone.utc).timestamp()
    )


def parse_user_arg(raw: str) -> Dict[str, str]:
    parts = raw.split(":")
    if len(parts) != 3 or not all(p.strip() for p in parts):
        raise argparse.ArgumentTypeError(
            f"--user must be email:display_name:owner_key, got {raw!r}"
        )
    return {"email": parts[0].strip(), "name": parts[1].strip(), "owner": parts[2].strip()}


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        with open(path) as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"  ! could not read {path.name}: {exc}; using default", file=sys.stderr)
        return default


# -------------------------------------------------------------- migration


def migrate(conn: sqlite3.Connection, users: List[Dict[str, str]], plaintext_tokens: bool) -> dict:
    cur = conn.cursor()
    stats: dict = {}

    # --- users ------------------------------------------------------------
    user_ids: Dict[str, int] = {}
    for user in users:
        cur.execute(
            "INSERT INTO users (email, display_name, owner_key) VALUES (?, ?, ?)",
            (user["email"], user["name"], user["owner"]),
        )
        user_ids[user["owner"]] = cur.lastrowid
    default_user = user_ids[users[0]["owner"]]
    stats["users"] = len(users)

    # --- categories -------------------------------------------------------
    category_types = load_category_types()
    type_of: Dict[str, str] = {}
    for spending_type in ("essential", "discretionary"):
        entry = category_types.get(spending_type) or {}
        for name in entry.get("categories", []):
            type_of[name] = spending_type
        budget = entry.get("annual_budget")
        cur.execute(
            "INSERT INTO spending_type_budgets (spending_type, annual_budget_cents) VALUES (?, ?)",
            (spending_type, to_cents(budget) if budget is not None else None),
        )

    merchant_categories = load_categories()
    names = set(load_default_categories() or [])
    names.update(merchant_categories.values())
    names.update(type_of)
    names.discard(None)
    names.discard("")
    names.add("Other")  # the fillna default; must exist as a real row

    category_ids: Dict[str, int] = {}
    for name in sorted(names):
        cur.execute(
            "INSERT INTO categories (name, spending_type) VALUES (?, ?)",
            (name, type_of.get(name)),
        )
        category_ids[name] = cur.lastrowid
    stats["categories"] = len(category_ids)

    # --- transactions, merchants, aliases ---------------------------------
    # Deleted rows are kept: their soft-delete state is data, and dropping them
    # would let a previously-deleted row sail back in on the next import.
    df = load_transactions_from_parquet(include_deleted=True)
    aliases = load_merchant_aliases()

    if df.empty:
        stats["transactions"] = 0
        stats["merchants"] = 0
    else:
        df = df.copy()
        df["_canonical"] = df["Merchant"].astype(str).apply(
            lambda m: apply_merchant_alias(m, aliases)
        )
        df["_cents"] = df["Amount"].apply(to_cents)
        df["_epoch"] = df["Date"].apply(to_epoch_day)
        df["_deleted"] = df["Deleted"].fillna(False).astype(bool)

        # Every canonical name becomes a merchant, including ones no alias
        # produced (those come from normalize_merchant_name's date stripping).
        merchant_ids: Dict[str, int] = {}
        for canonical in sorted(df["_canonical"].unique()):
            category = merchant_categories.get(canonical)
            cur.execute(
                "INSERT INTO merchants (canonical_name, category_id) VALUES (?, ?)",
                (canonical, category_ids.get(category) if category else None),
            )
            merchant_ids[canonical] = cur.lastrowid
        stats["merchants_categorised"] = sum(
            1 for m in merchant_ids if merchant_categories.get(m)
        )

        # Alias patterns, numbered so first-match-wins survives the move.
        alias_rows = 0
        for priority, (pattern, alias) in enumerate(aliases.items()):
            if alias not in merchant_ids:
                # An alias nothing currently resolves to. Keep the rule anyway;
                # a future import may need it.
                cur.execute(
                    "INSERT INTO merchants (canonical_name, category_id) VALUES (?, ?)",
                    (
                        alias,
                        category_ids.get(merchant_categories.get(alias))
                        if merchant_categories.get(alias)
                        else None,
                    ),
                )
                merchant_ids[alias] = cur.lastrowid
            cur.execute(
                "INSERT INTO merchant_aliases (pattern, priority, merchant_id, created_by) "
                "VALUES (?, ?, ?, ?)",
                (pattern, priority, merchant_ids[alias], default_user),
            )
            alias_rows += 1
        stats["merchant_aliases"] = alias_rows
        # Counted here, not after the loop above: the alias pass adds a
        # merchant for any alias target that no transaction resolves to.
        stats["merchants"] = len(merchant_ids)

        # Occurrence counter, computed over live rows only. The partial unique
        # index only covers live rows, so deleted ones need no slot of their own
        # — which is exactly the collision the parquet version kept tripping on.
        df["_occurrence"] = 0
        live = ~df["_deleted"]
        df.loc[live, "_occurrence"] = (
            df[live].groupby(["_epoch", "_canonical", "_cents"]).cumcount()
        )

        migrated_at = int(datetime.now(timezone.utc).timestamp())
        tag_ids: Dict[str, int] = {}
        tag_links = 0

        for _, row in df.iterrows():
            cur.execute(
                "INSERT INTO transactions ("
                "  date, merchant_raw, merchant_id, amount_cents, type, source,"
                "  occurrence, deleted_at, created_by, created_at, updated_by, updated_at"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    int(row["_epoch"]),
                    str(row["Merchant"]),
                    merchant_ids[row["_canonical"]],
                    int(row["_cents"]),
                    str(row.get("Type") or "expense"),
                    str(row.get("Source") or "Unknown"),
                    int(row["_occurrence"]),
                    # The original deletion time was never recorded, so stamp
                    # the migration and leave deleted_by null rather than invent
                    # an actor.
                    migrated_at if row["_deleted"] else None,
                    default_user,
                    migrated_at,
                    default_user,
                    migrated_at,
                ),
            )
            transaction_id = cur.lastrowid

            for tag in parse_tags(row.get("Tags")):
                if tag not in tag_ids:
                    cur.execute("INSERT INTO tags (name) VALUES (?)", (tag,))
                    tag_ids[tag] = cur.lastrowid
                cur.execute(
                    "INSERT INTO transaction_tags (transaction_id, tag_id, tagged_by, tagged_at) "
                    "VALUES (?, ?, ?, ?)",
                    (transaction_id, tag_ids[tag], default_user, migrated_at),
                )
                tag_links += 1

        stats["transactions"] = len(df)
        stats["transactions_deleted"] = int(df["_deleted"].sum())
        stats["tags"] = len(tag_ids)
        stats["tag_links"] = tag_links

    # --- tag exclusion patterns -------------------------------------------
    patterns = load_tag_settings().get("exclude_from_summary", [])
    for pattern in patterns:
        cur.execute(
            "INSERT OR IGNORE INTO tag_exclusion_patterns (pattern) VALUES (?)",
            (pattern,),
        )
    stats["tag_exclusion_patterns"] = len(patterns)

    # --- payslips ----------------------------------------------------------
    payslip_rows = 0
    unmatched_owners: Counter = Counter()
    if config.PAYSLIPS_FILE.exists():
        payslips = pd.read_parquet(config.PAYSLIPS_FILE)
        for _, row in payslips.iterrows():
            owner = str(row.get("Owner") or "self")
            if owner not in user_ids:
                unmatched_owners[owner] += 1
                continue
            source_files = row.get("SourceFiles")
            if isinstance(source_files, str):
                source_files = [source_files] if source_files else []
            elif source_files is None or (
                not isinstance(source_files, (list, tuple)) and pd.isna(source_files)
            ):
                source_files = []
            cur.execute(
                "INSERT INTO payslips ("
                "  user_id, month, gross_cents, net_cents, tax_total_cents,"
                "  pension_ee_cents, avc_cents, pension_er_cents, bonus_cents,"
                "  on_call_cents, source_files, ytd_reconciled, net_reconciled"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_ids[owner],
                    str(row["Month"]),
                    to_cents(row.get("Gross")),
                    to_cents(row.get("Net")),
                    to_cents(row.get("TaxTotal")),
                    to_cents(row.get("PensionEE")),
                    to_cents(row.get("AVC")),
                    to_cents(row.get("PensionER")),
                    to_cents(row.get("Bonus")),
                    to_cents(row.get("OnCall")),
                    json.dumps(list(source_files)),
                    None if pd.isna(row.get("YTDReconciled")) else int(bool(row.get("YTDReconciled"))),
                    None if pd.isna(row.get("NetReconciled")) else int(bool(row.get("NetReconciled"))),
                ),
            )
            payslip_rows += 1
    stats["payslips"] = payslip_rows
    stats["payslips_skipped_unknown_owner"] = dict(unmatched_owners)

    # --- bank connections ---------------------------------------------------
    connections = read_json(config.CONFIG_DIR / "truelayer_connections.json", [])
    for connection in connections:
        last_sync = connection.get("last_sync")
        if last_sync:
            try:
                last_sync = int(datetime.fromisoformat(last_sync).timestamp())
            except ValueError:
                last_sync = None
        cur.execute(
            "INSERT OR IGNORE INTO bank_connections ("
            "  connection_id, provider, provider_name, access_token_enc,"
            "  refresh_token_enc, linked_by, last_sync"
            ") VALUES (?, 'truelayer', ?, ?, ?, ?, ?)",
            (
                connection.get("connection_id"),
                connection.get("provider_name", "Unknown"),
                connection.get("access_token", ""),
                connection.get("refresh_token", ""),
                default_user,
                last_sync,
            ),
        )
    stats["bank_connections"] = len(connections)
    stats["tokens_plaintext"] = plaintext_tokens

    conn.commit()
    return stats


# ------------------------------------------------------------ verification


def verify(conn: sqlite3.Connection) -> List[str]:
    """Re-derive the headline numbers from SQLite and compare to parquet.

    A migration that loses money silently is worse than one that fails loudly.
    """
    problems: List[str] = []
    cur = conn.cursor()

    df = load_transactions_from_parquet(include_deleted=True)
    if df.empty:
        return problems

    expected_rows = len(df)
    (actual_rows,) = cur.execute("SELECT COUNT(*) FROM transactions").fetchone()
    if expected_rows != actual_rows:
        problems.append(f"row count: parquet {expected_rows} vs sqlite {actual_rows}")

    expected_cents = sum(to_cents(a) for a in df["Amount"])
    (actual_cents,) = cur.execute("SELECT COALESCE(SUM(amount_cents), 0) FROM transactions").fetchone()
    if expected_cents != actual_cents:
        problems.append(
            f"amount total: parquet {expected_cents / 100:.2f} vs sqlite {actual_cents / 100:.2f}"
        )

    live = df[~df["Deleted"].fillna(False).astype(bool)]
    (actual_live,) = cur.execute(
        "SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL"
    ).fetchone()
    if len(live) != actual_live:
        problems.append(f"live rows: parquet {len(live)} vs sqlite {actual_live}")

    # Category resolution must agree row for row, including the "Other" default.
    aliases = load_merchant_aliases()
    categories = load_categories()
    expected = Counter(
        categories.get(apply_merchant_alias(str(m), aliases), "Other") for m in live["Merchant"]
    )
    actual = Counter(
        dict(
            cur.execute(
                "SELECT COALESCE(c.name, 'Other'), COUNT(*)"
                "  FROM transactions t"
                "  JOIN merchants m ON m.id = t.merchant_id"
                "  LEFT JOIN categories c ON c.id = COALESCE(t.category_override_id, m.category_id)"
                " WHERE t.deleted_at IS NULL"
                " GROUP BY 1"
            ).fetchall()
        )
    )
    if expected != actual:
        for name in sorted(set(expected) | set(actual)):
            if expected[name] != actual[name]:
                problems.append(
                    f"category '{name}': parquet {expected[name]} vs sqlite {actual[name]}"
                )

    # Tag links must round-trip.
    expected_links = sum(len(parse_tags(cell)) for cell in df.get("Tags", []))
    (actual_links,) = cur.execute("SELECT COUNT(*) FROM transaction_tags").fetchone()
    if expected_links != actual_links:
        problems.append(f"tag links: parquet {expected_links} vs sqlite {actual_links}")

    return problems


# -------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--out", type=Path, help="SQLite file to create (must not exist)")
    parser.add_argument(
        "--user",
        type=parse_user_arg,
        action="append",
        default=[],
        metavar="EMAIL:NAME:OWNER_KEY",
        help="repeatable; first one becomes the default actor for migrated rows",
    )
    parser.add_argument(
        "--list-owners",
        action="store_true",
        help="print the Owner values in payslips.parquet and exit",
    )
    parser.add_argument(
        "--ddl",
        type=Path,
        help="schema SQL to apply (default: worker/drizzle/*.sql, in order)",
    )
    parser.add_argument(
        "--tokens-plaintext",
        action="store_true",
        help="acknowledge that bank tokens are copied unencrypted",
    )
    args = parser.parse_args()

    if args.list_owners:
        if not config.PAYSLIPS_FILE.exists():
            print("no payslips.parquet — any owner_key will do")
            return 0
        owners = pd.read_parquet(config.PAYSLIPS_FILE)["Owner"].value_counts()
        print("Owner values in payslips.parquet:")
        for owner, count in owners.items():
            print(f"  {owner}  ({count} months)")
        return 0

    if not args.out:
        parser.error("--out is required")
    if not args.user:
        parser.error("at least one --user is required")
    if args.out.exists():
        parser.error(f"{args.out} already exists; refusing to overwrite")

    if not args.tokens_plaintext:
        connections = read_json(config.CONFIG_DIR / "truelayer_connections.json", [])
        if connections:
            print(
                f"{len(connections)} bank connection(s) hold access/refresh tokens.\n"
                "This script copies them verbatim into access_token_enc/refresh_token_enc,\n"
                "which is NOT encrypted despite the column name. Either encrypt them in the\n"
                "app before first run, or re-run with --tokens-plaintext to accept that.",
                file=sys.stderr,
            )
            return 2

    print(f"reading from {config.CONFIG_DIR}")
    conn = sqlite3.connect(args.out)
    try:
        conn.executescript(PRAGMAS)
        conn.executescript(load_ddl(args.ddl))
        stats = migrate(conn, args.user, args.tokens_plaintext)
    except Exception:
        conn.close()
        args.out.unlink(missing_ok=True)
        raise

    print(f"\nwrote {args.out}")
    for key, value in stats.items():
        print(f"  {key}: {value}")

    print("\nverifying against parquet...")
    problems = verify(conn)
    conn.close()

    if problems:
        print("\nMISMATCHES:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print("  all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
