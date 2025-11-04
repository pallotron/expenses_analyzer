"""Tests for data validation."""

import unittest
from datetime import datetime, timedelta
import pandas as pd

from expenses.validation import (
    validate_transaction_dataframe,
    validate_and_clean_dataframe,
    ValidationError,
)


class TestValidation(unittest.TestCase):
    """Test suite for transaction data validation."""

    def test_valid_dataframe_passes(self) -> None:
        """Test that valid DataFrame passes validation."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1), datetime(2025, 1, 2)],
            "Merchant": ["Store A", "Store B"],
            "Amount": [10.50, 25.00]
        })

        # Should not raise
        validate_transaction_dataframe(df)

    def test_missing_date_column_fails(self) -> None:
        """Test that missing Date column fails validation."""
        df = pd.DataFrame({
            "Merchant": ["Store A"],
            "Amount": [10.50]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "date" in errors_str
        assert "missing" in errors_str

    def test_missing_merchant_column_fails(self) -> None:
        """Test that missing Merchant column fails validation."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1)],
            "Amount": [10.50]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "merchant" in errors_str

    def test_missing_amount_column_fails(self) -> None:
        """Test that missing Amount column fails validation."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1)],
            "Merchant": ["Store A"]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "amount" in errors_str

    def test_empty_dataframe_passes(self) -> None:
        """Test that empty DataFrame with correct schema passes."""
        df = pd.DataFrame(columns=["Date", "Merchant", "Amount"])

        # Should not raise
        validate_transaction_dataframe(df)

    def test_invalid_dates_fail(self) -> None:
        """Test that invalid dates fail validation."""
        df = pd.DataFrame({
            "Date": ["not a date", "2025-01-01"],
            "Merchant": ["Store A", "Store B"],
            "Amount": [10.50, 25.00]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "invalid" in errors_str and "date" in errors_str

    def test_empty_merchants_fail(self) -> None:
        """Test that empty merchant names fail validation."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1), datetime(2025, 1, 2)],
            "Merchant": ["", "Store B"],
            "Amount": [10.50, 25.00]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "empty" in errors_str and "merchant" in errors_str

    def test_non_numeric_amounts_fail(self) -> None:
        """Test that non-numeric amounts fail validation."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1), datetime(2025, 1, 2)],
            "Merchant": ["Store A", "Store B"],
            "Amount": ["not a number", 25.00]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "non-numeric" in errors_str or "numeric" in errors_str

    def test_negative_amounts_allowed(self) -> None:
        """Test that negative amounts are allowed (for bank exports with expenses as negative)."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1), datetime(2025, 1, 2)],
            "Merchant": ["Store A", "Store B"],
            "Amount": [10.50, -25.00]
        })

        # Should not raise - negative amounts are valid for bank exports
        validate_transaction_dataframe(df)

    def test_too_large_amounts_fail(self) -> None:
        """Test that unreasonably large amounts fail validation."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1)],
            "Merchant": ["Store A"],
            "Amount": [2_000_000.00]  # 2 million
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df, max_amount=1_000_000)

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "exceeding" in errors_str

    def test_dates_too_old_fail(self) -> None:
        """Test that dates before min_date fail validation."""
        df = pd.DataFrame({
            "Date": [datetime(1850, 1, 1)],  # Way too old
            "Merchant": ["Store A"],
            "Amount": [10.50]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df, min_date=datetime(1900, 1, 1))

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "before" in errors_str and "minimum" in errors_str

    def test_dates_too_new_fail(self) -> None:
        """Test that dates after max_date fail validation."""
        future_date = datetime.now() + timedelta(days=400)
        df = pd.DataFrame({
            "Date": [future_date],
            "Merchant": ["Store A"],
            "Amount": [10.50]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df, max_date=datetime.now())

        errors_str = ' '.join(cm.exception.errors).lower()
        assert "after" in errors_str and "maximum" in errors_str

    def test_multiple_errors_reported(self) -> None:
        """Test that multiple validation errors are all reported."""
        df = pd.DataFrame({
            "Date": ["invalid", datetime(2025, 1, 2)],
            "Merchant": ["", "Store B"],
            "Amount": ["not a number", -10.00]
        })

        with self.assertRaises(ValidationError) as cm:
            validate_transaction_dataframe(df)

        # Should report multiple errors
        assert len(cm.exception.errors) >= 3
        errors_str = ' '.join(cm.exception.errors).lower()
        assert "date" in errors_str
        assert "merchant" in errors_str
        assert ("amount" in errors_str or "negative" in errors_str or "numeric" in errors_str)

    def test_zero_amounts_allowed_with_warning(self) -> None:
        """Test that zero amounts are allowed but warned about."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1)],
            "Merchant": ["Store A"],
            "Amount": [0.00]
        })

        # Should not raise (zero is allowed, just unusual)
        validate_transaction_dataframe(df)

    def test_validate_and_clean_function(self) -> None:
        """Test the validate_and_clean_dataframe helper function."""
        df = pd.DataFrame({
            "Date": ["2025-01-01", "2025-01-02"],
            "Merchant": ["Store A", "Store B"],
            "Amount": ["10.50", "25.00"]
        })

        cleaned = validate_and_clean_dataframe(df)

        # Check types were converted
        assert pd.api.types.is_datetime64_any_dtype(cleaned["Date"])
        assert pd.api.types.is_numeric_dtype(cleaned["Amount"])
        assert cleaned.iloc[0]["Amount"] == 10.50

    def test_validation_error_has_errors_list(self) -> None:
        """Test that ValidationError contains list of errors."""
        df = pd.DataFrame({
            "Date": ["invalid"],
            "Merchant": [""],
            "Amount": ["not a number"]
        })

        try:
            validate_transaction_dataframe(df)
            self.fail("Should have raised ValidationError")
        except ValidationError as e:
            assert isinstance(e.errors, list)
            assert len(e.errors) > 0

    def test_extra_columns_allowed(self) -> None:
        """Test that extra columns beyond required ones are allowed."""
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, 1)],
            "Merchant": ["Store A"],
            "Amount": [10.50],
            "Category": ["Shopping"],  # Extra column
            "Notes": ["Test note"]  # Another extra column
        })

        # Should not raise
        validate_transaction_dataframe(df)

    def test_reasonable_date_range(self) -> None:
        """Test validation with reasonable date ranges."""
        df = pd.DataFrame({
            "Date": [datetime(2020, 1, 1), datetime(2025, 6, 15)],
            "Merchant": ["Store A", "Store B"],
            "Amount": [10.50, 25.00]
        })

        # Should not raise with default date ranges
        validate_transaction_dataframe(df)

    def test_large_dataframe_validates(self) -> None:
        """Test validation of large DataFrame."""
        # Create 1000 rows
        df = pd.DataFrame({
            "Date": [datetime(2025, 1, i % 28 + 1) for i in range(1000)],
            "Merchant": [f"Store {i}" for i in range(1000)],
            "Amount": [10.50 + i * 0.1 for i in range(1000)]
        })

        # Should not raise
        validate_transaction_dataframe(df)


if __name__ == "__main__":
    unittest.main()