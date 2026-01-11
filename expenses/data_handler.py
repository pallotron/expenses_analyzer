import logging
import pandas as pd
import json
import importlib.resources
import re
from pathlib import Path
from typing import Dict, List, Optional

from expenses.backup import create_auto_backup
from expenses.gemini_utils import get_gemini_category_suggestions_for_merchants
from expenses.validation import validate_transaction_dataframe
from expenses.config import (
    CONFIG_DIR,
    CATEGORIES_FILE,
    TRANSACTIONS_FILE,
    DEFAULT_CATEGORIES_FILE,
    MERCHANT_ALIASES_FILE,
)

# Global flag to track if corruption was detected (for TUI notification)
_corruption_detected: Optional[str] = None


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
    """Load merchant-to-category mappings from JSON file.

    Returns:
        Dictionary mapping merchant names to categories, or empty dict if file
        doesn't exist or is corrupted.
    """
    if not CATEGORIES_FILE.exists():
        return {}

    try:
        with open(CATEGORIES_FILE, "r") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logging.warning(
            f"Categories file is corrupted (invalid JSON): {e}. "
            "Returning empty categories. Consider restoring from backup."
        )
        return {}
    except (OSError, IOError) as e:
        logging.warning(
            f"Could not read categories file: {e}. " "Returning empty categories."
        )
        return {}


def load_default_categories(transaction_type: str = None) -> List[str]:
    """Load default categories from JSON file.

    Args:
        transaction_type: If specified ("expense" or "income"), returns only categories
                         for that type. If None, returns all categories combined.

    Returns:
        List of category names.
    """
    categories_data = None

    # User's custom default categories file takes precedence
    if DEFAULT_CATEGORIES_FILE.exists():
        with open(DEFAULT_CATEGORIES_FILE, "r") as f:
            try:
                categories_data = json.load(f)
            except json.JSONDecodeError:
                pass  # Fallback to package default

    # If user file doesn't exist or is invalid, load from package
    if categories_data is None:
        try:
            ref = importlib.resources.files("expenses").joinpath("default_categories.json")
            with ref.open("r") as f:
                categories_data = json.load(f)
                # Copy it to user's config dir for first run
                try:
                    with open(DEFAULT_CATEGORIES_FILE, "w") as user_f:
                        json.dump(categories_data, user_f, indent=4)
                except IOError:
                    logging.warning(
                        "Could not save default categories to user config directory."
                    )
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    # Handle both old format (list) and new format (dict with expense/income keys)
    if isinstance(categories_data, list):
        # Old format: list of categories (all are expense categories)
        if transaction_type == "income":
            return []  # No income categories in old format
        return categories_data
    elif isinstance(categories_data, dict):
        # New format: dict with "expense" and "income" keys
        if transaction_type == "expense":
            return categories_data.get("expense", [])
        elif transaction_type == "income":
            return categories_data.get("income", [])
        else:
            # Return all categories combined
            return categories_data.get("expense", []) + categories_data.get("income", [])

    return []


def save_categories(categories: Dict[str, str]) -> None:
    _ensure_secure_config_dir()
    with open(CATEGORIES_FILE, "w") as f:
        json.dump(categories, f, indent=4)
    _set_secure_permissions(CATEGORIES_FILE)


# --- Merchant Alias Management ---
def load_merchant_aliases() -> Dict[str, str]:
    """Load merchant alias patterns from JSON file.

    The file format is: {"regex_pattern": "display_alias"}
    For example: {"POS APPLE\\.COM/BI.*": "Apple", "AMAZON.*": "Amazon"}

    Returns:
        Dictionary mapping regex patterns to display aliases, or empty dict if file
        doesn't exist or is corrupted.
    """
    if not MERCHANT_ALIASES_FILE.exists():
        return {}

    try:
        with open(MERCHANT_ALIASES_FILE, "r") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logging.warning(
            f"Merchant aliases file is corrupted (invalid JSON): {e}. "
            "Returning empty aliases. Consider restoring from backup."
        )
        return {}
    except (OSError, IOError) as e:
        logging.warning(
            f"Could not read merchant aliases file: {e}. " "Returning empty aliases."
        )
        return {}


