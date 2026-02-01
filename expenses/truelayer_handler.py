import json
import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta

import pandas as pd
import requests

from expenses.config import (
    CONFIG_DIR,
    TRUELAYER_CLIENT_ID,
    TRUELAYER_CLIENT_SECRET,
    TRUELAYER_ENV,
)
from expenses.data_handler import (
    append_transactions,
    _set_secure_permissions,
    _ensure_secure_config_dir,
)


TRUELAYER_CONNECTIONS_FILE = CONFIG_DIR / "truelayer_connections.json"


class ScaExceededError(Exception):
    """Custom exception for SCA exemption expired errors."""

    pass


# TrueLayer API endpoints
def _get_api_base_url() -> str:
    """Returns the appropriate TrueLayer API base URL based on environment."""
    if TRUELAYER_ENV == "production":
        return "https://api.truelayer.com"
    return "https://api.truelayer-sandbox.com"


def _get_auth_base_url() -> str:
    """Returns the appropriate TrueLayer Auth base URL based on environment."""
    if TRUELAYER_ENV == "production":
        return "https://auth.truelayer.com"
    return "https://auth.truelayer-sandbox.com"


def _initialize_truelayer_session() -> requests.Session | None:
    """Initializes a requests session for TrueLayer API calls."""
    if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
        logging.error("TrueLayer API credentials not found.")
        return None

    session = requests.Session()
    session.headers.update(
        {
            "Content-Type": "application/json",
        }
    )
    return session


