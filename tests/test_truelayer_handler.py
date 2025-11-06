import pytest
from unittest.mock import Mock, patch
from datetime import datetime
import pandas as pd

from expenses.truelayer_handler import (
    load_truelayer_connections,
    save_truelayer_connection,
    update_truelayer_connection,
    update_connection_last_sync,
    remove_truelayer_connection,
    exchange_code_for_token,
    refresh_access_token,
    get_accounts,
    fetch_transactions,
    convert_truelayer_transactions_to_dataframe,
    sync_all_accounts,
    process_and_store_transactions,
    _get_api_base_url,
    _get_auth_base_url,
    _initialize_truelayer_session,
)


@pytest.fixture
def mock_config_dir(tmp_path):
    """Create a temporary config directory for testing."""
    with (
        patch("expenses.truelayer_handler.CONFIG_DIR", tmp_path),
        patch(
            "expenses.truelayer_handler.TRUELAYER_CONNECTIONS_FILE",
            tmp_path / "truelayer_connections.json",
        ),
    ):
        yield tmp_path


@pytest.fixture
def mock_credentials():
    """Mock TrueLayer credentials."""
    with (
        patch("expenses.truelayer_handler.TRUELAYER_CLIENT_ID", "test_client_id"),
        patch(
            "expenses.truelayer_handler.TRUELAYER_CLIENT_SECRET", "test_client_secret"
        ),
        patch("expenses.truelayer_handler.TRUELAYER_ENV", "sandbox"),
    ):
        yield


@pytest.fixture
def sample_connection():
    """Sample TrueLayer connection data."""
    return {
        "connection_id": "tl_123456",
        "access_token": "access_token_abc123",
        "refresh_token": "refresh_token_xyz789",
        "token_obtained_at": "2024-01-01T00:00:00",
        "expires_in": 3600,
        "provider_id": "truelayer",
        "provider_name": "Test Bank",
        "last_sync": None,
        "created_at": "2024-01-01T00:00:00",
    }


@pytest.fixture
def sample_accounts():
    """Sample TrueLayer account data."""
    return [
        {
            "account_id": "acc_001",
            "display_name": "Current Account",
            "account_type": "TRANSACTION",
            "account_number": {"number": "12345678"},
        },
        {
            "account_id": "acc_002",
            "display_name": "Savings Account",
            "account_type": "SAVINGS",
            "account_number": {"number": "87654321"},
        },
    ]


@pytest.fixture
def sample_transactions():
    """Sample TrueLayer transaction data."""
    return [
        {
            "transaction_id": "txn_001",
            "timestamp": "2024-01-15T10:30:00Z",
            "description": "Coffee Shop",
            "amount": -5.50,
            "transaction_type": "DEBIT",
            "transaction_category": "PURCHASE",
        },
        {
            "transaction_id": "txn_002",
            "timestamp": "2024-01-16T14:20:00Z",
            "description": "Grocery Store",
            "amount": -45.30,
            "transaction_type": "DEBIT",
            "transaction_category": "PURCHASE",
        },
        {
            "transaction_id": "txn_003",
            "timestamp": "2024-01-17T09:00:00Z",
            "description": "Salary Payment",
            "amount": 2500.00,
            "transaction_type": "CREDIT",
            "transaction_category": "TRANSFER",
        },
    ]


def test_get_api_base_url_sandbox():
    """Test API base URL for sandbox environment."""
    with patch("expenses.truelayer_handler.TRUELAYER_ENV", "sandbox"):
        assert _get_api_base_url() == "https://api.truelayer-sandbox.com"


def test_get_api_base_url_production():
    """Test API base URL for production environment."""
    with patch("expenses.truelayer_handler.TRUELAYER_ENV", "production"):
        assert _get_api_base_url() == "https://api.truelayer.com"


def test_get_auth_base_url_sandbox():
    """Test Auth base URL for sandbox environment."""
    with patch("expenses.truelayer_handler.TRUELAYER_ENV", "sandbox"):
        assert _get_auth_base_url() == "https://auth.truelayer-sandbox.com"


def test_get_auth_base_url_production():
    """Test Auth base URL for production environment."""
    with patch("expenses.truelayer_handler.TRUELAYER_ENV", "production"):
        assert _get_auth_base_url() == "https://auth.truelayer.com"


def test_initialize_truelayer_session_success(mock_credentials):
    """Test successful TrueLayer session initialization."""
    session = _initialize_truelayer_session()
    assert session is not None
    assert session.headers["Content-Type"] == "application/json"


def test_initialize_truelayer_session_no_credentials():
    """Test session initialization fails without credentials."""
    with patch("expenses.truelayer_handler.TRUELAYER_CLIENT_ID", None):
        session = _initialize_truelayer_session()
        assert session is None


