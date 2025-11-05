#!/usr/bin/env python3
"""
Script to fix incorrectly parsed December 2025 dates.

This script finds transactions that were incorrectly parsed as December 2025
(when they should be January 2025) and deletes them so they can be re-imported.
"""

import pandas as pd
from pathlib import Path
import sys

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))

from expenses.data_handler import load_transactions_from_parquet, delete_transactions
from expenses.config import TRANSACTIONS_FILE


def fix_december_dates():
    """Delete incorrectly parsed December 2025 transactions."""
    print("Loading transactions...")
    df = load_transactions_from_parquet(include_deleted=False)

    if df.empty:
        print("No transactions found.")
        return

    df['Date'] = pd.to_datetime(df['Date'])

    # Find December 2025 transactions
    dec_2025 = df[df['Date'].dt.to_period('M') == '2025-12']

    if dec_2025.empty:
        print("No December 2025 transactions found. Nothing to fix.")
        return

    print(f"\nFound {len(dec_2025)} December 2025 transactions:")
    print(dec_2025[['Date', 'Merchant', 'Amount', 'Source']])

    response = input(f"\nDo you want to delete these {len(dec_2025)} transactions? (yes/no): ")
    if response.lower() != 'yes':
        print("Aborted.")
        return

    print("\nDeleting transactions...")
    delete_transactions(dec_2025)

    print(f"\nSuccessfully deleted {len(dec_2025)} transactions.")
    print("\nYou can now re-import your Revolut CSV and the dates will be parsed correctly.")

    # Show current transaction count
    df_after = load_transactions_from_parquet(include_deleted=False)
    print(f"\nCurrent transaction count: {len(df_after)}")


if __name__ == '__main__':
    fix_december_dates()
