"""
Integration tests for complete workflows in the Expense Analyzer application.

These tests verify end-to-end functionality across multiple components,
testing realistic user workflows with actual file I/O operations.
"""

import unittest
import tempfile
import shutil
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
    clean_amount,
)
from expenses.transaction_filter import apply_filters


class TestCompleteCSVImportWorkflow(unittest.TestCase):
    """Test the complete workflow of importing CSV data and persisting to Parquet."""

    def setUp(self) -> None:
        """Create a temporary directory for test data."""
        self.test_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.test_dir)
        self.transactions_file = self.config_dir / "transactions.parquet"
        self.categories_file = self.config_dir / "categories.json"

    def tearDown(self) -> None:
        """Clean up temporary directory."""
        shutil.rmtree(self.test_dir)

    def test_complete_csv_import_workflow(self) -> None:
        """
        Test the complete CSV import workflow:
        1. Create CSV with transaction data
        2. Import and clean the data
        3. Save to Parquet
        4. Reload and verify persistence
        """
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            # Step 1: Create a CSV file with various amount formats
            csv_data = {
                "Date": ["01/01/2025", "01/02/2025", "01/03/2025", "01/04/2025"],
                "Merchant": [
                    "Coffee Shop",
                    "Gas Station",
                    "Grocery Store",
                    "Restaurant",
                ],
                "Amount": ["$12.50", "(25.00)", "€100.75", "50"],
            }
            df = pd.DataFrame(csv_data)

            # Step 2: Clean and prepare data as ImportScreen would
            df["Date"] = pd.to_datetime(df["Date"], format="%d/%m/%Y")
            df["Amount"] = clean_amount(df["Amount"])
            df["Merchant"] = df["Merchant"].astype(str)

            # Step 3: Append transactions (first import)
            append_transactions(df, suggest_categories=False)

            # Step 4: Verify data was saved correctly
            self.assertTrue(self.transactions_file.exists())
            loaded_df = load_transactions_from_parquet()
            self.assertEqual(len(loaded_df), 4)
            self.assertEqual(
                loaded_df["Merchant"].tolist(),
                ["Coffee Shop", "Gas Station", "Grocery Store", "Restaurant"],
            )
            # Verify amount cleaning worked
            self.assertEqual(
                loaded_df["Amount"].tolist(), [12.50, -25.00, 100.75, 50.0]
            )

            # Step 5: Import additional transactions (should deduplicate)
            csv_data_2 = {
                "Date": ["01/03/2025", "01/05/2025"],  # One duplicate, one new
                "Merchant": ["Grocery Store", "Bookstore"],
                "Amount": ["€100.75", "$30.00"],
            }
            df2 = pd.DataFrame(csv_data_2)
            df2["Date"] = pd.to_datetime(df2["Date"], format="%d/%m/%Y")
            df2["Amount"] = clean_amount(df2["Amount"])
            df2["Merchant"] = df2["Merchant"].astype(str)

            append_transactions(df2, suggest_categories=False)

            # Step 6: Verify deduplication worked
            loaded_df = load_transactions_from_parquet()
            self.assertEqual(
                len(loaded_df), 5
            )  # Should be 5, not 6 (duplicate removed)
            merchants = loaded_df["Merchant"].tolist()
            self.assertIn("Bookstore", merchants)
            self.assertEqual(merchants.count("Grocery Store"), 1)  # Not duplicated