def test_load_truelayer_connections_empty(mock_config_dir):
    """Test loading connections when file doesn't exist."""
    connections = load_truelayer_connections()
    assert connections == []


def test_save_and_load_connection(mock_config_dir, sample_connection):
    """Test saving and loading a TrueLayer connection."""
    save_truelayer_connection(sample_connection)

    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["connection_id"] == sample_connection["connection_id"]
    assert connections[0]["access_token"] == sample_connection["access_token"]
    assert connections[0]["last_sync"] is None
    assert "created_at" in connections[0]


def test_save_multiple_connections(mock_config_dir, sample_connection):
    """Test saving multiple connections."""
    connection1 = sample_connection.copy()
    connection1["connection_id"] = "tl_111111"

    connection2 = sample_connection.copy()
    connection2["connection_id"] = "tl_222222"

    save_truelayer_connection(connection1)
    save_truelayer_connection(connection2)

    connections = load_truelayer_connections()
    assert len(connections) == 2
    assert connections[0]["connection_id"] == "tl_111111"
    assert connections[1]["connection_id"] == "tl_222222"


def test_update_connection_last_sync(mock_config_dir, sample_connection):
    """Test updating the last sync timestamp."""
    save_truelayer_connection(sample_connection)

    # Update last sync
    connection_id = sample_connection["connection_id"]
    update_connection_last_sync(connection_id)

    # Verify the update
    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["last_sync"] is not None
    # Check it's a valid ISO format timestamp
    datetime.fromisoformat(connections[0]["last_sync"])


@patch("expenses.truelayer_handler._initialize_truelayer_session")
def test_exchange_code_for_token_success(mock_session, mock_credentials):
    """Test successful code to token exchange."""
    # Mock the session and response
    mock_response = Mock()
    mock_response.json.return_value = {
        "access_token": "new_access_token",
        "refresh_token": "new_refresh_token",
        "expires_in": 3600,
    }
    mock_response.raise_for_status = Mock()

    mock_session_obj = Mock()
    mock_session_obj.post.return_value = mock_response
    mock_session.return_value = mock_session_obj

    result = exchange_code_for_token("auth_code_123", "http://localhost:3001/callback")

    assert result is not None
    assert result["access_token"] == "new_access_token"
    assert result["refresh_token"] == "new_refresh_token"
    assert result["expires_in"] == 3600
    assert "token_obtained_at" in result


@patch("expenses.truelayer_handler._initialize_truelayer_session")
def test_exchange_code_for_token_failure(mock_session, mock_credentials):
    """Test failed code to token exchange."""
    mock_session.return_value = None

    result = exchange_code_for_token("auth_code_123", "http://localhost:3001/callback")
    assert result is None


@patch("expenses.truelayer_handler._initialize_truelayer_session")
def test_refresh_access_token_success(mock_session, mock_credentials):
    """Test successful token refresh."""
    mock_response = Mock()
    mock_response.json.return_value = {
        "access_token": "refreshed_access_token",
        "expires_in": 3600,
    }
    mock_response.raise_for_status = Mock()

    mock_session_obj = Mock()
    mock_session_obj.post.return_value = mock_response
    mock_session.return_value = mock_session_obj

    result = refresh_access_token("refresh_token_xyz")

    assert result is not None
    assert result["access_token"] == "refreshed_access_token"
    assert result["expires_in"] == 3600


@patch("expenses.truelayer_handler._initialize_truelayer_session")
def test_get_accounts_success(mock_session, mock_credentials, sample_accounts):
    """Test successful account fetching."""
    mock_session_obj = Mock()
    # Configure side_effect for get calls based on URL
    mock_session_obj.get.side_effect = [
        Mock(json=lambda: {"results": sample_accounts}, raise_for_status=Mock()),
        Mock(json=lambda: {"results": []}, raise_for_status=Mock()),
    ]
    mock_session.return_value = mock_session_obj

    accounts = get_accounts("access_token_123")

    assert len(accounts) == 2
    assert accounts[0]["account_id"] == "acc_001"
    assert accounts[1]["display_name"] == "Savings Account"


@patch("expenses.truelayer_handler._initialize_truelayer_session")
def test_fetch_transactions_success(
    mock_session, mock_credentials, sample_transactions
):
    """Test successful transaction fetching."""
    mock_session_obj = Mock()
    mock_session_obj.get.return_value = Mock(
        json=lambda: {"results": sample_transactions}, raise_for_status=Mock()
    )
    mock_session.return_value = mock_session_obj

    transactions = fetch_transactions("access_token_123", "acc_001")

    assert len(transactions) == 3
    assert transactions[0]["description"] == "Coffee Shop"
    assert transactions[1]["amount"] == -45.30


