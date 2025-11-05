import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock

import pandas as pd
import plaid

from expenses.plaid_handler import (
    _initialize_plaid_client,
    load_plaid_items,
    save_plaid_item,
    update_plaid_item_cursor,
    fetch_transactions,
    convert_plaid_transactions_to_dataframe,
    process_and_store_transactions,
)


class TestPlaidHandler(unittest.TestCase):

    def setUp(self):
        """Set up a clean environment for each test."""
        self.test_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.test_dir) / "config"
        self.config_dir.mkdir()
        self.plaid_items_file = self.config_dir / "plaid_items.json"

        self.patcher_config_dir = patch(
            "expenses.plaid_handler.CONFIG_DIR", self.config_dir
        )
        self.patcher_config_dir_config = patch(
            "expenses.config.CONFIG_DIR", self.config_dir
        )
        self.patcher_plaid_items_file = patch(
            "expenses.plaid_handler.PLAID_ITEMS_FILE", self.plaid_items_file
        )
        self.patcher_config_dir.start()
        self.patcher_config_dir_config.start()
        self.patcher_plaid_items_file.start()

    def tearDown(self):
        """Clean up after each test."""
        self.patcher_config_dir.stop()
        self.patcher_config_dir_config.stop()
        self.patcher_plaid_items_file.stop()
        import shutil

        shutil.rmtree(self.test_dir, ignore_errors=True)

    @patch("builtins.open", new_callable=mock_open)
    @patch("json.dump")
    @patch("expenses.plaid_handler.load_plaid_items", return_value=[])
    @patch("expenses.plaid_handler._ensure_secure_config_dir")
    @patch("expenses.plaid_handler._set_secure_permissions")
    def test_save_plaid_item(
        self, mock_set_permissions, mock_ensure_dir, mock_load, mock_dump, mock_file
    ):
        """Test saving a new Plaid item."""
        new_item = {"item_id": "test_item_123", "access_token": "test_token"}
        save_plaid_item(new_item)

        mock_ensure_dir.assert_called_once()
        mock_file.assert_called_with(self.plaid_items_file, "w")
        # The save_plaid_item function adds transactions_cursor field
        expected_item = {
            "item_id": "test_item_123",
            "access_token": "test_token",
            "transactions_cursor": None,
        }
        mock_dump.assert_called_with([expected_item], mock_file(), indent=4)
        mock_set_permissions.assert_called_with(self.plaid_items_file)

    def test_load_plaid_items_no_file(self):
        """Test loading Plaid items when the file does not exist."""
        # File doesn't exist in temp directory
        items = load_plaid_items()
        self.assertEqual(items, [])

    def test_save_and_load_integration(self):
        """Test saving and then loading Plaid items."""
        item1 = {"item_id": "item1", "access_token": "token1"}
        item2 = {"item_id": "item2", "access_token": "token2"}

        # Save one item
        save_plaid_item(item1)
        items = load_plaid_items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["item_id"], "item1")

        # Save another item
        save_plaid_item(item2)
        items = load_plaid_items()
        self.assertEqual(len(items), 2)
        self.assertEqual(items[1]["item_id"], "item2")

    def test_load_plaid_items_json_error(self):
        """Test loading Plaid items with a JSON decoding error."""
        # This test requires the file to exist with invalid data
        with open(self.plaid_items_file, "w") as f:
            f.write("[invalid json")

        items = load_plaid_items()
        self.assertEqual(items, [])

    @patch("expenses.plaid_handler.PLAID_CLIENT_ID", "test_client_id")
    @patch("expenses.plaid_handler.PLAID_SECRET", "test_secret")
    @patch("expenses.plaid_handler.PLAID_ENV", "sandbox")
    def test_initialize_plaid_client_success(self):
        """Test successful Plaid client initialization."""
        with (
            patch("plaid.ApiClient") as mock_api_client,
            patch("plaid.api.plaid_api.PlaidApi") as mock_plaid_api,
        ):
            client = _initialize_plaid_client()
            self.assertIsNotNone(client)
            mock_api_client.assert_called_once()
            mock_plaid_api.assert_called_once_with(mock_api_client.return_value)

    def test_initialize_plaid_client_no_keys(self):
        """Test Plaid client initialization without API keys."""
        with (
            patch("expenses.plaid_handler.PLAID_CLIENT_ID", None),
            patch("expenses.plaid_handler.PLAID_SECRET", None),
        ):
            client = _initialize_plaid_client()
            self.assertIsNone(client)

    def test_load_plaid_items_file_not_found(self):
        """Test loading Plaid items when the file does not exist."""
        items = load_plaid_items()
        self.assertEqual(items, [])

    @patch("builtins.open", new_callable=mock_open)
    @patch("json.dump")
    @patch("expenses.plaid_handler.load_plaid_items", return_value=[])
    @patch("expenses.data_handler._ensure_secure_config_dir")
    @patch("expenses.data_handler._set_secure_permissions")
    def test_save_plaid_item_io_error(
        self, mock_set_permissions, mock_ensure_dir, mock_load, mock_dump, mock_file
    ):
        """Test error handling when saving a Plaid item fails."""
        mock_file.side_effect = IOError("Permission denied")
        save_plaid_item({"item_id": "123"})
        # No assertion, just ensuring it doesn't crash and logs the error

    @patch("builtins.open", new_callable=mock_open)
    @patch("json.dump")
    @patch(
        "expenses.plaid_handler.load_plaid_items",
        return_value=[{"item_id": "123", "transactions_cursor": None}],
    )
    @patch("expenses.plaid_handler._ensure_secure_config_dir")
    @patch("expenses.data_handler._set_secure_permissions")
    def test_update_plaid_item_cursor_io_error(
        self, mock_set_permissions, mock_ensure_dir, mock_load, mock_dump, mock_file
    ):
        """Test error handling when updating a Plaid item cursor fails."""
        mock_file.side_effect = IOError("Permission denied")
        update_plaid_item_cursor("123", "new_cursor")
        # No assertion, just ensuring it doesn't crash and logs the error

    @patch("expenses.plaid_handler._initialize_plaid_client")
    def test_fetch_transactions_api_error(self, mock_initialize_client):
        """Test error handling when the Plaid API returns an error."""
        mock_plaid_client = MagicMock()
        mock_initialize_client.return_value = mock_plaid_client
        mock_plaid_client.transactions_sync.side_effect = plaid.ApiException(
            status=500, reason="Internal Server Error"
        )

        result = fetch_transactions("access_token", "cursor")
        self.assertEqual(result, {})

    def test_convert_plaid_transactions_no_merchant_field(self):
        """Test converting transactions with no merchant field."""
        transactions = {
            "added": [{"date": "2025-01-01", "amount": 10.00}],
            "modified": [],
            "removed": [],
        }
        df = convert_plaid_transactions_to_dataframe(transactions)
        self.assertIsNone(df)

    def test_convert_plaid_transactions_single_expense(self):
        """Test converting transactions that are all credits."""
        transactions = {
            "added": [{"date": "2025-01-01", "name": "Store", "amount": -10.00}],
            "modified": [],
            "removed": [],
        }
        df = convert_plaid_transactions_to_dataframe(transactions)
        self.assertIsNotNone(df)
        self.assertEqual(df.iloc[0]["Amount"], 10.00)

    @patch("expenses.data_handler.delete_transactions")
    @patch("expenses.data_handler.append_transactions")
    def test_process_and_store_transactions_no_removed_merchant_field(
        self, mock_append, mock_delete
    ):
        """Test processing removed transactions with no merchant field."""
        transactions = {
            "added": [],
            "modified": [],
            "removed": [{"date": "2025-01-01", "amount": 10.00}],
        }
        process_and_store_transactions(transactions)
        mock_delete.assert_not_called()
        mock_append.assert_not_called()

    @patch("expenses.plaid_handler._initialize_plaid_client")
    def test_fetch_transactions_success_no_cursor(self, mock_initialize_client):
        """Test fetching transactions successfully without an initial cursor."""
        mock_plaid_client = MagicMock()
        mock_initialize_client.return_value = mock_plaid_client
        mock_plaid_client.transactions_sync.return_value.to_dict.return_value = {
            "added": [{"date": "2025-01-01", "name": "Test", "amount": 10.00}],
            "modified": [],
            "removed": [],
            "has_more": False,
            "next_cursor": "new_cursor_123",
        }

        result = fetch_transactions("access_token", None)
        self.assertIn("added", result)
        self.assertEqual(len(result["added"]), 1)
        self.assertEqual(result["cursor"], "new_cursor_123")

    @patch("expenses.plaid_handler._initialize_plaid_client")
    def test_fetch_transactions_success_with_cursor(self, mock_initialize_client):
        """Test fetching transactions successfully with an initial cursor."""
        mock_plaid_client = MagicMock()
        mock_initialize_client.return_value = mock_plaid_client
        mock_plaid_client.transactions_sync.return_value.to_dict.return_value = {
            "added": [{"date": "2025-01-02", "name": "Test2", "amount": 20.00}],
            "modified": [],
            "removed": [],
            "has_more": False,
            "next_cursor": "new_cursor_456",
        }

        result = fetch_transactions("access_token", "old_cursor")
        self.assertIn("added", result)
        self.assertEqual(len(result["added"]), 1)
        self.assertEqual(result["cursor"], "new_cursor_456")

    @patch("expenses.plaid_handler._initialize_plaid_client")
    def test_fetch_transactions_pagination(self, mock_initialize_client):
        """Test fetching transactions with pagination (has_more)."""
        mock_plaid_client = MagicMock()
        mock_initialize_client.return_value = mock_plaid_client

        # First response
        mock_plaid_client.transactions_sync.side_effect = [
            MagicMock(
                to_dict=lambda: {
                    "added": [{"date": "2025-01-01", "name": "Page1", "amount": 10.00}],
                    "modified": [],
                    "removed": [],
                    "has_more": True,
                    "next_cursor": "cursor_page1",
                }
            ),
            # Second response
            MagicMock(
                to_dict=lambda: {
                    "added": [{"date": "2025-01-02", "name": "Page2", "amount": 20.00}],
                    "modified": [],
                    "removed": [],
                    "has_more": False,
                    "next_cursor": "cursor_page2",
                }
            ),
        ]

        result = fetch_transactions("access_token", None)
        self.assertIn("added", result)
        self.assertEqual(len(result["added"]), 2)
        self.assertEqual(result["cursor"], "cursor_page2")

    def test_convert_plaid_transactions_merchant_name_field(self):
        """Test converting transactions with 'merchant_name' field."""
        transactions = {
            "added": [
                {"date": "2025-01-01", "merchant_name": "Shop", "amount": -10.00}
            ],
            "modified": [],
            "removed": [],
        }
        df = convert_plaid_transactions_to_dataframe(transactions)
        self.assertIsNotNone(df)
        self.assertEqual(df.iloc[0]["Merchant"], "Shop")

    @patch("expenses.plaid_handler.append_transactions")
    @patch("expenses.plaid_handler.delete_transactions")
    def test_process_and_store_transactions_full_flow(self, mock_delete, mock_append):
        """Test the full process_and_store_transactions flow."""
        transactions = {
            "added": [{"date": "2025-01-01", "name": "Added Item", "amount": -10.00}],
            "modified": [
                {"date": "2025-01-02", "name": "Modified Item", "amount": -20.00}
            ],
            "removed": [
                {"date": "2025-01-03", "name": "Removed Item", "amount": 30.00}
            ],
        }
        process_and_store_transactions(transactions)

        mock_append.assert_called_once()
        appended_df = mock_append.call_args[0][0]
        self.assertEqual(len(appended_df), 2)  # Added and Modified
        self.assertTrue("Added Item" in appended_df["Merchant"].values)
        self.assertTrue("Modified Item" in appended_df["Merchant"].values)

        mock_delete.assert_called_once()
        deleted_df = mock_delete.call_args[0][0]
        self.assertEqual(len(deleted_df), 1)
        self.assertTrue("Removed Item" in deleted_df["Merchant"].values)

    @patch("expenses.data_handler.append_transactions")
    @patch("expenses.data_handler.delete_transactions")
    def test_process_and_store_transactions_no_new_transactions(
        self, mock_delete, mock_append
    ):
        """Test processing when no new transactions are added/modified."""
        transactions = {
            "added": [],
            "modified": [],
            "removed": [],
        }
        process_and_store_transactions(transactions)
        mock_append.assert_not_called()
        mock_delete.assert_not_called()

    @patch(
        "expenses.plaid_handler.load_plaid_items",
        return_value=[
            {
                "item_id": "item_id_1",
                "access_token": "access_token_1",
                "transactions_cursor": "old_cursor",
            }
        ],
    )
    @patch("expenses.plaid_handler.fetch_transactions")
    @patch("expenses.plaid_handler.convert_plaid_transactions_to_dataframe")
    @patch("expenses.plaid_handler.append_transactions")
    @patch("expenses.data_handler.delete_transactions")
    def test_sync_transactions_full_flow(
        self, mock_delete, mock_append, mock_convert, mock_fetch, mock_load_items
    ):
        """Test the full sync transactions flow from PlaidScreen."""
        mock_fetch.return_value = {
            "added": [{"date": "2025-01-01", "name": "Sync Item", "amount": -10.00}],
            "modified": [],
            "removed": [],
            "cursor": "new_cursor_value",
        }
        mock_convert.return_value = pd.DataFrame(
            {"Date": ["2025-01-01"], "Merchant": ["Sync Item"], "Amount": [10.00]}
        )

        # Simulate the call from PlaidScreen._sync_transactions_worker
        # This tests the core transaction processing flow
        transactions_data = mock_fetch("access_token_1", "old_cursor")
        process_and_store_transactions(transactions_data)

        # Verify the flow: fetch -> convert -> append
        mock_fetch.assert_called_with("access_token_1", "old_cursor")
        mock_convert.assert_called_once_with(transactions_data)
        mock_append.assert_called_once()

        # Verify cursor is present in the response for the caller to use
        self.assertEqual(transactions_data["cursor"], "new_cursor_value")


if __name__ == "__main__":
    unittest.main()