def save_merchant_aliases(aliases: Dict[str, str]) -> None:
    """Save merchant alias patterns to JSON file.

    Args:
        aliases: Dictionary mapping regex patterns to display aliases
    """
    _ensure_secure_config_dir()
    with open(MERCHANT_ALIASES_FILE, "w") as f:
        json.dump(aliases, f, indent=4)
    _set_secure_permissions(MERCHANT_ALIASES_FILE)
    logging.info(f"Saved {len(aliases)} merchant alias patterns")


def apply_merchant_alias(merchant_name: str, aliases: Dict[str, str]) -> str:
    """Apply merchant alias based on regex pattern matching.

    Args:
        merchant_name: Original merchant name from transaction
        aliases: Dictionary mapping regex patterns to display aliases

    Returns:
        Display alias if a pattern matches, otherwise the original merchant name
    """
    if not merchant_name or not aliases:
        return merchant_name

    # Try each pattern in order (patterns are checked in dict order)
    for pattern, alias in aliases.items():
        try:
            if re.search(pattern, merchant_name, re.IGNORECASE):
                return alias
        except re.error as e:
            logging.warning(
                f"Invalid regex pattern '{pattern}' in merchant aliases: {e}"
            )
            continue

    return merchant_name


def apply_merchant_aliases_to_series(
    merchant_series: pd.Series, aliases: Dict[str, str]
) -> pd.Series:
    """Apply merchant aliases to a pandas Series of merchant names.

    Args:
        merchant_series: Series containing merchant names
        aliases: Dictionary mapping regex patterns to display aliases

    Returns:
        Series with aliases applied
    """
    if not aliases:
        return merchant_series

    return merchant_series.apply(lambda x: apply_merchant_alias(x, aliases))


# --- Transaction Loading & Saving ---
def load_transactions_from_parquet(include_deleted: bool = False) -> pd.DataFrame:
    """Load transactions from parquet file with corruption detection.

    Args:
        include_deleted: If True, include soft-deleted transactions. Default False.

    Returns:
        DataFrame with transactions, or empty DataFrame if file doesn't exist
        or is corrupted. By default, excludes soft-deleted transactions.

    Note:
        If corruption is detected, logs a warning suggesting backup restoration.
        The application will continue with an empty DataFrame rather than crashing.
        Sets global _corruption_detected flag for TUI notification.
    """
    global _corruption_detected

    if not TRANSACTIONS_FILE.exists():
        return pd.DataFrame(columns=["Date", "Merchant", "Amount", "Source", "Deleted", "Type"])

    try:
        df = pd.read_parquet(TRANSACTIONS_FILE)

        # Add Source column if it doesn't exist (backward compatibility)
        if "Source" not in df.columns:
            df["Source"] = "Unknown"

        # Add Deleted column if it doesn't exist (backward compatibility)
        if "Deleted" not in df.columns:
            df["Deleted"] = False

        # Add Type column if it doesn't exist (backward compatibility for cash flow support)
        if "Type" not in df.columns:
            df["Type"] = "expense"  # Default existing transactions to expense

        # Filter out soft-deleted transactions unless explicitly requested
        if not include_deleted:
            df = df[~df["Deleted"]].copy()

        return df
    except Exception as e:
        # Catch all parquet-related errors: ArrowInvalid, OSError, etc.
        error_msg = f"Transactions file corrupted: {type(e).__name__}"
        logging.error(
            f"CRITICAL: Transactions file is corrupted and cannot be read: {e}. "
            f"File: {TRANSACTIONS_FILE}. "
            "Starting with empty transaction list. "
            "You may be able to restore from auto-backup using the backup module."
        )
        # Set flag for TUI to display notification
        _corruption_detected = error_msg
        # Return empty DataFrame to allow application to continue
        return pd.DataFrame(columns=["Date", "Merchant", "Amount", "Source", "Deleted", "Type"])


def check_and_clear_corruption_flag() -> Optional[str]:
    """Check if corruption was detected and clear the flag.

    Returns:
        Error message if corruption was detected, None otherwise.
        This is a one-time check - the flag is cleared after reading.
    """
    global _corruption_detected
    msg = _corruption_detected
    _corruption_detected = None
    return msg


