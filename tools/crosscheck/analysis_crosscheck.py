#!/usr/bin/env python3
"""Diff the Python analysis against the SQL that will replace it.

The Python app is the reference implementation: it is what the numbers in the
TUI have always been. Every query in queries/ is a candidate replacement, and
this harness proves each one reproduces the reference on real data before any
of it is wired into the Worker.

Both sides are normalised to integer cents and compared exactly. Amounts are
converted per row before aggregating, matching what the migration wrote to the
database, so a mismatch means the SQL disagrees about grouping, filtering or
category resolution — not about floating point.

Usage:
    PYTHONPATH=. python3 tools/crosscheck/analysis_crosscheck.py expenses.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Callable, List, Optional, Sequence, Tuple

import pandas as pd

from expenses.analysis import split_tagged_transactions
from expenses.data_handler import (
    apply_merchant_aliases_to_series,
    get_category_spending_type,
    load_categories,
    load_category_types,
    load_merchant_aliases,
    load_tag_settings,
    load_transactions_from_parquet,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from money import to_cents  # noqa: E402  (needs the path line above)

QUERIES = Path(__file__).resolve().parent / "queries"

Row = Tuple
Rows = List[Row]


# --------------------------------------------------------- the python side


def build_reference() -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Rebuild the DataFrame the Summary screen works from.

    Mirrors SummaryScreen.load_and_prepare_data: aliases resolve the merchant,
    the merchant resolves the category, and anything uncategorised falls to
    "Other". Returns (live, summary) where summary has the excluded tags
    removed, matching the screen's default.
    """
    df = load_transactions_from_parquet()
    if df.empty:
        return df, df

    df = df.copy()
    aliases = load_merchant_aliases()
    categories = load_categories()
    category_types = load_category_types()

    df["DisplayMerchant"] = apply_merchant_aliases_to_series(df["Merchant"], aliases)
    df["Category"] = df["DisplayMerchant"].map(categories).fillna("Other")
    df["SpendingType"] = df["Category"].map(
        lambda c: get_category_spending_type(c, category_types)
    )
    df["Cents"] = df["Amount"].apply(to_cents)
    df["Date"] = pd.to_datetime(df["Date"])
    df["Year"] = df["Date"].dt.strftime("%Y")
    df["Month"] = df["Date"].dt.strftime("%Y-%m")

    patterns = load_tag_settings().get("exclude_from_summary", [])
    summary, _ = split_tagged_transactions(df, patterns)
    return df, summary


def py_cash_flow_totals(df: pd.DataFrame) -> Rows:
    income = int(df.loc[df["Type"] == "income", "Cents"].sum())
    expenses = int(df.loc[df["Type"] == "expense", "Cents"].sum())
    return [(income, expenses)]


def _py_cash_flow_by(df: pd.DataFrame, column: str) -> Rows:
    rows = []
    for period, group in df.groupby(column):
        income = int(group.loc[group["Type"] == "income", "Cents"].sum())
        expenses = int(group.loc[group["Type"] == "expense", "Cents"].sum())
        rows.append((period, income, expenses))
    return sorted(rows)


def py_cash_flow_by_month(df: pd.DataFrame) -> Rows:
    return _py_cash_flow_by(df, "Month")


def py_cash_flow_by_year(df: pd.DataFrame) -> Rows:
    return _py_cash_flow_by(df, "Year")


def _py_category_breakdown(df: pd.DataFrame, column: str, txn_type: str) -> Rows:
    subset = df[df["Type"] == txn_type]
    if subset.empty:
        return []
    grouped = subset.groupby([column, "Category"])["Cents"].sum()
    return sorted((period, category, int(cents)) for (period, category), cents in grouped.items())


def py_category_by_year_expense(df: pd.DataFrame) -> Rows:
    return _py_category_breakdown(df, "Year", "expense")


def py_category_by_year_income(df: pd.DataFrame) -> Rows:
    return _py_category_breakdown(df, "Year", "income")


def py_category_by_month_expense(df: pd.DataFrame) -> Rows:
    return _py_category_breakdown(df, "Month", "expense")


def py_top_merchants_by_year(df: pd.DataFrame) -> Rows:
    subset = df[df["Type"] == "expense"]
    if subset.empty:
        return []
    grouped = subset.groupby(["Year", "DisplayMerchant"])["Cents"].agg(["sum", "count"])
    return sorted(
        (year, merchant, int(row["sum"]), int(row["count"]))
        for (year, merchant), row in grouped.iterrows()
    )


def py_spending_type_by_year(df: pd.DataFrame) -> Rows:
    subset = df[df["Type"] == "expense"]
    if subset.empty:
        return []
    grouped = subset.groupby(["Year", "SpendingType"])["Cents"].sum()
    return sorted((year, kind, int(cents)) for (year, kind), cents in grouped.items())


def py_hidden_tag_total(live: pd.DataFrame) -> Rows:
    """exclude_tagged_transactions, but summed in cents."""
    patterns = load_tag_settings().get("exclude_from_summary", [])
    _, excluded = split_tagged_transactions(live, patterns)
    if excluded.empty:
        return [(0,)]
    return [(int(excluded.loc[excluded["Type"] == "expense", "Cents"].sum()),)]


