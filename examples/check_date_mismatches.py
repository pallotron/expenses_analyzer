#!/usr/bin/env python3
"""
Script to check for ALL date parsing mismatches by comparing database against source CSV.

This checks if transactions were imported with swapped month/day values.
"""

import pandas as pd
from pathlib import Path
import sys
from expenses.data_handler import load_transactions_from_parquet

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))


def _detect_date_column(csv_df: pd.DataFrame) -> str | None:
    """Detect the date column in the CSV."""
    for col in csv_df.columns:
        if "date" in col.lower() and "start" not in col.lower():
            if "completed" in col.lower():
                return col
            # Keep searching for a better match
    # Return first date-like column if no 'completed' found
    for col in csv_df.columns:
        if "date" in col.lower() and "start" not in col.lower():
            return col
    return None


def _detect_merchant_column(csv_df: pd.DataFrame) -> str | None:
    """Detect the merchant column in the CSV."""
    for col in csv_df.columns:
        if "description" in col.lower() or "merchant" in col.lower():
            return col
    return None


def _clean_money(val):
    """Clean and convert money value to float."""
    if pd.isna(val) or val == "-":
        return 0.0
    val_str = (
        str(val)
        .replace(",", "")
        .replace("€", "")
        .replace("$", "")
        .replace("£", "")
        .replace("-", "")
        .strip()
    )
    try:
        return float(val_str)
    except ValueError:
        return 0.0


def _detect_amount_column(csv_df: pd.DataFrame) -> str | None:
    """Detect and normalize the amount column in the CSV."""
    amount_col = None
    money_in_col = None
    money_out_col = None

    for col in csv_df.columns:
        if "amount" in col.lower() and "money" not in col.lower():
            amount_col = col
            break
        if "money in" in col.lower():
            money_in_col = col
        if "money out" in col.lower():
            money_out_col = col

    if amount_col:
        print(f"Using amount column: {amount_col}")
        return amount_col
    elif money_in_col and money_out_col:
        print(f"Using amount columns: {money_in_col} and {money_out_col}")
        csv_df["Amount"] = csv_df[money_out_col].apply(_clean_money)
        return "Amount"
    return None


def _parse_date_new(date_str):
    """Parse date using new (correct) method with ISO format priority."""
    date_str = str(date_str).strip()
    # Strategy 1: Try ISO format first
    try:
        return pd.to_datetime(date_str, format="ISO8601", errors="raise")
    except (ValueError, TypeError):
        # Strategy 2: Try pandas auto-detection without dayfirst
        try:
            return pd.to_datetime(date_str, errors="raise")
        except (ValueError, TypeError):
            # Strategy 3: Try with dayfirst=True
            return pd.to_datetime(date_str, errors="coerce", dayfirst=True)


def _print_mismatch_summary(mismatched_rows: pd.DataFrame, date_col: str, merchant_col: str):
    """Print summary of date mismatches found in CSV."""
    print(f"\n{'='*80}")
    print(f"WARNING: Found {len(mismatched_rows)} transactions with date parsing differences!")
    print(f"{'='*80}\n")
    print("Transactions that were parsed differently:\n")
    print(f"{'Original Date':<25} {'OLD Parsing':<20} {'NEW Parsing':<20} {'Merchant':<30}")
    print("-" * 100)

    for idx, row in mismatched_rows.head(30).iterrows():
        original = str(row[date_col])[:24]
        old_date = row["Date_Old"].strftime("%Y-%m-%d") if pd.notna(row["Date_Old"]) else "NaT"
        new_date = row["Date_New"].strftime("%Y-%m-%d") if pd.notna(row["Date_New"]) else "NaT"
        merchant = str(row[merchant_col])[:29]
        print(f"{original:<25} {old_date:<20} {new_date:<20} {merchant:<30}")

    if len(mismatched_rows) > 30:
        print(f"\n... and {len(mismatched_rows) - 30} more")


def _find_affected_transactions(mismatched_rows: pd.DataFrame, db_df: pd.DataFrame,
                                merchant_col: str, amount_col: str, date_col: str) -> list:
    """Find transactions in database that were affected by wrong date parsing."""
    import re
    affected_in_db = []

    for idx, row in mismatched_rows.iterrows():
        merchant = str(row[merchant_col])
        amount = _clean_money(row[amount_col])
        old_date = row["Date_Old"]
        new_date = row["Date_New"]

        if pd.isna(old_date) or pd.isna(new_date):
            continue

        merchant_pattern = re.escape(merchant[:20])
        matches = db_df[
            (db_df["Merchant"].str.contains(merchant_pattern, case=False, na=False, regex=True))
            & (abs(db_df["Amount"] - amount) < 0.01)
            & (db_df["Date"].dt.date == old_date.date())
        ]

        if not matches.empty:
            affected_in_db.append({
                "CSV_Date": str(row[date_col]),
                "DB_Date": matches.iloc[0]["Date"],
                "Correct_Date": new_date,
                "Merchant": merchant,
                "Amount": amount,
                "Source": matches.iloc[0].get("Source", "Unknown"),
            })

    return affected_in_db