def save_transactions_to_parquet(df: pd.DataFrame) -> None:
    """Save transactions to parquet file.

    Args:
        df: DataFrame to save

    Note:
        Validation should be done before calling this function (e.g., in append_transactions).
        This function assumes the data is already validated.
    """
    _ensure_secure_config_dir()
    df.to_parquet(TRANSACTIONS_FILE, index=False)
    _set_secure_permissions(TRANSACTIONS_FILE)
    logging.debug(f"Saved {len(df)} transactions to {TRANSACTIONS_FILE}")


def append_transactions(
    new_transactions: pd.DataFrame,
    suggest_categories: bool = False,
    source: str = "Manual",
) -> None:
    """Appends new transactions to the main parquet file, handling duplicates.

    Args:
        new_transactions: DataFrame of new transactions to append
        suggest_categories: Whether to use AI to suggest categories for new merchants
        source: Source identifier for the transactions (e.g., "Plaid - Chase Bank", "CSV Import")

    Raises:
        ValidationError: If new_transactions fails validation
    """
    # Validate new transactions before appending
    validate_transaction_dataframe(new_transactions)

    # Create auto-backup before modifying data
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

    # Load existing transactions (including deleted ones to preserve soft-delete state)
    existing_transactions = load_transactions_from_parquet(include_deleted=True)

    # Add Source column to new transactions if not present
    if "Source" not in new_transactions.columns:
        new_transactions["Source"] = source

    # Add Deleted column to new transactions if not present
    if "Deleted" not in new_transactions.columns:
        new_transactions["Deleted"] = False

    # Add Type column to new transactions if not present (default to expense)
    if "Type" not in new_transactions.columns:
        new_transactions["Type"] = "expense"

    # Standardize data types before merging
    existing_transactions["Date"] = pd.to_datetime(existing_transactions["Date"])
    existing_transactions["Amount"] = pd.to_numeric(
        existing_transactions["Amount"], errors="coerce"
    ).fillna(0.0)
    existing_transactions["Amount"] = existing_transactions["Amount"].round(2)
    existing_transactions["Merchant"] = existing_transactions["Merchant"].astype(str)
    existing_transactions["Type"] = existing_transactions["Type"].astype(str)

    new_transactions["Date"] = pd.to_datetime(new_transactions["Date"])
    new_transactions["Amount"] = pd.to_numeric(
        new_transactions["Amount"], errors="coerce"
    ).fillna(0.0)
    new_transactions["Amount"] = new_transactions["Amount"].round(2)
    new_transactions["Merchant"] = new_transactions["Merchant"].astype(str)
    new_transactions["Type"] = new_transactions["Type"].astype(str)

    # --- Filter out new transactions that match soft-deleted ones ---
    deleted_mask = existing_transactions["Deleted"]
    if deleted_mask.any():
        deleted_transactions = existing_transactions[deleted_mask]
        # Create a set of (Date, Merchant, Amount) tuples for efficient lookup
        deleted_keys = set(
            zip(
                deleted_transactions["Date"].dt.date,
                deleted_transactions["Merchant"],
                deleted_transactions["Amount"],
            )
        )

        initial_count = len(new_transactions)
        # Create a boolean mask to identify rows to keep
        keep_mask = ~new_transactions.apply(
            lambda row: (
                row["Date"].date(),
                row["Merchant"],
                row["Amount"],
            )
            in deleted_keys,
            axis=1,
        )
        new_transactions = new_transactions[keep_mask]
        final_count = len(new_transactions)

        if initial_count > final_count:
            num_filtered = initial_count - final_count
            logging.info(
                f"Filtered out {num_filtered} new transactions that match "
                "previously soft-deleted records."
            )

    # Now combine and deduplicate
    combined = pd.concat([existing_transactions, new_transactions], ignore_index=True)

    # De-duplicate based on Date, Merchant, Amount (keep first occurrence)
    # This prevents the same transaction from being imported multiple times, regardless of source
    # It also handles cases where a transaction is re-imported after being restored.
    combined.drop_duplicates(
        subset=["Date", "Merchant", "Amount"], keep="first", inplace=True
    )
    save_transactions_to_parquet(combined)


def soft_delete_transactions(transaction_ids: List[int]) -> None:
    """Soft-deletes transactions by their unique IDs."""
    if not transaction_ids:
        return
    all_transactions = load_transactions_from_parquet(include_deleted=True)
    if "TransactionID" not in all_transactions.columns:
        all_transactions["TransactionID"] = all_transactions.index

    all_transactions.loc[
        all_transactions["TransactionID"].isin(transaction_ids), "Deleted"
    ] = True
    save_transactions_to_parquet(all_transactions)
    logging.info(f"Soft-deleted {len(transaction_ids)} transaction(s).")


