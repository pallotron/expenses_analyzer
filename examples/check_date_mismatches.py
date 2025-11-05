#!/usr/bin/env python3
"""
Script to check for ALL date parsing mismatches by comparing database against source CSV.

This checks if transactions were imported with swapped month/day values.
"""

import pandas as pd
from pathlib import Path
import sys

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))

from expenses.data_handler import load_transactions_from_parquet


def check_date_mismatches(csv_path: str):
    """Check for date mismatches between CSV and database."""

    # Load database transactions
    print("Loading transactions from database...")
    db_df = load_transactions_from_parquet(include_deleted=False)

    if db_df.empty:
        print("No transactions found in database.")
        return

    db_df['Date'] = pd.to_datetime(db_df['Date'])

    # Load CSV file
    print(f"Loading CSV file: {csv_path}")
    csv_df = pd.read_csv(csv_path)

    # Detect date column (look for common names)
    date_col = None
    for col in csv_df.columns:
        if 'date' in col.lower() and 'start' not in col.lower():
            if date_col is None or 'completed' in col.lower():
                date_col = col

    if date_col is None:
        print(f"Could not find date column. Available columns: {csv_df.columns.tolist()}")
        return

    print(f"Using date column: {date_col}")

    # Detect merchant column
    merchant_col = None
    for col in csv_df.columns:
        if 'description' in col.lower() or 'merchant' in col.lower():
            merchant_col = col
            break

    if merchant_col is None:
        print(f"Could not find merchant column. Available columns: {csv_df.columns.tolist()}")
        return

    print(f"Using merchant column: {merchant_col}")

    # Detect amount column (handle both single Amount and Money In/Out columns)
    amount_col = None
    money_in_col = None
    money_out_col = None

    for col in csv_df.columns:
        if 'amount' in col.lower() and 'money' not in col.lower():
            amount_col = col
            break
        if 'money in' in col.lower():
            money_in_col = col
        if 'money out' in col.lower():
            money_out_col = col

    if amount_col:
        print(f"Using amount column: {amount_col}")
    elif money_in_col and money_out_col:
        print(f"Using amount columns: {money_in_col} and {money_out_col}")
        # Combine money in/out into a single amount column
        # Clean and convert both columns
        def clean_money(val):
            if pd.isna(val) or val == '-':
                return 0.0
            val_str = str(val).replace(',', '').replace('€', '').replace('$', '').replace('£', '').replace('-', '').strip()
            try:
                return float(val_str)
            except ValueError:
                return 0.0

        csv_df['Amount'] = csv_df[money_out_col].apply(clean_money)
        amount_col = 'Amount'
    else:
        print(f"Could not find amount column. Available columns: {csv_df.columns.tolist()}")
        return

    print()

    # Parse CSV dates with the OLD (wrong) method
    print("Parsing CSV dates with OLD method (dayfirst=True)...")
    csv_df['Date_Old'] = pd.to_datetime(csv_df[date_col], errors='coerce', dayfirst=True)

    # Parse CSV dates with the NEW (correct) method
    print("Parsing CSV dates with NEW method (ISO first)...")
    def parse_date_new(date_str):
        date_str = str(date_str).strip()
        date_val = pd.NaT

        # Strategy 1: Try ISO format first
        try:
            date_val = pd.to_datetime(date_str, format='ISO8601', errors='raise')
        except (ValueError, TypeError):
            # Strategy 2: Try pandas auto-detection without dayfirst
            try:
                date_val = pd.to_datetime(date_str, errors='raise')
            except (ValueError, TypeError):
                # Strategy 3: Try with dayfirst=True
                date_val = pd.to_datetime(date_str, errors='coerce', dayfirst=True)

        return date_val

    csv_df['Date_New'] = csv_df[date_col].apply(parse_date_new)

    # Find dates that differ between old and new parsing
    csv_df['Date_Mismatch'] = csv_df['Date_Old'] != csv_df['Date_New']
    mismatched_rows = csv_df[csv_df['Date_Mismatch']]

    if mismatched_rows.empty:
        print("✓ No date parsing mismatches found in CSV!")
        print("  All dates would be parsed the same way with both methods.")
        return

    print(f"\n{'='*80}")
    print(f"WARNING: Found {len(mismatched_rows)} transactions with date parsing differences!")
    print(f"{'='*80}\n")

    # Show the mismatches
    print("Transactions that were parsed differently:\n")
    print(f"{'Original Date':<25} {'OLD Parsing':<20} {'NEW Parsing':<20} {'Merchant':<30}")
    print("-" * 100)

    for idx, row in mismatched_rows.head(30).iterrows():
        original = str(row[date_col])[:24]
        old_date = row['Date_Old'].strftime('%Y-%m-%d') if pd.notna(row['Date_Old']) else 'NaT'
        new_date = row['Date_New'].strftime('%Y-%m-%d') if pd.notna(row['Date_New']) else 'NaT'
        merchant = str(row[merchant_col])[:29]
        print(f"{original:<25} {old_date:<20} {new_date:<20} {merchant:<30}")

    if len(mismatched_rows) > 30:
        print(f"\n... and {len(mismatched_rows) - 30} more")

    # Now check which dates in the database match the OLD (wrong) parsing
    print(f"\n{'='*80}")
    print("Checking database for transactions with OLD (wrong) date parsing...")
    print(f"{'='*80}\n")

    # For each mismatched row, check if it exists in DB with OLD date
    affected_in_db = []

    for idx, row in mismatched_rows.iterrows():
        merchant = str(row[merchant_col])
        # Clean the amount value
        amount_val = row[amount_col]
        try:
            amount = abs(float(str(amount_val).replace(',', '').replace('€', '').replace('$', '').replace('£', '')))
        except (ValueError, AttributeError):
            amount = 0.0
        old_date = row['Date_Old']
        new_date = row['Date_New']

        if pd.isna(old_date) or pd.isna(new_date):
            continue

        # Check if this transaction exists in DB with the OLD (wrong) date
        import re
        merchant_pattern = re.escape(merchant[:20])
        matches = db_df[
            (db_df['Merchant'].str.contains(merchant_pattern, case=False, na=False, regex=True)) &
            (abs(db_df['Amount'] - amount) < 0.01) &
            (db_df['Date'].dt.date == old_date.date())
        ]

        if not matches.empty:
            affected_in_db.append({
                'CSV_Date': str(row[date_col]),
                'DB_Date': matches.iloc[0]['Date'],
                'Correct_Date': new_date,
                'Merchant': merchant,
                'Amount': amount,
                'Source': matches.iloc[0].get('Source', 'Unknown')
            })

    if not affected_in_db:
        print("✓ No transactions found in database with wrong dates!")
        print("  Your database appears to be correct.")
        return

    print(f"Found {len(affected_in_db)} transactions in DATABASE with WRONG dates:\n")
    print(f"{'DB Date (WRONG)':<20} {'Should Be':<20} {'Merchant':<30} {'Amount':<10} {'Source'}")
    print("-" * 100)

    affected_df = pd.DataFrame(affected_in_db)
    for _, row in affected_df.head(50).iterrows():
        db_date = row['DB_Date'].strftime('%Y-%m-%d')
        correct_date = row['Correct_Date'].strftime('%Y-%m-%d')
        merchant = row['Merchant'][:29]
        amount = f"{row['Amount']:.2f}"
        source = row['Source']

        print(f"{db_date:<20} {correct_date:<20} {merchant:<30} {amount:<10} {source}")

    if len(affected_in_db) > 50:
        print(f"\n... and {len(affected_in_db) - 50} more")

    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")
    print(f"Total transactions in CSV with date mismatches: {len(mismatched_rows)}")
    print(f"Transactions in DATABASE affected by wrong parsing: {len(affected_in_db)}")
    print(f"\nTo fix: Delete these {len(affected_in_db)} transactions and re-import the CSV.")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python check_date_mismatches.py <path_to_csv>")
        print("\nExample:")
        print("  python check_date_mismatches.py account-statement_2025-01-01_2025-11-05_en-gb_fb096e.csv")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not Path(csv_path).exists():
        print(f"Error: File not found: {csv_path}")
        sys.exit(1)

    check_date_mismatches(csv_path)
