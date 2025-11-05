import json
import logging
from typing import List, Dict, Any

import pandas as pd
import plaid
from plaid.api import plaid_api
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from expenses.config import CONFIG_DIR, PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV
from expenses.data_handler import (
    append_transactions,
    delete_transactions,
    _set_secure_permissions,
    _ensure_secure_config_dir,
)


PLAID_ITEMS_FILE = CONFIG_DIR / "plaid_items.json"


def _initialize_plaid_client() -> plaid_api.PlaidApi | None:
    """Initializes the Plaid client."""
    if not PLAID_CLIENT_ID or not PLAID_SECRET:
        logging.error("Plaid API keys not found.")
        return None

    host = getattr(plaid.Environment, PLAID_ENV.capitalize())
    configuration = plaid.Configuration(
        host=host,
        api_key={
            "clientId": PLAID_CLIENT_ID,
            "secret": PLAID_SECRET,
        },
    )
    api_client = plaid.ApiClient(configuration)
    return plaid_api.PlaidApi(api_client)


def load_plaid_items() -> List[Dict[str, Any]]:
    """
    Loads the Plaid items from the plaid_items.json file.

    Returns:
        A list of Plaid item dictionaries.
    """
    if not PLAID_ITEMS_FILE.exists():
        return []
    try:
        with open(PLAID_ITEMS_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logging.error(f"Error loading Plaid items: {e}")
        return []


def save_plaid_item(item: Dict[str, Any]) -> None:
    """
    Saves a new Plaid item to the plaid_items.json file.

    Args:
        item: A dictionary representing the Plaid item to save.
    """
    _ensure_secure_config_dir()
    items = load_plaid_items()

    # Add a transactions_cursor to the item
    item_to_save = item.copy()
    if "transactions_cursor" not in item_to_save:
        item_to_save["transactions_cursor"] = None

    items.append(item_to_save)
    try:
        with open(PLAID_ITEMS_FILE, "w") as f:
            json.dump(items, f, indent=4)
        _set_secure_permissions(PLAID_ITEMS_FILE)
        logging.debug(
            f"Successfully saved new Plaid item: {item_to_save.get('item_id')}"
        )
    except IOError as e:
        logging.error(f"Error saving Plaid item: {e}")


def update_plaid_item_cursor(item_id: str, cursor: str) -> None:
    """
    Updates the transactions_cursor for a given Plaid item.

    Args:
        item_id: The ID of the item to update.
        cursor: The new transactions cursor.
    """
    _ensure_secure_config_dir()
    items = load_plaid_items()
    for item in items:
        if item.get("item_id") == item_id:
            item["transactions_cursor"] = cursor
            break

    try:
        with open(PLAID_ITEMS_FILE, "w") as f:
            json.dump(items, f, indent=4)
        _set_secure_permissions(PLAID_ITEMS_FILE)
        logging.debug(f"Successfully updated cursor for item: {item_id}")
    except IOError as e:
        logging.error(f"Error updating cursor for item {item_id}: {e}")


def fetch_transactions(
    access_token: str, cursor: str | None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetches transactions from Plaid using the /transactions/sync endpoint.

    Args:
        access_token: The access token for the Plaid item.
        cursor: The cursor for the last sync, or None to fetch all transactions.

    Returns:
        A dictionary containing the added, modified, and removed transactions, and the next cursor.
    """
    plaid_client = _initialize_plaid_client()
    if not plaid_client:
        return {}

    added = []
    modified = []
    removed = []
    has_more = True
    next_cursor = cursor

    try:
        while has_more:
            # Build request parameters - only include cursor if it's not None
            request_params = {"access_token": access_token}
            if next_cursor is not None:
                request_params["cursor"] = next_cursor

            request = TransactionsSyncRequest(**request_params)
            response = plaid_client.transactions_sync(request).to_dict()

            added.extend(response.get("added", []))
            modified.extend(response.get("modified", []))
            removed.extend(response.get("removed", []))
            has_more = response.get("has_more", False)
            next_cursor = response.get("next_cursor")

        return {
            "added": added,
            "modified": modified,
            "removed": removed,
            "cursor": next_cursor,
        }

    except plaid.ApiException as e:
        logging.error(f"Error fetching Plaid transactions: {e}")
        return {}


def convert_plaid_transactions_to_dataframe(
    transactions: Dict[str, List[Dict[str, Any]]],
) -> pd.DataFrame | None:
    """
    Converts Plaid transactions to a DataFrame ready for import.

    Args:
        transactions: A dictionary containing the added, modified, and removed transactions.

    Returns:
        A DataFrame with Date, Merchant, Amount columns, or None if no transactions.
    """
    added = transactions.get("added", [])
    modified = transactions.get("modified", [])

    if not (added or modified):
        return None

    new_transactions = added + modified
    df = pd.DataFrame(new_transactions)

    # Plaid transactions have 'name' field for merchant, not 'merchant_name'
    if "merchant_name" in df.columns:
        merchant_col = "merchant_name"
    elif "name" in df.columns:
        merchant_col = "name"
    else:
        logging.error("No merchant field found in Plaid transactions")
        return None

    df = df[["date", merchant_col, "amount"]]
    df.columns = ["Date", "Merchant", "Amount"]
    df["Amount"] = -df[
        "Amount"
    ]  # Invert amount for expenses (Plaid returns positive for expenses)

    # Filter out non-expense transactions (credits)
    df = df[df["Amount"] > 0]

    if len(df) == 0:
        return None

    return df


def process_and_store_transactions(
    transactions: Dict[str, List[Dict[str, Any]]],
) -> None:
    """
    Processes and stores transactions fetched from Plaid.

    Args:
        transactions: A dictionary containing the added, modified, and removed transactions.
    """
    # Convert and store added/modified transactions
    df = convert_plaid_transactions_to_dataframe(transactions)
    if df is not None:
        append_transactions(df, suggest_categories=True)
        logging.info(f"Added/modified {len(df)} transactions from Plaid.")
    else:
        logging.info(
            "No expense transactions to add from Plaid (all were credits or no new transactions)."
        )

    # Process removed transactions
    removed = transactions.get("removed", [])
    if removed:
        removed_df = pd.DataFrame(removed)

        # Handle merchant field name
        if "merchant_name" in removed_df.columns:
            merchant_col = "merchant_name"
        elif "name" in removed_df.columns:
            merchant_col = "name"
        else:
            logging.error("No merchant field found in removed Plaid transactions")
            return

        removed_df = removed_df[["date", merchant_col, "amount"]]
        removed_df.columns = ["Date", "Merchant", "Amount"]
        removed_df["Amount"] = -removed_df["Amount"]
        delete_transactions(removed_df)
        logging.info(f"Removed {len(removed)} transactions from Plaid.")