def delete_transactions(transactions_to_delete: pd.DataFrame) -> None:
    """Soft-deletes transactions by marking them as deleted.

    Transactions are not physically removed from the file, but are marked
    with Deleted=True and will be filtered out of normal queries.

    Args:
        transactions_to_delete: DataFrame with transactions to soft-delete
    """
    if transactions_to_delete.empty:
        return

    # Create auto-backup before deletion (critical operation)
    create_auto_backup()

    # Load ALL transactions including already soft-deleted ones
    all_transactions = load_transactions_from_parquet(include_deleted=True)

    # Ensure dtypes are consistent before merge
    transactions_to_delete["Date"] = pd.to_datetime(transactions_to_delete["Date"])
    transactions_to_delete["Amount"] = pd.to_numeric(
        transactions_to_delete["Amount"], errors="coerce"
    ).fillna(0.0)
    transactions_to_delete["Amount"] = transactions_to_delete["Amount"].round(2)
    transactions_to_delete["Merchant"] = transactions_to_delete["Merchant"].astype(str)

    # Normalize all_transactions to match data types
    all_transactions["Date"] = pd.to_datetime(all_transactions["Date"])
    all_transactions["Amount"] = pd.to_numeric(
        all_transactions["Amount"], errors="coerce"
    ).fillna(0.0)
    all_transactions["Amount"] = all_transactions["Amount"].round(2)
    all_transactions["Merchant"] = all_transactions["Merchant"].astype(str)

    # Mark transactions as deleted by merging and setting Deleted=True
    # Use indicator to identify which rows to mark as deleted
    merged = pd.merge(
        all_transactions,
        transactions_to_delete[["Date", "Merchant", "Amount"]],
        on=["Date", "Merchant", "Amount"],
        how="left",
        indicator=True,
    )

    # Set Deleted=True for matched rows
    merged.loc[merged["_merge"] == "both", "Deleted"] = True
    updated_transactions = merged.drop(columns=["_merge"])

    num_deleted = updated_transactions["Deleted"].sum()
    logging.info(f"Soft-deleted {num_deleted} transactions")

    save_transactions_to_parquet(updated_transactions)


def restore_deleted_transactions(transactions_to_restore: pd.DataFrame) -> None:
    """Restore soft-deleted transactions by setting Deleted=False.

    Args:
        transactions_to_restore: DataFrame with transactions to restore
    """
    if transactions_to_restore.empty:
        return

    # Create auto-backup before modification
    create_auto_backup()

    # Load ALL transactions including soft-deleted ones
    all_transactions = load_transactions_from_parquet(include_deleted=True)

    # Ensure dtypes are consistent before merge
    transactions_to_restore["Date"] = pd.to_datetime(transactions_to_restore["Date"])
    transactions_to_restore["Amount"] = pd.to_numeric(
        transactions_to_restore["Amount"], errors="coerce"
    ).fillna(0.0)
    transactions_to_restore["Amount"] = transactions_to_restore["Amount"].round(2)
    transactions_to_restore["Merchant"] = transactions_to_restore["Merchant"].astype(
        str
    )

    # Normalize all_transactions to match data types
    all_transactions["Date"] = pd.to_datetime(all_transactions["Date"])
    all_transactions["Amount"] = pd.to_numeric(
        all_transactions["Amount"], errors="coerce"
    ).fillna(0.0)
    all_transactions["Amount"] = all_transactions["Amount"].round(2)
    all_transactions["Merchant"] = all_transactions["Merchant"].astype(str)

    # Mark transactions as NOT deleted by merging and setting Deleted=False
    merged = pd.merge(
        all_transactions,
        transactions_to_restore[["Date", "Merchant", "Amount"]],
        on=["Date", "Merchant", "Amount"],
        how="left",
        indicator=True,
    )

    # Set Deleted=False for matched rows
    merged.loc[merged["_merge"] == "both", "Deleted"] = False
    updated_transactions = merged.drop(columns=["_merge"])

    num_restored = (merged["_merge"] == "both").sum()
    logging.info(f"Restored {num_restored} soft-deleted transactions")

    save_transactions_to_parquet(updated_transactions)
