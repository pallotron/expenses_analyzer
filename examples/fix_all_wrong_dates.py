#!/usr/bin/env python3
"""
Script to delete ALL transactions imported from Revolut with wrong dates.

This will delete all Revolut transactions so you can re-import them with
the corrected date parsing.
"""

from pathlib import Path
from expenses.data_handler import load_transactions_from_parquet, delete_transactions
import sys

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))


def fix_revolut_dates():
    """Delete all Revolut transactions so they can be re-imported correctly."""
    print("Loading transactions from database...")
    df = load_transactions_from_parquet(include_deleted=False)

    if df.empty:
        print("No transactions found.")
        return

    # Find all Revolut transactions
    revolut_txns = df[df["Source"] == "Revolut"]

    if revolut_txns.empty:
        print("No Revolut transactions found in database.")
        return

    print(f"\nFound {len(revolut_txns)} Revolut transactions in database")
    print(f"\nDate range: {revolut_txns['Date'].min()} to {revolut_txns['Date'].max()}")

    # Show some samples
    print("\nSample transactions:")
    sample = revolut_txns[["Date", "Merchant", "Amount"]].head(10)
    print(sample.to_string(index=False))

    if len(revolut_txns) > 10:
        print(f"... and {len(revolut_txns) - 10} more")

    print("\n" + "=" * 80)
    print("WARNING: This will delete ALL Revolut transactions from your database!")
    print("=" * 80)
    print("\nYou will then need to:")
    print("1. Re-import your Revolut CSV file")
    print("2. The dates will be parsed correctly with the new import logic")
    print("\nA backup will be created automatically before deletion.")

    response = input(
        f"\nAre you sure you want to delete {len(revolut_txns)} Revolut transactions? (yes/no): "
    )
    if response.lower() != "yes":
        print("\nAborted. No changes made.")
        return

    print("\nDeleting Revolut transactions...")
    delete_transactions(revolut_txns)

    print(f"\n✓ Successfully deleted {len(revolut_txns)} Revolut transactions")

    # Show remaining transaction count
    df_after = load_transactions_from_parquet(include_deleted=False)
    print(f"\nRemaining transactions in database: {len(df_after)}")

    if len(df_after) > 0:
        print(f"Sources: {df_after['Source'].value_counts().to_dict()}")

    print("\nNow you can re-import your Revolut CSV file:")
    print("  uv run expenses-analyzer")
    print("  Press 'i' for Import")
    print("  Select your Revolut CSV file")


if __name__ == "__main__":
    fix_revolut_dates()
