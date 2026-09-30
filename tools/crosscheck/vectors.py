#!/usr/bin/env python3
"""Record what the Python does, so the TypeScript port can be held to it.

Runs the live `expenses` functions on synthetic inputs and writes their answers
to worker/src/__tests__/fixtures/python_vectors.json. The Worker's tests replay
every case and must agree exactly. Nothing here is reimplemented: each expected
value is whatever the Python returns today.

Covers merchant normalisation and aliasing, amount parsing as the import
pipeline stores it, the tag helpers, whole append_transactions scenarios
(deduplication and soft-delete suppression), the Transactions screen's
filters, import validation, the merchant editor's preview, and the Summary
screen's monthly grid, anomaly flags and merchant lists.

Usage:
    PYTHONPATH=. python3 tools/crosscheck/vectors.py          # rewrite the file
    PYTHONPATH=. python3 tools/crosscheck/vectors.py --check  # fail if stale
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from types import MethodType, SimpleNamespace
from unittest.mock import patch

import pandas as pd
from rich.style import Style

from expenses import tags as tag_helpers
from expenses.data_handler import (
    append_transactions,
    apply_merchant_alias,
    clean_amount,
    normalize_merchant_name,
)
from expenses.merchant_editor import pattern_claiming, preview_alias_change
from expenses.screens.summary_screen import SummaryScreen
from expenses.transaction_filter import apply_filters
from expenses.validation import ValidationError, validate_transaction_dataframe

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


# --------------------------------------------------------------- filters

# The rows the Transactions screen filters: display merchant, resolved
# category and budget type already applied, as populate_table does.
FILTER_ROWS = [
    ("2026-01-05", "Tesco", 45.10, "CSV Import", "Groceries", "expense", "", "essential"),
    ("2026-01-06", "NS", 3.20, "TrueLayer - AIB", "Transport", "expense", "", "discretionary"),
    ("2026-01-07", "Bunsen", 18.00, "CSV Import", "Dining", "expense", "trip:paris", "discretionary"),
    ("2026-02-01", "Employer", 4000.00, "CSV Import", "Salary", "income", "", "discretionary"),
    ("2026-02-10", "Café Néro", 4.50, "Manual", "Dining", "expense", "gift,trip:rome", "discretionary"),
    ("2026-02-28", "tesco express", 12.00, "TrueLayer - AIB", "Groceries", "expense", "emergency",
     "essential"),
    ("2026-03-01", "Vet", 250.00, "Manual", "Other", "expense", "emergency", "discretionary"),
]

# Each case is what a user typed into the screen's filter boxes.
FILTER_CASES = [
    {},
    {"dateFrom": "2026-01-06", "dateTo": "2026-02-10"},
    {"dateFrom": "not a date"},
    {"merchant": "tesco"},
    {"merchant": '"NS"'},
    {"merchant": '"ns"'},
    {"merchant": "ns"},
    {"merchant": "CAFÉ"},
    {"merchant": ""},
    {"amountMin": "10", "amountMax": "250"},
    {"amountMin": "abc"},
    {"source": "truelayer"},
    {"category": "din"},
    {"category": '"Dining"'},
    {"type": "income"},
    {"tags": "trip"},
    {"tags": '"emergency"'},
    {"tags": '"gift"'},
    {"budget": "essential"},
    {"type": "expense", "category": "groc", "dateFrom": "2026-02-01"},
]


def run_filter(case: dict) -> list:
    """TransactionScreen.populate_table's filters, then its budget filter."""
    df = pd.DataFrame(
        FILTER_ROWS,
        columns=["Date", "DisplayMerchant", "Amount", "Source", "Category", "Type", "Tags", "Budget"],
    )
    df["Date"] = pd.to_datetime(df["Date"])
    filters = {
        "date_min": ("Date", ">=", pd.to_datetime(case.get("dateFrom", ""), errors="coerce")),
        "date_max": ("Date", "<=", pd.to_datetime(case.get("dateTo", ""), errors="coerce")),
        "merchant": ("DisplayMerchant", "contains", case.get("merchant", "")),
        "amount_min": ("Amount", ">=", pd.to_numeric(case.get("amountMin", ""), errors="coerce")),
        "amount_max": ("Amount", "<=", pd.to_numeric(case.get("amountMax", ""), errors="coerce")),
        "source": ("Source", "contains", case.get("source", "")),
        "category": ("Category", "contains", case.get("category", "")),
        "type": ("Type", "==", case.get("type")),
        "tags": ("Tags", "contains", case.get("tags", "")),
    }
    result = apply_filters(df, filters)
    if case.get("budget"):
        result = result[result["Budget"] == case["budget"]]
    return [int(i) for i in result.index]