@patch("expenses.truelayer_handler._initialize_truelayer_session")
def test_fetch_transactions_with_date_range(
    mock_session, mock_credentials, sample_transactions
):
    """Test transaction fetching with date range."""
    mock_session_obj = Mock()
    mock_session_obj.get.return_value = Mock(
        json=lambda: {"results": sample_transactions}, raise_for_status=Mock()
    )
    mock_session.return_value = mock_session_obj

    from_date = "2024-01-01"
    to_date = "2024-01-31"

    _ = fetch_transactions("access_token_123", "acc_001", from_date, to_date)

    # Check that get was called with correct params
    call_args = mock_session_obj.get.call_args
    assert call_args[1]["params"]["from"] == from_date
    assert call_args[1]["params"]["to"] == to_date


def test_convert_truelayer_transactions_to_dataframe(sample_transactions):
    """Test conversion of TrueLayer transactions to DataFrame."""
    df = convert_truelayer_transactions_to_dataframe(sample_transactions, "Test Bank")

    assert df is not None
    assert len(df) == 2  # Only 2 debits, 1 credit should be filtered out
    assert list(df.columns) == ["Date", "Merchant", "Amount"]

    # Check first transaction (Coffee Shop)
    assert df.iloc[0]["Merchant"] == "Coffee Shop"
    assert df.iloc[0]["Amount"] == 5.50  # Should be positive

    # Check second transaction (Grocery Store)
    assert df.iloc[1]["Merchant"] == "Grocery Store"
    assert df.iloc[1]["Amount"] == 45.30  # Should be positive


def test_convert_truelayer_transactions_empty():
    """Test conversion with empty transaction list."""
    df = convert_truelayer_transactions_to_dataframe([], "Test Bank")
    assert df is None


def test_convert_truelayer_transactions_only_credits():
    """Test conversion when only credit transactions exist."""
    credit_transactions = [
        {
            "timestamp": "2024-01-15T10:30:00Z",
            "description": "Salary",
            "amount": 2500.00,
            "transaction_type": "CREDIT",
        }
    ]

    df = convert_truelayer_transactions_to_dataframe(credit_transactions, "Test Bank")
    assert df is None  # Should return None as no debits


@patch("expenses.truelayer_handler.get_accounts")
@patch("expenses.truelayer_handler.fetch_transactions")
@patch("expenses.truelayer_handler.convert_truelayer_transactions_to_dataframe")
def test_sync_all_accounts(
    mock_convert, mock_fetch, mock_get_accounts, sample_accounts, sample_transactions
):
    """Test syncing all accounts."""
    mock_get_accounts.return_value = sample_accounts
    mock_fetch.return_value = sample_transactions

    # Mock DataFrame for each account
    mock_df1 = pd.DataFrame(
        {
            "Date": ["2024-01-15", "2024-01-16"],
            "Merchant": ["Coffee Shop", "Grocery Store"],
            "Amount": [5.50, 45.30],
        }
    )

    mock_df2 = pd.DataFrame(
        {
            "Date": ["2024-01-17"],
            "Merchant": ["Restaurant"],
            "Amount": [25.00],
        }
    )

    mock_convert.side_effect = [mock_df1, mock_df2]

    result = sync_all_accounts("access_token_123", "Test Bank")

    assert result is not None
    assert len(result) == 3  # Combined from both accounts
    assert mock_get_accounts.called
    assert mock_fetch.call_count == 2  # Called once per account


@patch("expenses.truelayer_handler.append_transactions")
def test_process_and_store_transactions(mock_append):
    """Test processing and storing transactions."""
    df = pd.DataFrame(
        {
            "Date": ["2024-01-15", "2024-01-16"],
            "Merchant": ["Coffee Shop", "Grocery Store"],
            "Amount": [5.50, 45.30],
        }
    )

    process_and_store_transactions(df, "Test Bank")

    # Verify append_transactions was called with correct parameters
    assert mock_append.called
    call_args = mock_append.call_args
    assert call_args[1]["source"] == "TrueLayer - Test Bank"
    assert call_args[1]["suggest_categories"] is True


@patch("expenses.truelayer_handler.append_transactions")
def test_process_and_store_transactions_empty(mock_append):
    """Test processing with no transactions."""
    process_and_store_transactions(None, "Test Bank")

    # Should not call append_transactions
    assert not mock_append.called


def test_load_connections_corrupted_json(mock_config_dir):
    """Test loading connections with corrupted JSON file."""
    connections_file = mock_config_dir / "truelayer_connections.json"
    connections_file.write_text("{ invalid json }")

    connections = load_truelayer_connections()
    assert connections == []