def load_truelayer_connections() -> List[Dict[str, Any]]:
    """
    Loads the TrueLayer connections from the truelayer_connections.json file.

    Returns:
        A list of TrueLayer connection dictionaries.
    """
    if not TRUELAYER_CONNECTIONS_FILE.exists():
        return []
    try:
        with open(TRUELAYER_CONNECTIONS_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logging.error(f"Error loading TrueLayer connections: {e}")
        return []


def save_truelayer_connection(connection: Dict[str, Any]) -> None:
    """
    Saves a new TrueLayer connection to the truelayer_connections.json file.

    Args:
        connection: A dictionary representing the TrueLayer connection to save.
    """
    _ensure_secure_config_dir()
    connections = load_truelayer_connections()

    # Add metadata to the connection
    connection_to_save = connection.copy()
    if "last_sync" not in connection_to_save:
        connection_to_save["last_sync"] = None
    if "created_at" not in connection_to_save:
        connection_to_save["created_at"] = datetime.now().isoformat()

    connections.append(connection_to_save)
    try:
        with open(TRUELAYER_CONNECTIONS_FILE, "w") as f:
            json.dump(connections, f, indent=4)
        _set_secure_permissions(TRUELAYER_CONNECTIONS_FILE)
        logging.debug(
            f"Successfully saved new TrueLayer connection: {connection_to_save.get('provider_id')}"
        )
    except IOError as e:
        logging.error(f"Error saving TrueLayer connection: {e}")


def update_truelayer_connection(updated_connection: Dict[str, Any]) -> None:
    """
    Updates an existing TrueLayer connection in the connections file.

    Args:
        updated_connection: The connection dictionary with updated values.
    """
    _ensure_secure_config_dir()
    connections = load_truelayer_connections()
    connection_id = updated_connection.get("connection_id")

    if not connection_id:
        logging.error("Cannot update connection without a connection_id.")
        return

    found = False
    for i, connection in enumerate(connections):
        if connection.get("connection_id") == connection_id:
            connections[i] = updated_connection
            found = True
            break

    if not found:
        logging.warning(
            f"Connection with ID {connection_id} not found for update. Appending."
        )
        connections.append(updated_connection)

    try:
        with open(TRUELAYER_CONNECTIONS_FILE, "w") as f:
            json.dump(connections, f, indent=4)
        _set_secure_permissions(TRUELAYER_CONNECTIONS_FILE)
        logging.debug(f"Successfully updated TrueLayer connection: {connection_id}")
    except IOError as e:
        logging.error(f"Error updating TrueLayer connection {connection_id}: {e}")


def update_connection_last_sync(connection_ids: List[str]) -> None:
    """
    Updates the last_sync timestamp for given TrueLayer connections.

    Args:
        connection_ids: A list of connection IDs to update.
    """
    _ensure_secure_config_dir()
    connections = load_truelayer_connections()
    updated_count = 0
    for connection in connections:
        if connection.get("connection_id") in connection_ids:
            connection["last_sync"] = datetime.now().isoformat()
            updated_count += 1

    try:
        with open(TRUELAYER_CONNECTIONS_FILE, "w") as f:
            json.dump(connections, f, indent=4)
        _set_secure_permissions(TRUELAYER_CONNECTIONS_FILE)
        logging.debug(
            f"Successfully updated last_sync for {updated_count} connection(s)."
        )
    except IOError as e:
        logging.error(f"Error updating last_sync for connections: {e}")


def remove_truelayer_connection(connection_id: str) -> None:
    """
    Removes a specific TrueLayer connection from the connections file.

    Args:
        connection_id: The ID of the connection to remove.
    """
    _ensure_secure_config_dir()
    connections = load_truelayer_connections()
    updated_connections = [
        conn for conn in connections if conn.get("connection_id") != connection_id
    ]

    if len(connections) == len(updated_connections):
        logging.warning(f"Connection with ID {connection_id} not found for removal.")
        return

    try:
        with open(TRUELAYER_CONNECTIONS_FILE, "w") as f:
            json.dump(updated_connections, f, indent=4)
        _set_secure_permissions(TRUELAYER_CONNECTIONS_FILE)
        logging.info(f"Successfully removed TrueLayer connection: {connection_id}")
    except IOError as e:
        logging.error(f"Error removing TrueLayer connection {connection_id}: {e}")


def exchange_code_for_token(code: str, redirect_uri: str) -> Dict[str, Any] | None:
    """
    Exchanges an authorization code for access and refresh tokens.

    Args:
        code: The authorization code from TrueLayer OAuth callback.
        redirect_uri: The redirect URI used in the initial authorization.

    Returns:
        A dictionary containing access_token, refresh_token, and expires_in, or None on error.
    """
    session = _initialize_truelayer_session()
    if not session:
        return None

    auth_url = f"{_get_auth_base_url()}/connect/token"
    data = {
        "grant_type": "authorization_code",
        "client_id": TRUELAYER_CLIENT_ID,
        "client_secret": TRUELAYER_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "code": code,
    }

    try:
        # Use form-encoded data (application/x-www-form-urlencoded)
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        logging.info(f"Exchanging code for token at: {auth_url}")
        logging.info(f"Using client_id: {TRUELAYER_CLIENT_ID}")
        response = session.post(auth_url, data=data, headers=headers)
        response.raise_for_status()
        token_data = response.json()
        return {
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in", 3600),
            "token_obtained_at": datetime.now().isoformat(),
        }
    except requests.exceptions.RequestException as e:
        logging.error(f"Error exchanging code for token: {e}")
        if hasattr(e, "response") and e.response is not None:
            logging.error(f"Response: {e.response.text}")
            logging.error(
                "Verify your TRUELAYER_CLIENT_SECRET matches your "
                + f"production CLIENT_ID: {TRUELAYER_CLIENT_ID}"
            )
        return None


def refresh_access_token(refresh_token: str) -> Dict[str, Any] | None:
    """
    Refreshes an access token using a refresh token.

    Args:
        refresh_token: The refresh token.

    Returns:
        A dictionary containing the new access_token and expires_in, or None on error.
    """
    session = _initialize_truelayer_session()
    if not session:
        return None

    auth_url = f"{_get_auth_base_url()}/connect/token"
    data = {
        "grant_type": "refresh_token",
        "client_id": TRUELAYER_CLIENT_ID,
        "client_secret": TRUELAYER_CLIENT_SECRET,
        "refresh_token": refresh_token,
    }

    try:
        # Use form-encoded data (application/x-www-form-urlencoded)
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        response = session.post(auth_url, data=data, headers=headers)
        response.raise_for_status()
        token_data = response.json()
        return {
            "access_token": token_data.get("access_token"),
            "expires_in": token_data.get("expires_in", 3600),
            "token_obtained_at": datetime.now().isoformat(),
        }
    except requests.exceptions.RequestException as e:
        logging.error(f"Error refreshing access token: {e}")
        if hasattr(e, "response") and e.response is not None:
            logging.error(f"Response: {e.response.text}")
            # Check for invalid_grant error, which may indicate expired consent
            if e.response.status_code == 400:
                try:
                    error_data = e.response.json()
                    if error_data.get("error") == "invalid_grant":
                        raise ScaExceededError(
                            f"Permissions expired, re-authentication required. Response: {e.response.text}"
                        )
                except json.JSONDecodeError:
                    pass  # Not a JSON response, proceed with returning None
        return None


def get_valid_access_token(connection: Dict[str, Any]) -> str | None:
    """
    Checks if the access token is expired and refreshes it if needed.

    Args:
        connection: The TrueLayer connection dictionary.

    Returns:
        A valid access token, or None on error.
    """
    token_obtained_at_str = connection.get("token_obtained_at")
    expires_in = connection.get("expires_in", 3600)  # Default to 1 hour
    refresh_token = connection.get("refresh_token")

    if not token_obtained_at_str or not refresh_token:
        # Not enough info to refresh, just return the current token
        logging.warning(
            "Not enough information to check token expiry or refresh. Using existing token."
        )
        return connection.get("access_token")

    token_obtained_at = datetime.fromisoformat(token_obtained_at_str)
    # Be conservative, refresh if less than 60 seconds left
    expiry_time = token_obtained_at + timedelta(seconds=expires_in - 60)

    if datetime.now() < expiry_time:
        # Token is still valid
        logging.debug("Access token is still valid.")
        return connection.get("access_token")

    # Token has expired, try to refresh it
    logging.info(
        f"Access token for {connection.get('provider_name')} has expired. Refreshing..."
    )
    new_token_data = refresh_access_token(refresh_token)

    if not new_token_data:
        logging.error("Failed to refresh access token.")
        return None

    # Update the connection with the new token details
    connection["access_token"] = new_token_data["access_token"]
    connection["expires_in"] = new_token_data["expires_in"]
    connection["token_obtained_at"] = new_token_data["token_obtained_at"]

    # The refresh token might also be rotated
    if "refresh_token" in new_token_data:
        connection["refresh_token"] = new_token_data["refresh_token"]

    # Save the updated connection back to the file
    update_truelayer_connection(connection)

    logging.info("Successfully refreshed access token.")
    return connection["access_token"]


def _fetch_bank_accounts(
    session: requests.Session, headers: dict
) -> List[Dict[str, Any]]:
    """Fetch traditional bank accounts from TrueLayer API."""
    try:
        api_url = f"{_get_api_base_url()}/data/v1/accounts"
        response = session.get(api_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        accounts = data.get("results", [])
        # Mark these as accounts
        for account in accounts:
            account["_type"] = "account"
        logging.info(f"Fetched {len(accounts)} bank accounts")
        return accounts
    except requests.exceptions.RequestException as e:
        if e.response is not None and e.response.status_code == 403:
            if "sca_exceeded" in e.response.text or not e.response.text:
                raise ScaExceededError(
                    f"SCA exemption has expired. Re-authentication required. Response: {e.response.text}"
                )
        logging.error(f"Error fetching accounts: {e}")
        if hasattr(e, "response") and e.response is not None:
            logging.error(f"Response: {e.response.text}")
        return []


def _fetch_credit_cards(
    session: requests.Session, headers: dict
) -> List[Dict[str, Any]]:
    """Fetch credit/debit cards from TrueLayer API."""
    try:
        api_url = f"{_get_api_base_url()}/data/v1/cards"
        response = session.get(api_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        cards = data.get("results", [])
        # Mark these as cards and add card_id as account_id for consistency
        for card in cards:
            card["_type"] = "card"
            card["account_id"] = card.get("account_id") or card.get("card_id")
        logging.info(f"Fetched {len(cards)} credit/debit cards")
        return cards
    except requests.exceptions.RequestException as e:
        # Don't raise an exception here, just log it.
        # Failing to fetch cards should not prevent the user from using their bank accounts.
        logging.error(f"Error fetching cards: {e}")
        if hasattr(e, "response") and e.response is not None:
            logging.error(f"Response: {e.response.text}")
        return []


def get_accounts(access_token: str) -> List[Dict[str, Any]]:
    """
    Fetches all accounts and cards for the connected user.

    Args:
        access_token: The access token for the TrueLayer connection.

    Returns:
        A list of account and card dictionaries combined.
    """
    session = _initialize_truelayer_session()
    if not session:
        return []

    headers = {"Authorization": f"Bearer {access_token}"}

    # Fetch both bank accounts and cards
    accounts = _fetch_bank_accounts(session, headers)
    cards = _fetch_credit_cards(session, headers)

    return accounts + cards


def get_provider_name(access_token: str) -> str:
    """
    Gets the provider (bank) name from the user's accounts.

    Args:
        access_token: The access token for the TrueLayer connection.

    Returns:
        The provider display name, or "Unknown Bank" if not found.
    """
    accounts = get_accounts(access_token)

    if not accounts:
        return "Unknown Bank"

    # Get provider info from first account
    first_account = accounts[0]
    provider = first_account.get("provider", {})

    # Try to get display name, fall back to provider_id
    provider_name = provider.get("display_name") or provider.get(
        "provider_id", "Unknown Bank"
    )

    # Clean up provider_id format (e.g., "ob-lloyds" -> "Lloyds")
    if provider_name.startswith(("ob-", "oauth-", "xs2a-")):
        provider_name = provider_name.split("-", 1)[1].title()

    logging.info(f"Detected provider: {provider_name}")
    return provider_name


def _get_default_date_range() -> tuple[str, str]:
    """Get default date range for transaction fetching (last 90 days)."""
    from_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    to_date = datetime.now().strftime("%Y-%m-%d")
    return from_date, to_date


def _get_transactions_api_url(account_id: str, account_type: str) -> str:
    """Get the appropriate API URL for fetching transactions."""
    base_url = _get_api_base_url()
    if account_type == "card":
        return f"{base_url}/data/v1/cards/{account_id}/transactions"
    return f"{base_url}/data/v1/accounts/{account_id}/transactions"


def _fetch_paginated_transactions(
    session: requests.Session, api_url: str, headers: dict, params: dict
) -> List[Dict[str, Any]]:
    """Fetch all transactions with pagination support."""
    all_transactions = []

    while True:
        response = session.get(api_url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        transactions = data.get("results", [])
        all_transactions.extend(transactions)

        # Check for pagination
        next_cursor = data.get("next_cursor")
        if not next_cursor:
            break

        # Update params with the cursor for next request
        params["cursor"] = next_cursor

    return all_transactions


def fetch_transactions(
    access_token: str,
    account_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
    account_type: str = "account",
) -> List[Dict[str, Any]]:
    """
    Fetches transactions from TrueLayer for a specific account or card.

    Args:
        access_token: The access token for the TrueLayer connection.
        account_id: The account ID or card ID to fetch transactions for.
        from_date: Start date in YYYY-MM-DD format (defaults to 90 days ago).
        to_date: End date in YYYY-MM-DD format (defaults to today).
        account_type: Type of account - "account" for bank accounts, "card" for credit/debit cards.

    Returns:
        A list of transaction dictionaries.
    """
    session = _initialize_truelayer_session()
    if not session:
        return []

    # Default to last 90 days if no date range specified
    if not from_date or not to_date:
        default_from, default_to = _get_default_date_range()
        from_date = from_date or default_from
        to_date = to_date or default_to

    api_url = _get_transactions_api_url(account_id, account_type)
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"from": from_date, "to": to_date}

    try:
        all_transactions = _fetch_paginated_transactions(
            session, api_url, headers, params
        )
        logging.info(
            f"Fetched {len(all_transactions)} transactions for account {account_id}"
        )
        return all_transactions

    except requests.exceptions.RequestException as e:
        if e.response is not None and e.response.status_code == 403:
            if "sca_exceeded" in e.response.text:
                raise ScaExceededError(
                    f"SCA exemption has expired. Re-authentication required. Response: {e.response.text}"
                )
        logging.error(f"Error fetching transactions: {e}")
        if hasattr(e, "response") and e.response is not None:
            logging.error(f"Response: {e.response.text}")
        return []


def convert_truelayer_transactions_to_dataframe(
    transactions: List[Dict[str, Any]], provider_name: str = "TrueLayer"
) -> pd.DataFrame | None:
    """
    Converts TrueLayer transactions to a DataFrame ready for import.

    Args:
        transactions: A list of TrueLayer transaction dictionaries.
        provider_name: The name of the provider/institution.

    Returns:
        A DataFrame with Date, Merchant, Amount, Type columns, or None if no transactions.
    """
    if not transactions:
        return None

    df = pd.DataFrame(transactions)

    # TrueLayer transaction structure:
    # - timestamp: ISO 8601 timestamp
    # - description: Merchant name/description
    # - amount: Transaction amount (negative for debits, positive for credits)
    # - transaction_type: DEBIT, CREDIT, etc.
    # - transaction_category: Category from bank

    required_fields = ["timestamp", "description", "amount"]
    if not all(field in df.columns for field in required_fields):
        logging.error(
            f"Missing required fields in TrueLayer transactions. Available: {df.columns.tolist()}"
        )
        return None

    # Convert timestamp to date
    df["Date"] = pd.to_datetime(df["timestamp"], format="ISO8601").dt.date

    # Use description as merchant name
    df["Merchant"] = df["description"]

    # Keep amounts positive for both income and expenses
    df["Amount"] = df["amount"].abs()

    # Assign Type based on transaction_type (DEBIT = expense, CREDIT = income)
    if "transaction_type" in df.columns:
        df["Type"] = df["transaction_type"].map(
            {"DEBIT": "expense", "CREDIT": "income"}
        )
        # Handle any unknown transaction types as expenses
        df["Type"] = df["Type"].fillna("expense")
    else:
        # If no transaction_type, infer from original amount sign
        # Negative amounts are debits (expenses), positive are credits (income)
        df["Type"] = df["amount"].apply(lambda x: "expense" if x < 0 else "income")

    if len(df) == 0:
        return None

    # Keep only the columns we need
    df = df[["Date", "Merchant", "Amount", "Type"]]

    return df


def sync_all_accounts(
    access_token: str, provider_name: str, from_date: str | None = None
) -> pd.DataFrame | None:
    """
    Syncs transactions from all accounts for a TrueLayer connection.

    Args:
        access_token: The access token for the TrueLayer connection.
        provider_name: The name of the provider/institution.
        from_date: Start date for transaction sync in YYYY-MM-DD format.

    Returns:
        A combined DataFrame of all transactions with account names, or None if no transactions.
    """
    accounts = get_accounts(access_token)
    if not accounts:
        logging.warning("No accounts found for this connection")
        return None

    all_dfs = []

    for account in accounts:
        account_id = account.get("account_id")
        account_type = account.get("account_type", "")
        # Get the _type field to determine if it's a card or account
        resource_type = account.get("_type", "account")

        # Get account name - prefer display_name, fall back to account type + last 4 digits
        display_name = account.get("display_name")
        currency = account.get("currency", "")

        if display_name:
            account_name = display_name
        else:
            # Try to get last 4 digits from account_number or card_number
            account_number = account.get("account_number", {})
            card_number = account.get("card_number", {})
            number = account_number.get("number", "") or card_number.get("number", "")
            last_4 = number[-4:] if len(number) >= 4 else number
            account_name = (
                f"{account_type} {last_4}" if last_4 else account_type or "Account"
            )

        # Include currency for multi-currency accounts (e.g., Revolut)
        if currency:
            account_name = f"{account_name} ({currency})"

        logging.info(
            f"Fetching transactions for: {provider_name} - {account_name} ({account_id})"
        )

        transactions = fetch_transactions(
            access_token, account_id, from_date=from_date, account_type=resource_type
        )
        df = convert_truelayer_transactions_to_dataframe(transactions, provider_name)

        if df is not None:
            # Add account-specific source identifier
            df["AccountSource"] = f"{provider_name} - {account_name}"
            all_dfs.append(df)

    if not all_dfs:
        return None

    # Combine all account transactions
    combined_df = pd.concat(all_dfs, ignore_index=True)
    logging.info(f"Total transactions from all accounts: {len(combined_df)}")

    return combined_df


def process_and_store_transactions(
    transactions_df: pd.DataFrame, provider_name: str
) -> None:
    """
    Processes and stores transactions fetched from TrueLayer.

    Args:
        transactions_df: DataFrame with Date, Merchant, Amount, AccountSource columns.
        provider_name: The name of the provider/institution (used if AccountSource not present).
    """
    if transactions_df is None or len(transactions_df) == 0:
        logging.info("No transactions to add from TrueLayer.")
        return

    # If AccountSource column exists (from sync_all_accounts), use it for per-account tracking
    if "AccountSource" in transactions_df.columns:
        # Group by AccountSource and append each group separately
        for account_source, group_df in transactions_df.groupby("AccountSource"):
            # Remove AccountSource column before appending (it's tracked in Source)
            group_df = group_df.drop(columns=["AccountSource"]).copy()
            append_transactions(
                group_df, source=account_source, suggest_categories=True
            )
            logging.info(f"Added {len(group_df)} transactions from {account_source}")
    else:
        # Fallback: use provider name only
        source = f"TrueLayer - {provider_name}"
        append_transactions(transactions_df, source=source, suggest_categories=True)
        logging.info(f"Added {len(transactions_df)} transactions from {source}.")