class TestCategoryAssignmentWorkflow(unittest.TestCase):
    """Test the complete workflow of assigning and persisting categories."""

    def setUp(self) -> None:
        """Create a temporary directory for test data."""
        self.test_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.test_dir)
        self.transactions_file = self.config_dir / "transactions.parquet"
        self.categories_file = self.config_dir / "categories.json"

    def tearDown(self) -> None:
        """Clean up temporary directory."""
        shutil.rmtree(self.test_dir)

    def test_category_assignment_and_persistence(self) -> None:
        """
        Test the complete category assignment workflow:
        1. Create transactions without categories
        2. Assign categories to merchants
        3. Save categories
        4. Reload and verify persistence
        5. Verify transactions are enriched with categories
        """
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch("expenses.data_handler.CONFIG_DIR", self.config_dir),
        ):

            # Step 1: Create transactions
            transactions = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
                    "Merchant": ["Starbucks", "Shell Gas", "Starbucks"],
                    "Amount": [5.50, 40.00, 6.00],
                }
            )
            save_transactions_to_parquet(transactions)

            # Step 2: Assign categories (as CategorizeScreen would)
            categories = {
                "Starbucks": "Food & Dining",
                "Shell Gas": "Transportation",
            }
            save_categories(categories)

            # Step 3: Verify categories file was created
            self.assertTrue(self.categories_file.exists())

            # Step 4: Reload categories and verify persistence
            loaded_categories = load_categories()
            self.assertEqual(loaded_categories, categories)
            self.assertEqual(loaded_categories["Starbucks"], "Food & Dining")
            self.assertEqual(loaded_categories["Shell Gas"], "Transportation")

            # Step 5: Update categories (add new merchant)
            categories["Walmart"] = "Shopping"
            save_categories(categories)

            # Step 6: Verify updated categories persist
            loaded_categories = load_categories()
            self.assertEqual(len(loaded_categories), 3)
            self.assertEqual(loaded_categories["Walmart"], "Shopping")


class TestTransactionFilteringWorkflow(unittest.TestCase):
    """Test the complete workflow of filtering transactions."""

    def test_multi_filter_workflow(self) -> None:
        """
        Test applying multiple filters in sequence:
        1. Create diverse transaction dataset
        2. Apply date filters
        3. Apply merchant filters
        4. Apply amount filters
        5. Apply category filters
        6. Verify correct filtering logic
        """
        # Step 1: Create diverse dataset
        transactions = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    [
                        "2025-01-01",
                        "2025-01-15",
                        "2025-02-01",
                        "2025-02-15",
                        "2025-03-01",
                        "2025-03-15",
                    ]
                ),
                "Merchant": [
                    "Coffee Shop",
                    "Coffee Shop",
                    "Gas Station",
                    "Restaurant",
                    "Gas Station",
                    "Grocery Store",
                ],
                "Amount": [5.50, 6.00, 40.00, 75.00, 45.00, 120.00],
                "Category": [
                    "Food & Dining",
                    "Food & Dining",
                    "Transportation",
                    "Food & Dining",
                    "Transportation",
                    "Shopping",
                ],
            }
        )

        # Step 2: Apply date filter (February only)
        filters_feb = {
            "date_min": ("Date", ">=", pd.to_datetime("2025-02-01")),
            "date_max": ("Date", "<=", pd.to_datetime("2025-02-28")),
        }
        filtered = apply_filters(transactions, filters_feb)
        self.assertEqual(len(filtered), 2)
        self.assertTrue(all(filtered["Date"].dt.month == 2))

        # Step 3: Apply merchant filter with contains
        filters_gas = {
            "merchant": ("Merchant", "contains", "Gas"),
        }
        filtered = apply_filters(transactions, filters_gas)
        self.assertEqual(len(filtered), 2)
        # Verify both Gas Station entries are present
        self.assertEqual(list(filtered["Merchant"]), ["Gas Station", "Gas Station"])

        # Step 4: Apply amount filter (expensive transactions >= 50)
        filters_expensive = {
            "amount_min": ("Amount", ">=", 50.0),
        }
        filtered = apply_filters(transactions, filters_expensive)
        self.assertEqual(len(filtered), 2)  # Restaurant (75) and Grocery Store (120)
        self.assertTrue(all(filtered["Amount"] >= 50.0))

        # Step 5: Apply category filter
        filters_food = {
            "category": ("Category", "==", "Food & Dining"),
        }
        filtered = apply_filters(transactions, filters_food)
        self.assertEqual(len(filtered), 3)
        self.assertTrue(all(filtered["Category"] == "Food & Dining"))

        # Step 6: Apply combined filters (February food under $70)
        filters_combined = {
            "date_min": ("Date", ">=", pd.to_datetime("2025-02-01")),
            "date_max": ("Date", "<=", pd.to_datetime("2025-02-28")),
            "category": ("Category", "==", "Food & Dining"),
            "amount_max": ("Amount", "<=", 70.0),
        }
        filtered = apply_filters(transactions, filters_combined)
        # Should be empty - no food & dining in February under $70
        self.assertEqual(len(filtered), 0)

        # Step 7: Apply realistic combined filter
        filters_q1_transport = {
            "date_min": ("Date", ">=", pd.to_datetime("2025-01-01")),
            "date_max": ("Date", "<=", pd.to_datetime("2025-03-31")),
            "category": ("Category", "==", "Transportation"),
        }
        filtered = apply_filters(transactions, filters_q1_transport)
        self.assertEqual(len(filtered), 2)
        self.assertTrue(all(filtered["Category"] == "Transportation"))