def _print_database_issues(affected_in_db: list, mismatched_rows: pd.DataFrame):
    """Print summary of database issues found."""
    if not affected_in_db:
        print("✓ No transactions found in database with wrong dates!")
        print("  Your database appears to be correct.")
        return

    print(f"Found {len(affected_in_db)} transactions in DATABASE with WRONG dates:\n")
    print(f"{'DB Date (WRONG)':<20} {'Should Be':<20} {'Merchant':<30} {'Amount':<10} {'Source'}")
    print("-" * 100)

    affected_df = pd.DataFrame(affected_in_db)
    for _, row in affected_df.head(50).iterrows():
        db_date = row["DB_Date"].strftime("%Y-%m-%d")
        correct_date = row["Correct_Date"].strftime("%Y-%m-%d")
        merchant = row["Merchant"][:29]
        amount = f"{row['Amount']:.2f}"
        source = row["Source"]
        print(f"{db_date:<20} {correct_date:<20} {merchant:<30} {amount:<10} {source}")

    if len(affected_in_db) > 50:
        print(f"\n... and {len(affected_in_db) - 50} more")

    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")
    print(f"Total transactions in CSV with date mismatches: {len(mismatched_rows)}")
    print(f"Transactions in DATABASE affected by wrong parsing: {len(affected_in_db)}")
    print(f"\nTo fix: Delete these {len(affected_in_db)} transactions and re-import the CSV.")


def check_date_mismatches(csv_path: str):
    """Check for date mismatches between CSV and database."""
    # Load database transactions
    print("Loading transactions from database...")
    db_df = load_transactions_from_parquet(include_deleted=False)
    if db_df.empty:
        print("No transactions found in database.")
        return
    db_df["Date"] = pd.to_datetime(db_df["Date"])

    # Load CSV file
    print(f"Loading CSV file: {csv_path}")
    csv_df = pd.read_csv(csv_path)

    # Detect columns
    date_col = _detect_date_column(csv_df)
    if date_col is None:
        print(f"Could not find date column. Available columns: {csv_df.columns.tolist()}")
        return
    print(f"Using date column: {date_col}")

    merchant_col = _detect_merchant_column(csv_df)
    if merchant_col is None:
        print(f"Could not find merchant column. Available columns: {csv_df.columns.tolist()}")
        return
    print(f"Using merchant column: {merchant_col}")

    amount_col = _detect_amount_column(csv_df)
    if amount_col is None:
        print(f"Could not find amount column. Available columns: {csv_df.columns.tolist()}")
        return
    print()

    # Parse dates with both methods
    print("Parsing CSV dates with OLD method (dayfirst=True)...")
    csv_df["Date_Old"] = pd.to_datetime(csv_df[date_col], errors="coerce", dayfirst=True)

    print("Parsing CSV dates with NEW method (ISO first)...")
    csv_df["Date_New"] = csv_df[date_col].apply(_parse_date_new)

    # Find mismatches
    csv_df["Date_Mismatch"] = csv_df["Date_Old"] != csv_df["Date_New"]
    mismatched_rows = csv_df[csv_df["Date_Mismatch"]]

    if mismatched_rows.empty:
        print("✓ No date parsing mismatches found in CSV!")
        print("  All dates would be parsed the same way with both methods.")
        return

    _print_mismatch_summary(mismatched_rows, date_col, merchant_col)

    # Check database for affected transactions
    print(f"\n{'='*80}")
    print("Checking database for transactions with OLD (wrong) date parsing...")
    print(f"{'='*80}\n")

    affected_in_db = _find_affected_transactions(
        mismatched_rows, db_df, merchant_col, amount_col, date_col
    )
    _print_database_issues(affected_in_db, mismatched_rows)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python check_date_mismatches.py <path_to_csv>")
        print("\nExample:")
        print(
            "  python check_date_mismatches.py account-statement_2025-01-01_2025-11-05_en-gb_fb096e.csv"
        )
        sys.exit(1)

    csv_path = sys.argv[1]
    if not Path(csv_path).exists():
        print(f"Error: File not found: {csv_path}")
        sys.exit(1)

    check_date_mismatches(csv_path)
