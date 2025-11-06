#!/usr/bin/env python3
"""
A utility script to find and optionally delete transactions from the same
merchant with the same amount on the same day but from different sources.

This script helps identify and clean up potential duplicate transactions that
might have been imported from multiple sources (e.g., a CSV file and a
Plaid/TrueLayer sync). Deletion is a soft-delete, meaning transactions are
marked as 'Deleted' but not permanently removed from the data file.
"""

import pandas as pd
import sys
from pathlib import Path

# Add the project root to the Python path to allow importing from 'expenses'
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from expenses.data_handler import (  # noqa: E402
    load_transactions_from_parquet,
    delete_transactions,
    load_merchant_aliases,
    apply_merchant_aliases_to_series,
)

# --- Deletion Strategy ---
# Define a priority for which source to keep when duplicates are found.
# Lower numbers have higher priority (i.e., will be kept).
SOURCE_PRIORITY = {
    "Plaid": 1,
    "TrueLayer": 2,
    "CSV Import": 3,
    "Manual": 4,
    "Unknown": 99,
}


def get_source_priority(source: str) -> int:
    """Returns the priority of a source string."""
    for key, priority in SOURCE_PRIORITY.items():
        if key in source:
            return priority
    return SOURCE_PRIORITY["Unknown"]


def find_and_delete_cross_source_duplicates():
    """
    Finds and allows for soft-deletion of transactions that are potential
    duplicates across different sources, checking for matches within a
    +/- 1 day window and using merchant aliases.
    """
    print("Loading all transactions (including soft-deleted)...")
    all_transactions = load_transactions_from_parquet(include_deleted=True)

    if all_transactions.empty:
        print("No transactions found.")
        return

    print("Loading merchant aliases...")
    aliases = load_merchant_aliases()
    if not aliases:
        print("No merchant aliases found. Grouping by original merchant name.")
        all_transactions["DisplayMerchant"] = all_transactions["Merchant"]
    else:
        print(f"Applying {len(aliases)} merchant aliases...")
        all_transactions["DisplayMerchant"] = apply_merchant_aliases_to_series(
            all_transactions["Merchant"], aliases
        )

    all_transactions["Date"] = pd.to_datetime(all_transactions["Date"]).dt.date
    print(
        "Identifying potential duplicates based on Aliased Merchant, Amount, "
        "and a +/- 1 day window..."
    )

    # Group by the aliased merchant and amount
    grouped = all_transactions.groupby(["DisplayMerchant", "Amount"])
    transactions_to_delete = []

    for _, group in grouped:
        if len(group) < 2:
            continue

        # Sort by date to compare adjacent transactions
        sorted_group = group.sort_values("Date").reset_index(drop=True)

        cluster = []
        for i in range(len(sorted_group)):
            if not cluster:
                cluster.append(sorted_group.loc[i])
                continue

            date_diff = (sorted_group.loc[i, "Date"] - cluster[-1]["Date"]).days
            if date_diff <= 1:
                cluster.append(sorted_group.loc[i])
            else:
                process_duplicate_cluster(cluster, transactions_to_delete)
                cluster = [sorted_group.loc[i]]

        process_duplicate_cluster(cluster, transactions_to_delete)

    if not transactions_to_delete:
        print("\nNo actionable cross-source duplicates found.")
        return

    # --- Confirmation and Deletion ---
    print(f"\nFound {len(transactions_to_delete)} transaction(s) to soft-delete.")
    to_delete_df = pd.DataFrame(transactions_to_delete)

    print("The following transactions will be marked as deleted:")
    print(to_delete_df[["Date", "Merchant", "Amount", "Source"]].to_string(index=False))

    confirm = input("\nAre you sure you want to proceed? (y/N): ")
    if confirm.lower() == "y":
        print("Soft-deleting transactions...")
        delete_transactions(to_delete_df[["Date", "Merchant", "Amount", "Source"]])
        print("Done.")
    else:
        print("Deletion cancelled.")


def process_duplicate_cluster(cluster, transactions_to_delete):
    """
    Processes a cluster of potential duplicates, identifies which to keep/delete,
    and adds them to the transactions_to_delete list.
    """
    if len(cluster) < 2:
        return

    cluster_df = pd.DataFrame(cluster)
    active_transactions = cluster_df[~cluster_df["Deleted"]]

    if len(active_transactions) > 1 and active_transactions["Source"].nunique() > 1:
        active_transactions["priority"] = active_transactions["Source"].apply(
            get_source_priority
        )
        sorted_cluster = active_transactions.sort_values(by="priority")

        transaction_to_keep = sorted_cluster.iloc[0]

        print("\n" + "=" * 80)
        print(
            f"Potential duplicate cluster for '{transaction_to_keep['DisplayMerchant']}' "
            f"for amount {transaction_to_keep['Amount']:.2f} around {transaction_to_keep['Date']}"
        )

        # --- Display details of all transactions in the cluster for context ---
        print("--- Transactions in Cluster ---")
        print(
            sorted_cluster[
                ["Date", "Merchant", "DisplayMerchant", "Source", "priority"]
            ].to_string(index=False)
        )
        print("--- Decision ---")

        print(
            f"KEPT:    Date: {transaction_to_keep['Date']}, "
            f"Original Merchant: '{transaction_to_keep['Merchant']}', "
            f"Source: '{transaction_to_keep['Source']}'"
        )

        for _, row_to_delete in sorted_cluster.iloc[1:].iterrows():
            transactions_to_delete.append(row_to_delete)
            print(
                f"DELETE:  Date: {row_to_delete['Date']}, "
                f"Original Merchant: '{row_to_delete['Merchant']}', "
                f"Source: '{row_to_delete['Source']}'"
            )
        print("=" * 80)


if __name__ == "__main__":
    find_and_delete_cross_source_duplicates()
