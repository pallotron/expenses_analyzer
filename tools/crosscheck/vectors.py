#!/usr/bin/env python3
"""Record what the Python does, so the TypeScript port can be held to it.

Runs the live `expenses` functions on synthetic inputs and writes their answers
to worker/src/__tests__/fixtures/python_vectors.json. The Worker's tests replay
every case and must agree exactly. Nothing here is reimplemented: each expected
value is whatever the Python returns today.

Covers merchant normalisation and aliasing, amount parsing as the import
pipeline stores it, the tag helpers, and whole append_transactions scenarios
(deduplication and soft-delete suppression).

Usage:
    PYTHONPATH=. python3 tools/crosscheck/vectors.py          # rewrite the file
    PYTHONPATH=. python3 tools/crosscheck/vectors.py --check  # fail if stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from expenses import tags as tag_helpers
from expenses.data_handler import (
    append_transactions,
    apply_merchant_alias,
    clean_amount,
    normalize_merchant_name,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from money import to_cents  # noqa: E402  (needs the path line above)

OUT = (
    Path(__file__).resolve().parents[2]
    / "worker" / "src" / "__tests__" / "fixtures" / "python_vectors.json"
)

# ------------------------------------------------------------- merchants

MERCHANT_NAMES = [
    "POS ST VINCENTS 26/08 09",
    "POS ST VINCENTS 14/03 11",
    "CNC ROEBUCK PHAR 28/07 1",
    "TESCO STORES 3021",
    "7-ELEVEN 12/01",
    "12/01 LEADING DATE",
    "SHOP  10/08",
    "SHOP 10/8 1",
    "",
    "   ",
    "AMAZON.CO.UK*AB12CD",
    "CAFÉ NÉRO 01/02 3",
]

ALIASES = {
    r".*AG CIA Erfgo.*": "AG CIA Erfgoed",
    r"STARBUCKS.*": "Starbucks",
    r"Starbucks Coffee": "Starbucks",
    r"^AMZN|AMAZON": "Amazon",
    r"amazon prime": "Amazon Prime",  # never wins: the pattern above matches first
    r"CAFÉ N[EÉ]RO": "Caffè Nero",
    r"[invalid": "Never",  # not a valid regex; must be skipped, not fatal
    r"TESCO\s+STORES\s+\d+": "Tesco",
    r"\bSPAR\b": "Spar",
}

ALIAS_INPUTS = MERCHANT_NAMES + [
    "CNC AG CIA Erfgo 10/08 0",
    "starbucks #1234",
    "Starbucks Coffee",
    "amzn mktp",
    "Amazon Prime Video",
    "café néro 02/02 1",
    "EUROSPAR 12/04 1",
    "SPAR EXPRESS 12/04",
    "Something Unknown 09/09 2",
]

# --------------------------------------------------------------- amounts

AMOUNTS = [
    "12.34", "-12.34", "(12.34)", "€1,234.56", "£ 5", "$0.99", "-", "", "abc",
    "1.005", "2.675", "12.345", "0.125", "0.135", "1e3", "+5", " 7.10 ",
    "(1,000.00)", "0", "-0.00", "100", "3.14159", ".5", "5.",
]

# ------------------------------------------------------------------ tags

TAG_INPUTS = ["Emergency", " trip Paris ", "trip:paris-jun26", "a_b", "bad*chars!", "", "ÉTÉ", "x" * 3]
TAG_CELLS = [None, "", "emergency", "emergency,trip:paris", ",,gift,", "a,b,a"]
PATTERN_INPUTS = ["emergency", "Trip:*", "trip:*", "*", "tr*ip", "trip**", " gift ", ""]
MATCH_CASES = [
    ("emergency,gift", ["emergency"]),
    ("trip:paris", ["trip:*"]),
    ("tripx:rome", ["trip:*"]),
    ("trip_a", ["trip_*"]),
    ("tripxa", ["trip_*"]),
    ("gift", ["*"]),
    ("", ["emergency"]),
    (None, ["emergency"]),
    ("trip", ["trip:*"]),
]

# ---------------------------------------------------------------- imports

MUSEUM = ("2026-08-12", "CNC AG CIA Erfgo 10/08 0", 12.00)


def rows(*specs, deleted=False):
    return [{"date": d, "merchant": m, "amount": a, "deleted": deleted} for d, m, a in specs]


IMPORT_SCENARIOS = {
    "empty store takes everything, twins included": {
        "existing": [],
        "new": rows(MUSEUM, MUSEUM, ("2026-08-13", "TESCO STORES 3021", 45.10)),
    },
    "same-day repeat purchase survives aliasing": {
        "existing": rows(("2026-08-12", "Old Merchant", 5.00)),
        "new": rows(
            ("2026-08-12", "CNC AG CIA Erfgo 10/08 0", 12.00),
            ("2026-08-12", "CNC AG CIA Erfgo 10/08 1", 12.00),
        ),
    },
    "reimporting the same batch adds nothing": {
        "existing": rows(MUSEUM, ("2026-08-12", "CNC AG CIA Erfgo 10/08 1", 12.00)),
        "new": rows(MUSEUM, ("2026-08-12", "CNC AG CIA Erfgo 10/08 1", 12.00)),
    },
    "extra occurrence in a reimport is kept": {
        "existing": rows(MUSEUM, MUSEUM),
        "new": rows(MUSEUM, MUSEUM, MUSEUM),
    },
    "one purchase under two names collapses": {
        "existing": rows(("2026-08-12", "STARBUCKS #1234", 4.50)),
        "new": rows(("2026-08-12", "Starbucks Coffee", 4.50)),
    },
    "date stamps do not make a new merchant": {
        "existing": rows(("2026-03-14", "POS ST VINCENTS 14/03 11", 30.00)),
        "new": rows(
            ("2026-03-14", "POS ST VINCENTS 14/03 12", 30.00),
            ("2026-03-14", "POS ST VINCENTS 14/03 13", 30.00),
        ),
    },
    "a different amount or day is a different purchase": {
        "existing": rows(MUSEUM),
        "new": rows(
            ("2026-08-12", "CNC AG CIA Erfgo 10/08 0", 12.01),
            ("2026-08-13", "CNC AG CIA Erfgo 10/08 0", 12.00),
        ),
    },
    "deleting one twin still imports the other": {
        "existing": rows(MUSEUM, deleted=True),
        "new": rows(MUSEUM, MUSEUM),
    },
    "a deleted row is not resurrected": {
        "existing": rows(MUSEUM, deleted=True),
        "new": rows(MUSEUM),
    },
    "two deletions absorb two copies": {
        "existing": rows(MUSEUM, MUSEUM, deleted=True),
        "new": rows(MUSEUM, MUSEUM),
    },
    "deleted history is never dropped": {
        "existing": rows(MUSEUM, MUSEUM, deleted=True),
        "new": rows(MUSEUM, MUSEUM, MUSEUM),
    },
    "deletions and live rows together": {
        "existing": rows(MUSEUM, deleted=True) + rows(MUSEUM, MUSEUM),
        "new": rows(MUSEUM, MUSEUM, MUSEUM, MUSEUM),
    },
    "deleted twin whose live sibling survived": {
        "existing": rows(MUSEUM) + rows(MUSEUM, deleted=True),
        "new": rows(MUSEUM, MUSEUM, MUSEUM),
    },
    "case-insensitive alias merges spellings": {
        "existing": rows(("2026-01-05", "AMAZON MARKETPLACE", 19.99)),
        "new": rows(("2026-01-05", "amzn mktp", 19.99), ("2026-01-05", "amzn mktp", 19.99)),
    },
}


def run_import(existing: list, new: list) -> dict:
    """append_transactions with the parquet swapped for in-memory frames."""

    def frame(specs):
        return pd.DataFrame(
            {
                "Date": pd.to_datetime([r["date"] for r in specs]),
                "Merchant": [r["merchant"] for r in specs],
                "Amount": [r["amount"] for r in specs],
                "Deleted": [r["deleted"] for r in specs],
                "Type": ["expense"] * len(specs),
                "Source": ["Test"] * len(specs),
                "Tags": [""] * len(specs),
            }
        )

    existing_df = frame(existing)
    new_df = frame(new).drop(columns=["Deleted", "Source"])
    with (
        patch("expenses.data_handler.load_transactions_from_parquet", return_value=existing_df),
        patch("expenses.data_handler.save_transactions_to_parquet") as save,
        patch("expenses.data_handler.load_merchant_aliases", return_value=ALIASES),
        patch("expenses.data_handler.create_auto_backup"),
    ):
        append_transactions(new_df)
    saved = save.call_args[0][0]

    deleted = saved["Deleted"].fillna(False).astype(bool)
    live = saved[~deleted]
    return {
        "live": sorted(
            [
                d.strftime("%Y-%m-%d"),
                apply_merchant_alias(str(m), ALIASES),
                to_cents(a),
            ]
            for d, m, a in zip(live["Date"], live["Merchant"], live["Amount"])
        ),
        "deleted": int(deleted.sum()),
    }


# ------------------------------------------------------------------ build


def build() -> dict:
    stored_cents = (
        clean_amount(pd.Series(AMOUNTS)).round(2).apply(to_cents).tolist()
    )
    return {
        "_generated_by": "tools/crosscheck/vectors.py — do not edit by hand",
        "normalizeMerchantName": [[n, normalize_merchant_name(n)] for n in MERCHANT_NAMES],
        "aliases": {
            "rules": [[p, a] for p, a in ALIASES.items()],
            "cases": [[n, apply_merchant_alias(n, ALIASES)] for n in ALIAS_INPUTS],
        },
        "amountCents": [[a, int(c)] for a, c in zip(AMOUNTS, stored_cents)],
        "tags": {
            "normalizeTag": [[t, tag_helpers.normalize_tag(t)] for t in TAG_INPUTS],
            "parseTags": [[c, tag_helpers.parse_tags(c)] for c in TAG_CELLS],
            "joinTags": [[list(t), tag_helpers.join_tags(list(t))] for t in (
                ["Emergency", "emergency", "Trip Paris"], ["", "!!", "gift"], [],
            )],
            "addTags": [[c, ["Gift", "emergency"], tag_helpers.add_tags_to_cell(c, ["Gift", "emergency"])]
                        for c in TAG_CELLS],
            "removeTags": [[c, ["EMERGENCY"], tag_helpers.remove_tags_from_cell(c, ["EMERGENCY"])]
                           for c in TAG_CELLS],
            "normalizePattern": [[p, tag_helpers.normalize_pattern(p)] for p in PATTERN_INPUTS],
            "isValidPattern": [[p, tag_helpers.is_valid_pattern(p)] for p in PATTERN_INPUTS],
            "cellMatchesPatterns": [[c, p, tag_helpers.cell_matches_patterns(c, p)] for c, p in MATCH_CASES],
        },
        "imports": {
            "aliases": [[p, a] for p, a in ALIASES.items()],
            "scenarios": [
                {"name": name, **spec, "expected": run_import(spec["existing"], spec["new"])}
                for name, spec in IMPORT_SCENARIOS.items()
            ],
        },
    }


def render(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--check", action="store_true", help="fail if the committed file is out of date")
    args = parser.parse_args()

    text = render(build())
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT} is stale; run tools/crosscheck/vectors.py and commit the result")
            return 1
        print("python vectors are current")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