# ------------------------------------------------------------- validation

VALIDATION_CASES = {
    "valid rows": [("2026-01-05", "Tesco", 45.10, "expense"), ("2026-01-06", "Employer", -3.0, "income")],
    "no rows": [],
    "blank merchants": [("2026-01-05", "", 1.0, "expense"), ("2026-01-05", "   ", 1.0, "expense")],
    "impossible date": [("2026-02-30", "Tesco", 1.0, "expense")],
    "unparseable date": [("garbage", "Tesco", 1.0, "expense")],
    "too old": [("1899-12-31", "Tesco", 1.0, "expense")],
    "too new": [("2099-01-01", "Tesco", 1.0, "expense")],
    "amount limits": [
        ("2026-01-05", "A", 1_000_000.00, "expense"),
        ("2026-01-05", "B", 1_000_000.01, "expense"),
        ("2026-01-05", "C", -2_000_000.00, "income"),
    ],
    "zero amount is allowed": [("2026-01-05", "Tesco", 0.0, "expense")],
    "bad type": [("2026-01-05", "Tesco", 1.0, "refund"), ("2026-01-05", "Tesco", 1.0, "Expense")],
    "several problems": [
        ("1899-01-01", "", 5_000_000.0, "refund"),
        ("2026-01-05", "Fine", 1.0, "expense"),
    ],
}


# The real limit is a year from today. Pinned here so the file does not go
# stale every day; the TypeScript tests pass the same date.
VALIDATION_MAX_DATE = datetime(2030, 6, 15)


def run_validation(rows: list) -> list:
    df = pd.DataFrame(rows, columns=["Date", "Merchant", "Amount", "Type"])
    try:
        validate_transaction_dataframe(df, max_date=VALIDATION_MAX_DATE)
    except ValidationError as exc:
        return exc.errors
    return []


# --------------------------------------------------------- merchant editor

EDITOR_ROWS = [
    ("STARBUCKS #1234", 4.50),
    ("Starbucks Coffee", 3.90),
    ("STARBUCKS RESERVE", 6.00),
    ("TESCO STORES 3021", 45.10),
    ("TESCO EXPRESS 12/04 1", 12.00),
    ("AMZN MKTP", 19.99),
    ("Amazon Prime Video", 8.99),
    ("Corner Shop 01/02 3", 2.50),
]
EDITOR_ALIASES = {
    r"STARBUCKS.*": "Starbucks",
    r"TESCO\s+STORES\s+\d+": "Tesco",
    r"^AMZN|AMAZON": "Amazon",
}
EDITOR_CATEGORIES = {
    "Starbucks": "Dining",
    "Tesco": "Groceries",
    "Amazon": "Shopping",
    "TESCO EXPRESS": "Groceries",
}
PREVIEW_CASES = [
    ("TESCO", "Tesco"),
    ("STARBUCKS.*", "Starbucks Coffee Co"),
    ("Starbucks Coffee", "Starbucks"),
    ("PRIME", "Amazon Prime"),
    ("Corner", ""),
    ("", "Anything"),
    ("[bad", "Broken"),
]
CLAIMING_INPUTS = [m for m, _ in EDITOR_ROWS] + ["nothing matches this"]