def test_update_truelayer_connection_existing(mock_config_dir, sample_connection):
    """Test updating an existing connection."""
    # Save initial connection
    save_truelayer_connection(sample_connection)

    # Update the connection
    updated = sample_connection.copy()
    updated["access_token"] = "updated_token"
    updated["provider_name"] = "Updated Bank"

    update_truelayer_connection(updated)

    # Load and verify
    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["access_token"] == "updated_token"
    assert connections[0]["provider_name"] == "Updated Bank"


def test_update_truelayer_connection_not_found(mock_config_dir, sample_connection):
    """Test updating a connection that doesn't exist appends it."""
    # Don't save anything first
    new_connection = sample_connection.copy()
    new_connection["connection_id"] = "new_id_123"

    update_truelayer_connection(new_connection)

    # Should be appended
    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["connection_id"] == "new_id_123"


def test_update_truelayer_connection_no_id(mock_config_dir):
    """Test updating connection without connection_id does nothing."""
    invalid_connection = {"access_token": "token123"}  # No connection_id

    update_truelayer_connection(invalid_connection)

    connections = load_truelayer_connections()
    assert len(connections) == 0


def test_remove_truelayer_connection_success(mock_config_dir, sample_connection):
    """Test successfully removing a connection."""
    # Save two connections
    connection1 = sample_connection.copy()
    connection1["connection_id"] = "tl_111"
    connection2 = sample_connection.copy()
    connection2["connection_id"] = "tl_222"

    save_truelayer_connection(connection1)
    save_truelayer_connection(connection2)

    # Remove one
    remove_truelayer_connection("tl_111")

    # Verify only one remains
    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["connection_id"] == "tl_222"


def test_remove_truelayer_connection_not_found(mock_config_dir, sample_connection):
    """Test removing a connection that doesn't exist."""
    save_truelayer_connection(sample_connection)

    # Try to remove non-existent connection
    remove_truelayer_connection("nonexistent_id")

    # Original connection should still be there
    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["connection_id"] == sample_connection["connection_id"]


def test_save_connection_with_ioerror(mock_config_dir, sample_connection):
    """Test save connection handles IOError gracefully."""
    with patch("builtins.open", side_effect=IOError("Disk full")):
        # Should not raise exception
        save_truelayer_connection(sample_connection)


def test_update_connection_with_ioerror(mock_config_dir, sample_connection):
    """Test update connection handles IOError gracefully."""
    save_truelayer_connection(sample_connection)

    updated = sample_connection.copy()
    updated["access_token"] = "new_token"

    with patch("builtins.open", side_effect=IOError("Disk full")):
        # Should not raise exception
        update_truelayer_connection(updated)


def test_remove_connection_with_ioerror(mock_config_dir, sample_connection):
    """Test remove connection handles IOError gracefully."""
    save_truelayer_connection(sample_connection)

    with patch("builtins.open", side_effect=IOError("Disk full")):
        # Should not raise exception
        remove_truelayer_connection(sample_connection["connection_id"])


def test_update_last_sync_with_ioerror(mock_config_dir, sample_connection):
    """Test update last sync handles IOError gracefully."""
    save_truelayer_connection(sample_connection)

    with patch("builtins.open", side_effect=IOError("Disk full")):
        # Should not raise exception
        update_connection_last_sync([sample_connection["connection_id"]])


def test_save_connection_without_metadata(mock_config_dir):
    """Test saving connection adds missing metadata fields."""
    minimal_connection = {
        "connection_id": "tl_minimal",
        "access_token": "token123",
    }

    save_truelayer_connection(minimal_connection)

    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["last_sync"] is None
    assert "created_at" in connections[0]


def test_update_connection_last_sync_multiple(mock_config_dir, sample_connection):
    """Test updating last sync for multiple connections."""
    connection1 = sample_connection.copy()
    connection1["connection_id"] = "tl_111"
    connection2 = sample_connection.copy()
    connection2["connection_id"] = "tl_222"

    save_truelayer_connection(connection1)
    save_truelayer_connection(connection2)

    # Update both
    update_connection_last_sync(["tl_111", "tl_222"])

    connections = load_truelayer_connections()
    assert len(connections) == 2
    assert connections[0]["last_sync"] is not None
    assert connections[1]["last_sync"] is not None


def test_update_connection_last_sync_nonexistent(mock_config_dir, sample_connection):
    """Test updating last sync for non-existent connection."""
    save_truelayer_connection(sample_connection)

    # Try to update non-existent connection
    update_connection_last_sync(["nonexistent_id"])

    # Original connection should be unchanged
    connections = load_truelayer_connections()
    assert len(connections) == 1
    assert connections[0]["last_sync"] is None
