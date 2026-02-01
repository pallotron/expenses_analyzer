import unittest
from unittest.mock import patch, MagicMock
import pandas as pd
from expenses.data_handler import (
    clean_amount,
    append_transactions,
    delete_transactions,
    update_transactions,
    update_single_transaction,
)


class TestDataHandler(unittest.TestCase):

    def test_clean_amount(self) -> None:
        # Test cases for the clean_amount function
        data = {
            "no_change": ["123.45", "67.89", "100"],
            "with_currency": ["$54.32", "€98.76", "£12.34"],
            "with_commas": ["1,234.56", "2,345,678.90", "3,000"],
            "with_parentheses": ["(12.34)", "(567.89)", "(100)"],
            "mixed": ["$1,234.56", "(€567.89)", "100", "-"],
            "invalid": ["abc", "", "-"],
        }

        # Expected results
        expected = {
            "no_change": [123.45, 67.89, 100.00],
            "with_currency": [54.32, 98.76, 12.34],
            "with_commas": [1234.56, 2345678.90, 3000.00],
            "with_parentheses": [-12.34, -567.89, -100.00],
            "mixed": [1234.56, -567.89, 100.00, 0.00],
            "invalid": [0.00, 0.00, 0.00],
        }

        for key in data:
            series = pd.Series(data[key])
            cleaned_series = clean_amount(series)
            expected_series = pd.Series(expected[key], dtype="float64")
            pd.testing.assert_series_equal(
                cleaned_series, expected_series, check_names=False
            )

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_append_transactions_no_duplicates(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        # Test appending new, unique transactions
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01"]),
                "Merchant": ["Existing Merchant"],
                "Amount": [10.00],
                "Deleted": [False],
                "Type": ["expense"],
            }
        )
        new_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-02"]),
                "Merchant": ["New Merchant"],
                "Amount": [20.00],
            }
        )
        mock_load.return_value = existing_df.copy()
        append_transactions(new_df)
        mock_save.assert_called_once()
        saved_df = mock_save.call_args[0][0]
        self.assertEqual(len(saved_df), 2)
        self.assertEqual(len(saved_df), 2)
        self.assertEqual(
            saved_df["Merchant"].tolist(), ["Existing Merchant", "New Merchant"]
        )

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_delete_single_transaction(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        # Test soft-deleting a single transaction
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01", "2025-01-02"]),
                "Merchant": ["Merchant A", "Merchant B"],
                "Amount": [10.00, 20.00],
                "Deleted": [False, False],
            }
        )
        to_delete_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01"]),
                "Merchant": ["Merchant A"],
                "Amount": [10.00],
            }
        )
        mock_load.return_value = existing_df.copy()
        delete_transactions(to_delete_df)
        mock_save.assert_called_once()
        saved_df = mock_save.call_args[0][0]
        # Soft delete keeps both rows, but marks one as deleted
        self.assertEqual(len(saved_df), 2)
        self.assertEqual(
            saved_df[saved_df["Merchant"] == "Merchant A"]["Deleted"].iloc[0], True
        )
        self.assertEqual(
            saved_df[saved_df["Merchant"] == "Merchant B"]["Deleted"].iloc[0], False
        )

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_delete_multiple_transactions(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        # Test soft-deleting multiple transactions
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
                "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
                "Amount": [10.00, 20.00, 30.00],
                "Deleted": [False, False, False],
            }
        )
        to_delete_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01", "2025-01-03"]),
                "Merchant": ["Merchant A", "Merchant C"],
                "Amount": [10.00, 30.00],
            }
        )
        mock_load.return_value = existing_df.copy()
        delete_transactions(to_delete_df)
        mock_save.assert_called_once()
        saved_df = mock_save.call_args[0][0]
        # Soft delete keeps all rows, but marks 2 as deleted
        self.assertEqual(len(saved_df), 3)
        self.assertEqual(
            saved_df[saved_df["Merchant"] == "Merchant A"]["Deleted"].iloc[0], True
        )
        self.assertEqual(
            saved_df[saved_df["Merchant"] == "Merchant B"]["Deleted"].iloc[0], False
        )
        self.assertEqual(
            saved_df[saved_df["Merchant"] == "Merchant C"]["Deleted"].iloc[0], True
        )

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_delete_non_existent_transaction(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        # Test attempting to soft-delete a transaction that doesn't exist
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01"]),
                "Merchant": ["Merchant A"],
                "Amount": [10.00],
                "Deleted": [False],
            }
        )
        to_delete_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-02"]),
                "Merchant": ["Non Existent Merchant"],
                "Amount": [99.99],
            }
        )
        mock_load.return_value = existing_df.copy()
        delete_transactions(to_delete_df)
        mock_save.assert_called_once()
        saved_df = mock_save.call_args[0][0]
        # Should remain unchanged (no match to delete)
        self.assertEqual(len(saved_df), 1)
        self.assertEqual(saved_df["Deleted"].iloc[0], False)

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_update_single_transaction(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        """Test updating a single transaction."""
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01", "2025-01-02"]),
                "Merchant": ["Merchant A", "Merchant B"],
                "Amount": [10.00, 20.00],
                "Source": ["Manual", "Manual"],
                "Deleted": [False, False],
                "Type": ["expense", "expense"],
            }
        )
        mock_load.return_value = existing_df.copy()

        # Update the first transaction
        result = update_single_transaction(0, Merchant="Updated Merchant", Amount=15.00)

        self.assertTrue(result)
        mock_save.assert_called_once()
        saved_df = mock_save.call_args[0][0]
        self.assertEqual(saved_df.loc[0, "Merchant"], "Updated Merchant")
        self.assertEqual(saved_df.loc[0, "Amount"], 15.00)
        # Second transaction should be unchanged
        self.assertEqual(saved_df.loc[1, "Merchant"], "Merchant B")

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_update_transactions_multiple(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        """Test updating multiple transactions."""
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
                "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
                "Amount": [10.00, 20.00, 30.00],
                "Source": ["Manual", "Manual", "Manual"],
                "Deleted": [False, False, False],
                "Type": ["expense", "expense", "expense"],
            }
        )
        mock_load.return_value = existing_df.copy()

        # Update multiple transactions
        updates = [
            {"original_index": 0, "Type": "income"},
            {"original_index": 2, "Type": "income", "Source": "Bulk Edit"},
        ]
        result = update_transactions(updates)

        self.assertEqual(result, 2)
        mock_save.assert_called_once()
        saved_df = mock_save.call_args[0][0]
        self.assertEqual(saved_df.loc[0, "Type"], "income")
        self.assertEqual(saved_df.loc[1, "Type"], "expense")  # Unchanged
        self.assertEqual(saved_df.loc[2, "Type"], "income")
        self.assertEqual(saved_df.loc[2, "Source"], "Bulk Edit")

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_update_transactions_empty_list(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        """Test updating with empty list returns 0."""
        result = update_transactions([])
        self.assertEqual(result, 0)
        mock_save.assert_not_called()
        mock_load.assert_not_called()

    @patch("expenses.data_handler.load_transactions_from_parquet")
    @patch("expenses.data_handler.save_transactions_to_parquet")
    def test_update_transactions_invalid_index(
        self, mock_save: MagicMock, mock_load: MagicMock
    ) -> None:
        """Test updating with invalid index is skipped."""
        existing_df = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01"]),
                "Merchant": ["Merchant A"],
                "Amount": [10.00],
                "Source": ["Manual"],
                "Deleted": [False],
                "Type": ["expense"],
            }
        )
        mock_load.return_value = existing_df.copy()

        # Try to update non-existent index
        updates = [{"original_index": 999, "Merchant": "Should Not Exist"}]
        result = update_transactions(updates)

        self.assertEqual(result, 0)
        mock_save.assert_not_called()

    def test_update_single_transaction_no_fields(self) -> None:
        """Test updating with no fields returns False."""
        result = update_single_transaction(0)
        self.assertFalse(result)


if __name__ == "__main__":
    unittest.main()