def run_preview(pattern: str, alias: str) -> dict:
    df = pd.DataFrame(EDITOR_ROWS, columns=["Merchant", "Amount"])
    preview = preview_alias_change(pattern, alias, df, EDITOR_ALIASES, EDITOR_CATEGORIES)
    return {
        "matched": preview.matched,
        "totalCents": to_cents(preview.total),
        "currentCategories": dict(sorted(preview.current_categories.items())),
        "merchants": dict(sorted(preview.merchants.items())),
        "error": preview.error is not None,
    }


# ---------------------------------------------------------------- summary

SUMMARY_CATEGORY_TYPES = {
    "essential": {"categories": ["Groceries", "Rent"]},
    "discretionary": {"categories": ["Dining"]},
}


def _months(first: str, last: str) -> list:
    return [p.strftime("%Y-%m") for p in pd.period_range(first, last, freq="M")]


def summary_rows() -> list:
    """Fifteen months of invented household data, shaped to hit every rule.

    - Groceries: steady with a spike in 2026-02 (an anomaly).
    - Rent: constant, so its std is 0 and it can never be an anomaly.
    - Dining: sparse, so most of its window is zeros.
    - Other: an expense category that also has an income row in its window,
      because the historical stats pivot income and expenses together.
    - Books: first appears in 2026-03, so its mean is undefined.
    - No rows at all in 2025-06, to pin down whether the month index has gaps.
    """
    rows = []
    for i, month in enumerate(_months("2025-01", "2026-03")):
        if month == "2025-06":
            continue
        groceries = 90_000 if month == "2026-02" else 30_000 + (i % 3) * 1_000
        rows.append((f"{month}-03", "Tesco", groceries, "expense", "Groceries", "Bank A"))
        rows.append((f"{month}-01", "Landlord", 150_000, "expense", "Rent", "Bank A"))
        rows.append((f"{month}-25", "Employer", 400_000 + (i % 2) * 10_000, "income", "Salary", "Bank A"))
    rows += [
        ("2025-03-14", "Cafe", 2_000, "expense", "Dining", "Card"),
        ("2025-09-20", "Cafe", 2_500, "expense", "Dining", "Card"),
        ("2026-01-10", "Cafe", 9_000, "expense", "Dining", "Card"),
        ("2026-02-11", "Bistro", 4_300, "expense", "Dining", "Card"),
        ("2025-04-02", "Mystery", 1_000, "expense", "Other", "Card"),
        ("2025-05-09", "Refund Co", 50_000, "income", "Other", "Bank A"),
        ("2025-07-12", "Mystery", 1_500, "expense", "Other", "Card"),
        ("2026-03-05", "Bookshop", 5_000, "expense", "Books", "Card"),
        ("2026-02-15", "Tesco", 1_234, "expense", "Groceries", "Card"),
    ]
    return rows


def summary_frame(rows: list, sources) -> pd.DataFrame:
    """The frame SummaryScreen.transactions returns, source filter applied."""
    df = pd.DataFrame(
        [
            {"Date": pd.Timestamp(d), "Merchant": m, "DisplayMerchant": m, "Amount": c / 100,
             "Type": t, "Category": cat, "Source": s}
            for d, m, c, t, cat, s in rows
        ]
    )
    if sources is not None:
        df = df[df["Source"].isin(sources)].copy()
    return df


class _Table:
    """Stands in for a DataTable: keeps the rows the screen adds."""

    def __init__(self):
        self.rows = []

    def clear(self, columns=False):
        self.rows = []

    def add_columns(self, *columns):
        pass

    def add_row(self, *cells, key=None):
        self.rows.append(cells)


