import unittest
import pandas as pd
from expenses.screens.edit_single_transaction_screen import EditSingleTransactionScreen


class TestEditSingleTransactionScreen(unittest.TestCase):
    """Tests for EditSingleTransactionScreen."""

    def test_screen_initialization(self) -> None:
        """Test screen initializes with transaction data."""
        transaction_data = {
            "Date": pd.Timestamp("2025-01-15"),
            "Merchant": "Test Merchant",
            "Amount": 99.99,
            "Source": "Manual",
            "Type": "expense",
        }
        screen = EditSingleTransactionScreen(transaction_data, original_index=5)

        self.assertEqual(screen.transaction_data, transaction_data)
        self.assertEqual(screen.original_index, 5)

    def test_validate_date_valid(self) -> None:
        """Test date validation with valid dates."""
        transaction_data = {
            "Date": pd.Timestamp("2025-01-15"),
            "Merchant": "Test",
            "Amount": 10.0,
            "Source": "Test",
            "Type": "expense",
        }
        screen = EditSingleTransactionScreen(transaction_data, original_index=0)

        self.assertTrue(screen._validate_date("2025-01-15"))
        self.assertTrue(screen._validate_date("2024-12-31"))
        self.assertTrue(screen._validate_date("2023-06-01"))

    def test_validate_date_invalid(self) -> None:
        """Test date validation with invalid dates."""
        transaction_data = {
            "Date": pd.Timestamp("2025-01-15"),
            "Merchant": "Test",
            "Amount": 10.0,
            "Source": "Test",
            "Type": "expense",
        }
        screen = EditSingleTransactionScreen(transaction_data, original_index=0)

        self.assertFalse(screen._validate_date(""))
        self.assertFalse(screen._validate_date("invalid"))
        self.assertFalse(screen._validate_date("01-15-2025"))  # Wrong format
        self.assertFalse(screen._validate_date("2025/01/15"))  # Wrong separator

    def test_validate_amount_valid(self) -> None:
        """Test amount validation with valid amounts."""
        transaction_data = {
            "Date": pd.Timestamp("2025-01-15"),
            "Merchant": "Test",
            "Amount": 10.0,
            "Source": "Test",
            "Type": "expense",
        }
        screen = EditSingleTransactionScreen(transaction_data, original_index=0)

        self.assertTrue(screen._validate_amount("99.99"))
        self.assertTrue(screen._validate_amount("0"))
        self.assertTrue(screen._validate_amount("-50.00"))
        self.assertTrue(screen._validate_amount("1234567.89"))

    def test_validate_amount_invalid(self) -> None:
        """Test amount validation with invalid amounts."""
        transaction_data = {
            "Date": pd.Timestamp("2025-01-15"),
            "Merchant": "Test",
            "Amount": 10.0,
            "Source": "Test",
            "Type": "expense",
        }
        screen = EditSingleTransactionScreen(transaction_data, original_index=0)

        self.assertFalse(screen._validate_amount(""))
        self.assertFalse(screen._validate_amount("abc"))
        self.assertFalse(screen._validate_amount("12.34.56"))

    def test_screen_with_nan_values(self) -> None:
        """Test screen handles NaN values gracefully."""
        transaction_data = {
            "Date": pd.NaT,
            "Merchant": "Test",
            "Amount": float("nan"),
            "Source": None,
            "Type": None,
        }
        # Should not raise an exception
        screen = EditSingleTransactionScreen(transaction_data, original_index=0)
        self.assertEqual(screen.original_index, 0)


if __name__ == "__main__":
    unittest.main()
