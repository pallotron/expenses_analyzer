import unittest
from unittest.mock import patch, MagicMock
import pandas as pd
from expenses.data_handler import clean_amount, append_transactions, delete_transactions


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


if __name__ == "__main__":
    unittest.main()