def _screen(df: pd.DataFrame, table: _Table):
    """Just enough of a SummaryScreen for its table-filling methods to run."""
    screen = SimpleNamespace(
        transactions=df, selected_rows=set(), category_types=SUMMARY_CATEGORY_TYPES,
        query_one=lambda *_a, **_k: table,
    )
    for name in ("_prepare_monthly_summary", "_calculate_historical_stats", "_create_monthly_cell"):
        setattr(screen, name, MethodType(getattr(SummaryScreen, name), screen))
    return screen


def _plain(cell) -> str:
    return cell.plain if hasattr(cell, "plain") else re.sub(r"\[/?bold\]", "", str(cell))


def _cents(cell) -> int:
    token = _plain(cell).split()[0]
    return 0 if token == "-" else to_cents(token.replace(",", ""))


def _anomaly(cell) -> bool:
    style = getattr(cell, "style", None)
    return isinstance(style, Style) and style.bgcolor is not None and style.bgcolor.name == "dark_red"


def run_grid(rows: list, year: int, sources, income: bool):
    table = _Table()
    fill = (
        SummaryScreen._populate_monthly_income_breakdown if income
        else SummaryScreen._populate_monthly_breakdown
    )
    fill(_screen(summary_frame(rows, sources), table), table, year)
    if not table.rows:
        return None
    total, *body = table.rows
    return {
        "total": {"totalCents": _cents(total[1]), "months": [_cents(c) for c in total[3:]]},
        "rows": [
            {
                "category": _plain(r[0]),
                "totalCents": _cents(r[1]),
                "averageCents": _cents(r[2]),
                "months": [_cents(c) for c in r[3:]],
                "anomalies": [_anomaly(c) for c in r[3:]],
            }
            for r in body
        ],
    }


def run_merchants(rows: list, year: int, month, sources, income: bool) -> list:
    table = _Table()
    screen = _screen(summary_frame(rows, sources), table)
    view = SummaryScreen.update_top_income_view if income else SummaryScreen.update_top_merchants_view
    view(screen, year, month)
    return [[r[0], r[1], _cents(r[-1])] for r in table.rows]


GRID_CASES = [(2025, None), (2026, None), (2026, ["Bank A"]), (2026, ["Card"])]
MERCHANT_CASES = [
    (2026, None, None, False),
    (2026, 2, None, False),
    (2025, None, ["Card"], False),
    (2025, None, None, True),
    (2026, 3, ["Bank A"], True),
]


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
        "filters": {
            "rows": [list(r) for r in FILTER_ROWS],
            "cases": [{"filter": case, "expected": run_filter(case)} for case in FILTER_CASES],
        },
        "validation": {
            "maxDate": VALIDATION_MAX_DATE.strftime("%Y-%m-%d"),
            "cases": [
                {"name": name, "rows": [list(r) for r in rows], "errors": run_validation(rows)}
                for name, rows in VALIDATION_CASES.items()
            ],
        },
        "merchantEditor": {
            "rows": [list(r) for r in EDITOR_ROWS],
            "aliases": [[p, a] for p, a in EDITOR_ALIASES.items()],
            "categories": EDITOR_CATEGORIES,
            "previews": [
                {"pattern": p, "alias": a, "expected": run_preview(p, a)} for p, a in PREVIEW_CASES
            ],
            "claiming": [[m, pattern_claiming(m, EDITOR_ALIASES)] for m in CLAIMING_INPUTS],
        },
        "summary": {
            "categoryTypes": SUMMARY_CATEGORY_TYPES,
            "rows": [list(r) for r in summary_rows()],
            "grids": [
                {"year": y, "sources": s, "type": t,
                 "expected": run_grid(summary_rows(), y, s, income=(t == "income"))}
                for y, s in GRID_CASES
                for t in ("expense", "income")
            ],
            "merchants": [
                {"year": y, "month": m, "sources": s, "type": "income" if inc else "expense",
                 "expected": run_merchants(summary_rows(), y, m, s, inc)}
                for y, m, s, inc in MERCHANT_CASES
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