# ------------------------------------------------------------ the sql side


def run_sql(conn: sqlite3.Connection, filename: str, view: str, params: dict) -> Rows:
    sql = (QUERIES / filename).read_text().replace("{view}", view)
    return [tuple(row) for row in conn.execute(sql, params).fetchall()]


# ----------------------------------------------------------------- checks


class Check:
    def __init__(
        self,
        name: str,
        query: str,
        python: Callable[[pd.DataFrame], Rows],
        view: str = "v_summary",
        params: Optional[dict] = None,
        columns: Sequence[str] = (),
    ) -> None:
        self.name = name
        self.query = query
        self.python = python
        self.view = view
        self.params = params or {}
        self.columns = columns


CHECKS = [
    Check(
        "cash flow totals (all time)",
        "cash_flow_totals.sql",
        py_cash_flow_totals,
        columns=("income_cents", "expenses_cents"),
    ),
    Check(
        "cash flow by month",
        "net_cash_flow_by_month.sql",
        py_cash_flow_by_month,
        columns=("period", "income_cents", "expenses_cents"),
    ),
    Check(
        "cash flow by year",
        "net_cash_flow_by_year.sql",
        py_cash_flow_by_year,
        columns=("period", "income_cents", "expenses_cents"),
    ),
    Check(
        "category breakdown by year (expense)",
        "category_breakdown_by_year.sql",
        py_category_by_year_expense,
        params={"type": "expense"},
        columns=("period", "category", "amount_cents"),
    ),
    Check(
        "category breakdown by year (income)",
        "category_breakdown_by_year.sql",
        py_category_by_year_income,
        params={"type": "income"},
        columns=("period", "category", "amount_cents"),
    ),
    Check(
        "category breakdown by month (expense)",
        "category_breakdown_by_month.sql",
        py_category_by_month_expense,
        params={"type": "expense"},
        columns=("period", "category", "amount_cents"),
    ),
    Check(
        "top merchants by year (expense)",
        "top_merchants_by_year.sql",
        py_top_merchants_by_year,
        params={"type": "expense"},
        columns=("period", "merchant", "amount_cents", "txn_count"),
    ),
    Check(
        "essential vs discretionary by year",
        "spending_type_by_year.sql",
        py_spending_type_by_year,
        columns=("period", "spending_type", "amount_cents"),
    ),
    # Runs against every live row, since its whole job is the rows the
    # summary hides.
    Check(
        "hidden tag total",
        "hidden_tag_total.sql",
        py_hidden_tag_total,
        view="v_live",
        columns=("hidden_cents",),
    ),
    # The same totals without tag exclusion, which isolates a disagreement
    # about the exclusion rules from one about the aggregation itself.
    Check(
        "cash flow totals (no tag exclusion)",
        "cash_flow_totals.sql",
        py_cash_flow_totals,
        view="v_live",
        columns=("income_cents", "expenses_cents"),
    ),
]


# ---------------------------------------------------------------- reporting


def describe(row: Row, columns: Sequence[str]) -> str:
    if not columns:
        return str(row)
    return ", ".join(f"{name}={value}" for name, value in zip(columns, row))


def report(check: Check, expected: Rows, actual: Rows, limit: int = 5) -> bool:
    if expected == actual:
        print(f"  PASS  {check.name}  ({len(expected)} rows)")
        return True

    print(f"  FAIL  {check.name}")
    print(f"          python {len(expected)} rows, sql {len(actual)} rows")

    expected_set, actual_set = set(expected), set(actual)
    only_python = sorted(expected_set - actual_set)
    only_sql = sorted(actual_set - expected_set)

    for row in only_python[:limit]:
        print(f"          python only: {describe(row, check.columns)}")
    if len(only_python) > limit:
        print(f"          ... and {len(only_python) - limit} more python-only rows")
    for row in only_sql[:limit]:
        print(f"          sql only:    {describe(row, check.columns)}")
    if len(only_sql) > limit:
        print(f"          ... and {len(only_sql) - limit} more sql-only rows")

    if not only_python and not only_sql:
        print("          same rows, different order — check the ORDER BY")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("database", type=Path, help="SQLite database built by migrate_to_sqlite.py")
    parser.add_argument("--only", help="run only checks whose name contains this substring")
    args = parser.parse_args()

    if not args.database.exists():
        parser.error(f"{args.database} does not exist; build it with tools/migrate_to_sqlite.py")

    live, summary = build_reference()
    if live.empty:
        print("no transactions in the parquet; nothing to compare")
        return 0

    conn = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    conn.executescript((QUERIES / "views.sql").read_text())

    checks = [c for c in CHECKS if not args.only or args.only.lower() in c.name.lower()]
    print(f"comparing {len(checks)} analyses over {len(live)} live transactions\n")

    failures = 0
    for check in checks:
        frame = live if check.view == "v_live" else summary
        expected = check.python(frame)
        actual = run_sql(conn, check.query, check.view, check.params)
        if not report(check, expected, actual):
            failures += 1

    conn.close()
    print()
    if failures:
        print(f"{failures} of {len(checks)} analyses disagree")
        return 1
    print(f"all {len(checks)} analyses agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