class TestDeleteAndPersistenceWorkflow(unittest.TestCase):
    """Test the complete workflow of deleting transactions and data persistence."""

    def setUp(self) -> None:
        """Create a temporary directory for test data."""
        self.test_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.test_dir)
        self.transactions_file = self.config_dir / "transactions.parquet"

    def tearDown(self) -> None:
        """Clean up temporary directory."""
        shutil.rmtree(self.test_dir)

    def test_delete_and_persistence_workflow(self) -> None:
        """
        Test the complete delete workflow:
        1. Create and save transactions
        2. Delete specific transactions
        3. Verify immediate deletion
        4. Reload from disk and verify persistence
        """
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):

            # Step 1: Create and save transactions
            transactions = pd.DataFrame(
                {
                    "Date": pd.to_datetime(
                        [
                            "2025-01-01",
                            "2025-01-02",
                            "2025-01-03",
                            "2025-01-04",
                            "2025-01-05",
                        ]
                    ),
                    "Merchant": [
                        "Merchant A",
                        "Merchant B",
                        "Merchant C",
                        "Merchant D",
                        "Merchant E",
                    ],
                    "Amount": [10.00, 20.00, 30.00, 40.00, 50.00],
                }
            )
            save_transactions_to_parquet(transactions)

            # Step 2: Verify initial save
            loaded = load_transactions_from_parquet()
            self.assertEqual(len(loaded), 5)

            # Step 3: Delete specific transactions (as DeleteScreen would)
            to_delete = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-02", "2025-01-04"]),
                    "Merchant": ["Merchant B", "Merchant D"],
                    "Amount": [20.00, 40.00],
                }
            )
            delete_transactions(to_delete)

            # Step 4: Verify immediate deletion
            loaded = load_transactions_from_parquet()
            self.assertEqual(len(loaded), 3)
            remaining_merchants = loaded["Merchant"].tolist()
            self.assertIn("Merchant A", remaining_merchants)
            self.assertIn("Merchant C", remaining_merchants)
            self.assertIn("Merchant E", remaining_merchants)
            self.assertNotIn("Merchant B", remaining_merchants)
            self.assertNotIn("Merchant D", remaining_merchants)

            # Step 5: Reload from disk to verify persistence
            # This simulates closing and reopening the app
            loaded_again = load_transactions_from_parquet()
            self.assertEqual(len(loaded_again), 3)
            pd.testing.assert_frame_equal(loaded, loaded_again)


