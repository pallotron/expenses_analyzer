"""Extended tests for data_handler to improve coverage."""

import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch
import pandas as pd

from expenses.data_handler import (
    load_transactions_from_parquet,
    save_transactions_to_parquet,
    append_transactions,
    delete_transactions,
    load_categories,
    save_categories,
    load_default_categories,
    clean_amount,
)


class TestDataHandlerExtended(unittest.IsolatedAsyncioTestCase):
    """Extended test suite for data_handler module."""

    def setUp(self) -> None:
        """Create temporary test files."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"
        self.categories_file = Path(self.test_dir) / "categories.json"
        self.default_categories_file = Path(self.test_dir) / "default_categories.json"

    def test_save_and_load_categories(self) -> None:
        """Test saving and loading categories."""
        with (
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Save categories
            test_categories = {
                "Starbucks": "Food & Dining",
                "Shell Gas": "Transportation",
            }
            save_categories(test_categories)

            # File should exist
            assert self.categories_file.exists()

            # Load categories
            loaded = load_categories()
            assert loaded == test_categories

    def test_load_default_categories(self) -> None:
        """Test loading default categories."""
        with patch(
            "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
            self.default_categories_file,
        ):

            # Create default categories file
            default_cats = ["Food & Dining", "Transportation", "Shopping"]
            self.default_categories_file.write_text(json.dumps(default_cats))

            # Load
            loaded = load_default_categories()
            assert loaded == default_cats

    def test_load_default_categories_uses_package_default(self) -> None:
        """Test loading default categories uses package default when custom file missing."""
        # Don't patch - let it use the actual package file
        loaded = load_default_categories()
        # Should have some default categories from the package
        assert len(loaded) > 0
        assert isinstance(loaded, list)

    def test_delete_transactions(self) -> None:
        """Test deleting transactions."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):

            # Create initial transactions
            transactions = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
                    "Merchant": ["A", "B", "C"],
                    "Amount": [10.0, 20.0, 30.0],
                }
            )
            save_transactions_to_parquet(transactions)

            # Delete one transaction
            to_delete = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-02"]),
                    "Merchant": ["B"],
                    "Amount": [20.0],
                }
            )
            delete_transactions(to_delete)

            # Load and verify
            remaining = load_transactions_from_parquet()
            assert len(remaining) == 2
            assert "B" not in remaining["Merchant"].values

    def test_append_transactions_with_deduplication(self) -> None:
        """Test append_transactions deduplicates correctly."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            # Initial transactions
            initial = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01", "2025-01-02"]),
                    "Merchant": ["A", "B"],
                    "Amount": [10.0, 20.0],
                }
            )
            save_transactions_to_parquet(initial)

            # Append with one duplicate and one new
            new = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-02", "2025-01-03"]),
                    "Merchant": ["B", "C"],
                    "Amount": [20.0, 30.0],
                }
            )
            append_transactions(new, suggest_categories=False)

            # Should have 3 total (not 4)
            result = load_transactions_from_parquet()
            assert len(result) == 3

    def test_append_transactions_to_empty_file(self) -> None:
        """Test appending transactions when no file exists."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            # Append to non-existent file
            new = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01"]),
                    "Merchant": ["A"],
                    "Amount": [10.0],
                }
            )
            append_transactions(new, suggest_categories=False)

            # Should create file with transaction
            result = load_transactions_from_parquet()
            assert len(result) == 1

    def test_append_transactions_with_category_column(self) -> None:
        """Test appending transactions that already have Category column."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            # Append transactions with Category already set
            new = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01"]),
                    "Merchant": ["A"],
                    "Amount": [10.0],
                    "Category": ["Food"],
                }
            )
            append_transactions(new, suggest_categories=False)

            result = load_transactions_from_parquet()
            assert "Category" in result.columns

    def test_clean_amount_with_various_formats(self) -> None:
        """Test clean_amount with various input formats."""
        # Test with currency symbols
        amounts = pd.Series(["$100.50", "€50.25", "£75.00"])
        cleaned = clean_amount(amounts)
        assert cleaned.tolist() == [100.50, 50.25, 75.00]

        # Test with parentheses (negative)
        amounts = pd.Series(["(100.00)", "(50.50)"])
        cleaned = clean_amount(amounts)
        assert cleaned.tolist() == [-100.00, -50.50]

        # Test with dash (zero)
        amounts = pd.Series(["-", "-"])
        cleaned = clean_amount(amounts)
        assert cleaned.tolist() == [0.0, 0.0]

        # Test with mixed
        amounts = pd.Series(["$100", "(50)", "25.50", "-"])
        cleaned = clean_amount(amounts)
        assert cleaned.tolist() == [100.0, -50.0, 25.50, 0.0]

    def test_clean_amount_with_commas(self) -> None:
        """Test clean_amount with comma thousands separators."""
        amounts = pd.Series(["1,000.50", "2,500.00", "$3,000"])
        cleaned = clean_amount(amounts)
        assert cleaned.tolist() == [1000.50, 2500.00, 3000.0]

    def test_save_transactions_creates_directory(self) -> None:
        """Test that save_transactions creates directory if needed."""
        nested_dir = Path(self.test_dir) / "nested" / "path"
        nested_file = nested_dir / "transactions.parquet"

        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", nested_file),
            patch("expenses.data_handler.CONFIG_DIR", nested_dir),
        ):

            transactions = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01"]),
                    "Merchant": ["A"],
                    "Amount": [10.0],
                }
            )

            save_transactions_to_parquet(transactions)

            # Directory and file should be created
            assert nested_file.exists()

    def test_load_categories_empty_file(self) -> None:
        """Test loading categories from empty/missing file."""
        with patch(
            "expenses.data_handler.CATEGORIES_FILE",
            Path(self.test_dir) / "missing.json",
        ):

            loaded = load_categories()
            assert loaded == {}

    def test_append_transactions_normalizes_columns(self) -> None:
        """Test that append_transactions handles missing Category column."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            # Create initial with Category
            initial = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01"]),
                    "Merchant": ["A"],
                    "Amount": [10.0],
                    "Category": ["Food"],
                }
            )
            save_transactions_to_parquet(initial)

            # Append without Category
            new = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-02"]),
                    "Merchant": ["B"],
                    "Amount": [20.0],
                }
            )
            append_transactions(new, suggest_categories=False)

            result = load_transactions_from_parquet()
            # Both should have Category column
            assert "Category" in result.columns
            assert len(result) == 2


if __name__ == "__main__":
    unittest.main()
