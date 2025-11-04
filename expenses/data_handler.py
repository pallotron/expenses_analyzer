import logging
import pandas as pd
import json
import importlib.resources
from pathlib import Path
from typing import Dict, List

from expenses.gemini_utils import get_gemini_category_suggestions_for_merchants
from expenses.config import (
    CONFIG_DIR,
    CATEGORIES_FILE,
    TRANSACTIONS_FILE,
    DEFAULT_CATEGORIES_FILE,
)


# --- Helper Functions ---
def _set_secure_permissions(file_path: Path) -> None:
    """Set file to user-read-write only (600) for security.

    On Unix-like systems, this prevents other users from reading sensitive data.
    On Windows, this may not have effect but won't cause errors.
    """
    try:
        file_path.chmod(0o600)
    except (OSError, PermissionError, NotImplementedError) as e:
        # Windows may not support Unix permissions - this is expected
        # On Unix systems, failure to set permissions is a security concern
        import platform
        if platform.system() != "Windows":
            logging.warning(
                f"Could not set secure permissions on {file_path}: {e}. "
                "File may be readable by other users."
            )


def _ensure_secure_config_dir() -> None:
    """Ensure config directory exists with secure permissions (700)."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        CONFIG_DIR.chmod(0o700)
    except (OSError, PermissionError, NotImplementedError) as e:
        import platform
        if platform.system() != "Windows":
            logging.warning(
                f"Could not set secure permissions on {CONFIG_DIR}: {e}. "
                "Directory may be accessible by other users."
            )


def clean_amount(amount_series: pd.Series) -> pd.Series:
    s = amount_series.astype(str)
    # Convert (amount) to -amount
    s = s.str.replace(r"\((.*)\)", r"-\1", regex=True)
    # Remove currency symbols and spaces
    s = s.str.replace(r"[€$£,\s]", "", regex=True)
    # Convert to numeric, coercing errors (e.g., '-' will become NaN)
    numeric_series = pd.to_numeric(s, errors="coerce")
    # Treat NaN (from '-' or other non-numeric values) as 0
    return numeric_series.fillna(0)


# --- Category Management ---
def load_categories() -> Dict[str, str]:
    if not CATEGORIES_FILE.exists():
        return {}
    with open(CATEGORIES_FILE, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}


def load_default_categories() -> List[str]:
    # User's custom default categories file takes precedence
    if DEFAULT_CATEGORIES_FILE.exists():
        with open(DEFAULT_CATEGORIES_FILE, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass  # Fallback to package default

    # If user file doesn't exist or is invalid, load from package
    try:
        ref = importlib.resources.files("expenses").joinpath("default_categories.json")
        with ref.open("r") as f:
            default_categories = json.load(f)
            # Copy it to user's config dir for first run
            try:
                with open(DEFAULT_CATEGORIES_FILE, "w") as user_f:
                    json.dump(default_categories, user_f, indent=4)
            except IOError:
                logging.warning(
                    "Could not save default categories to user config directory."
                )
            return default_categories
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_categories(categories: Dict[str, str]) -> None:
    _ensure_secure_config_dir()
    with open(CATEGORIES_FILE, "w") as f:
        json.dump(categories, f, indent=4)
    _set_secure_permissions(CATEGORIES_FILE)


# --- Transaction Loading & Saving ---
def load_transactions_from_parquet() -> pd.DataFrame:
    if not TRANSACTIONS_FILE.exists():
        return pd.DataFrame(columns=["Date", "Merchant", "Amount"])
    return pd.read_parquet(TRANSACTIONS_FILE)


def save_transactions_to_parquet(df: pd.DataFrame) -> None:
    _ensure_secure_config_dir()
    df.to_parquet(TRANSACTIONS_FILE, index=False)
    _set_secure_permissions(TRANSACTIONS_FILE)


def append_transactions(
    new_transactions: pd.DataFrame, suggest_categories: bool = False
) -> None:
    """Appends new transactions to the main parquet file, handling duplicates."""
    # Create auto-backup before modifying data
    from expenses.backup import create_auto_backup
    create_auto_backup()

    if suggest_categories:
        categories = load_categories()
        unique_new_merchants = new_transactions["Merchant"].unique()
        merchants_to_categorize = [
            m for m in unique_new_merchants if m not in categories
        ]

        if merchants_to_categorize:
            # Get all suggestions in a single API call
            suggested_categories = get_gemini_category_suggestions_for_merchants(
                merchants_to_categorize
            )
            # Update the main categories dictionary with the new suggestions
            if suggested_categories:
                categories.update(suggested_categories)
                save_categories(categories)

    existing_transactions = load_transactions_from_parquet()
    combined = pd.concat([existing_transactions, new_transactions], ignore_index=True)
    # Standardize data types before dropping duplicates
    combined["Date"] = pd.to_datetime(combined["Date"])
    combined["Amount"] = pd.to_numeric(combined["Amount"], errors="coerce").fillna(0.0)
    combined["Amount"] = combined["Amount"].round(2)
    combined["Merchant"] = combined["Merchant"].astype(str)

    # De-duplicate based on all columns
    combined.drop_duplicates(subset=["Date", "Merchant", "Amount"], inplace=True)
    save_transactions_to_parquet(combined)


def delete_transactions(transactions_to_delete: pd.DataFrame) -> None:
    """Deletes transactions from the main parquet file."""
    if transactions_to_delete.empty:
        return

    # Create auto-backup before deletion (critical operation)
    from expenses.backup import create_auto_backup
    create_auto_backup()

    existing_transactions = load_transactions_from_parquet()

    # Ensure dtypes are consistent before merge
    transactions_to_delete["Date"] = pd.to_datetime(transactions_to_delete["Date"])
    transactions_to_delete["Amount"] = pd.to_numeric(
        transactions_to_delete["Amount"], errors="coerce"
    ).fillna(0.0)
    transactions_to_delete["Amount"] = transactions_to_delete["Amount"].round(2)
    transactions_to_delete["Merchant"] = transactions_to_delete["Merchant"].astype(str)

    # Perform an anti-join to keep only the rows that are not in transactions_to_delete
    merged = pd.merge(
        existing_transactions,
        transactions_to_delete,
        on=["Date", "Merchant", "Amount"],
        how="left",
        indicator=True,
    )

    updated_transactions = merged[merged["_merge"] == "left_only"].drop(
        columns=["_merge"]
    )

    save_transactions_to_parquet(updated_transactions)