class TestEndToEndWorkflow(unittest.TestCase):
    """Test a complete end-to-end user workflow across all features."""

    def setUp(self) -> None:
        """Create a temporary directory for test data."""
        self.test_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.test_dir)
        self.transactions_file = self.config_dir / "transactions.parquet"
        self.categories_file = self.config_dir / "categories.json"

    def tearDown(self) -> None:
        """Clean up temporary directory."""
        shutil.rmtree(self.test_dir)

    def test_complete_user_workflow(self) -> None:
        """
        Test a complete user workflow:
        1. Import CSV transactions
        2. Categorize merchants
        3. Filter and view transactions
        4. Delete unwanted transactions
        5. Re-filter and verify final state
        6. Verify all data persists correctly
        """
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch("expenses.data_handler.CONFIG_DIR", self.config_dir),
        ):

            # Step 1: Import first batch of transactions (January)
            jan_transactions = pd.DataFrame(
                {
                    "Date": pd.to_datetime(
                        ["2025-01-05", "2025-01-10", "2025-01-15", "2025-01-20"]
                    ),
                    "Merchant": ["Starbucks", "Shell Gas", "Amazon", "Starbucks"],
                    "Amount": [5.50, 40.00, 99.99, 6.00],
                }
            )
            append_transactions(jan_transactions, suggest_categories=False)

            # Step 2: Import second batch (February)
            feb_transactions = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-02-05", "2025-02-10"]),
                    "Merchant": ["Shell Gas", "Walmart"],
                    "Amount": [45.00, 75.50],
                }
            )
            append_transactions(feb_transactions, suggest_categories=False)

            # Verify both imports worked
            all_transactions = load_transactions_from_parquet()
            self.assertEqual(len(all_transactions), 6)

            # Step 3: Categorize merchants
            categories = {
                "Starbucks": "Food & Dining",
                "Shell Gas": "Transportation",
                "Amazon": "Shopping",
                "Walmart": "Shopping",
            }
            save_categories(categories)

            # Step 4: Filter transactions (view January food & dining)
            categories_map = load_categories()
            all_transactions["Category"] = all_transactions["Merchant"].map(
                categories_map
            )

            filters_jan_food = {
                "date_min": ("Date", ">=", pd.to_datetime("2025-01-01")),
                "date_max": ("Date", "<=", pd.to_datetime("2025-01-31")),
                "category": ("Category", "==", "Food & Dining"),
            }
            filtered = apply_filters(all_transactions, filters_jan_food)
            self.assertEqual(len(filtered), 2)  # Two Starbucks transactions in Jan
            self.assertEqual(filtered["Amount"].sum(), 11.50)

            # Step 5: Delete test transaction (the small Starbucks purchase)
            to_delete = pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2025-01-05"]),
                    "Merchant": ["Starbucks"],
                    "Amount": [5.50],
                }
            )
            delete_transactions(to_delete)

            # Step 6: Reload and verify deletion
            all_transactions = load_transactions_from_parquet()
            self.assertEqual(len(all_transactions), 5)

            # Step 7: Re-apply filter and verify results
            all_transactions["Category"] = all_transactions["Merchant"].map(
                categories_map
            )
            filtered = apply_filters(all_transactions, filters_jan_food)
            self.assertEqual(len(filtered), 1)  # Only one Starbucks transaction now
            self.assertEqual(filtered["Amount"].sum(), 6.00)

            # Step 8: Verify total spending by category
            summary = all_transactions.groupby("Category")["Amount"].sum()
            self.assertAlmostEqual(summary["Food & Dining"], 6.00)
            self.assertAlmostEqual(summary["Transportation"], 85.00)
            self.assertAlmostEqual(summary["Shopping"], 175.49)

            # Step 9: Verify data persistence (simulate app restart)
            reloaded_transactions = load_transactions_from_parquet()
            reloaded_categories = load_categories()
            self.assertEqual(len(reloaded_transactions), 5)
            self.assertEqual(len(reloaded_categories), 4)

            # Final verification: Ensure data integrity
            reloaded_transactions["Category"] = reloaded_transactions["Merchant"].map(
                reloaded_categories
            )
            summary_after_reload = reloaded_transactions.groupby("Category")[
                "Amount"
            ].sum()
            pd.testing.assert_series_equal(summary, summary_after_reload)


if __name__ == "__main__":
    unittest.main()
