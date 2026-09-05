#!/usr/bin/env python3
"""Build a synthetic config dir to exercise the migration and cross-check.

Entirely invented data — no real financial information, ever. Covers the
awkward cases: a date-stamped merchant that normalisation must collapse, two
identical same-day purchases that must both survive, a soft-deleted row, an
uncategorised merchant, prefix-matched tag exclusion, and income.

This exists so the SQL in queries/ can be regression-tested without access to
anyone's parquet, which is what makes the cross-check runnable in CI.
"""

import json
import shutil
import sys
from pathlib import Path

import pandas as pd

target = Path(sys.argv[1])
if target.exists():
    shutil.rmtree(target)
target.mkdir(parents=True)

transactions = pd.DataFrame(
    [
        # Two identical purchases on one day: both must survive, occurrences 0 and 1.
        {"Date": "2026-01-15", "Merchant": "COFFEE HOUSE", "Amount": 3.50,
         "Source": "CSV", "Deleted": False, "Type": "expense", "Tags": ""},
        {"Date": "2026-01-15", "Merchant": "COFFEE HOUSE", "Amount": 3.50,
         "Source": "CSV", "Deleted": False, "Type": "expense", "Tags": ""},
        # Date-stamped variants of one shop; normalisation collapses both.
        {"Date": "2026-01-20", "Merchant": "POS PHARMACY 20/01 09", "Amount": 12.99,
         "Source": "CSV", "Deleted": False, "Type": "expense", "Tags": "health"},
        {"Date": "2026-02-03", "Merchant": "POS PHARMACY 03/02 11", "Amount": 8.40,
         "Source": "CSV", "Deleted": False, "Type": "expense", "Tags": ""},
        # Regex alias target.
        {"Date": "2026-02-10", "Merchant": "AMAZON EU SARL 12345", "Amount": 45.00,
         "Source": "TrueLayer - Test Bank", "Deleted": False, "Type": "expense",
         "Tags": "gift,trip:lisbon-feb26"},
        # Soft-deleted row: state must be preserved.
        {"Date": "2026-02-11", "Merchant": "DUPLICATE CHARGE", "Amount": 99.99,
         "Source": "CSV", "Deleted": True, "Type": "expense", "Tags": ""},
        # Income.
        {"Date": "2026-02-25", "Merchant": "SALARY", "Amount": 3200.00,
         "Source": "CSV", "Deleted": False, "Type": "income", "Tags": ""},
        # Never categorised -> must resolve to "Other".
        {"Date": "2026-03-01", "Merchant": "MYSTERY SHOP", "Amount": 17.25,
         "Source": "CSV", "Deleted": False, "Type": "expense", "Tags": "emergency"},
        # Rounding edge: 0.005 must not vanish to banker's rounding.
        {"Date": "2026-03-02", "Merchant": "COFFEE HOUSE", "Amount": 1.005,
         "Source": "CSV", "Deleted": False, "Type": "expense", "Tags": ""},
    ]
)
transactions["Date"] = pd.to_datetime(transactions["Date"])
transactions.to_parquet(target / "transactions.parquet")

payslips = pd.DataFrame(
    [
        {"Owner": "self", "Month": "2026-01", "Gross": 5000.0, "Net": 3200.0,
         "TaxTotal": 1500.0, "PensionEE": 250.0, "AVC": 50.0, "PensionER": 300.0,
         "Bonus": 0.0, "OnCall": 120.0, "SourceFiles": ["2026-01.pdf"],
         "YTDReconciled": True, "NetReconciled": True},
        {"Owner": "partner", "Month": "2026-01", "Gross": 4100.0, "Net": 2800.0,
         "TaxTotal": 1100.0, "PensionEE": 200.0, "AVC": 0.0, "PensionER": 240.0,
         "Bonus": 0.0, "OnCall": 0.0, "SourceFiles": ["p-2026-01.pdf"],
         "YTDReconciled": True, "NetReconciled": False},
        # Owner with no matching --user: must be skipped and reported, not crash.
        {"Owner": "ghost", "Month": "2026-01", "Gross": 10.0, "Net": 10.0,
         "TaxTotal": 0.0, "PensionEE": 0.0, "AVC": 0.0, "PensionER": 0.0,
         "Bonus": 0.0, "OnCall": 0.0, "SourceFiles": [],
         "YTDReconciled": False, "NetReconciled": False},
    ]
)
payslips.to_parquet(target / "payslips.parquet")

# Keyed on the ALIASED name, which is how the app resolves categories.
(target / "categories.json").write_text(json.dumps({
    "Coffee House": "Eating Out",
    "POS PHARMACY": "Health",
    "Amazon": "Shopping",
    "Salary": "Income",
}, indent=2))

(target / "merchant_aliases.json").write_text(json.dumps({
    "AMAZON.*": "Amazon",
    "COFFEE HOUSE.*": "Coffee House",
}, indent=2))

(target / "category_types.json").write_text(json.dumps({
    "essential": {"categories": ["Health", "Groceries"], "annual_budget": 12000.0},
    "discretionary": {"categories": ["Eating Out", "Shopping"], "annual_budget": 6000.0},
}, indent=2))

(target / "tag_settings.json").write_text(json.dumps({
    "exclude_from_summary": ["emergency", "trip:*"]
}, indent=2))

(target / "truelayer_connections.json").write_text(json.dumps([{
    "connection_id": "conn-synthetic-1",
    "provider_name": "Test Bank",
    "access_token": "synthetic-access-token",
    "refresh_token": "synthetic-refresh-token",
    "last_sync": "2026-03-01T10:00:00",
}], indent=2))

print(f"fixture written to {target}")
