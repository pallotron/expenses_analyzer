"""Tests for ImportScreen."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pandas as pd
from textual.app import App
from textual.widgets import Button, Input, DataTable, Select, Checkbox
from expenses.screens.import_screen import ImportScreen


class TestImportScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for ImportScreen."""

    def setUp(self) -> None:
        """Create temporary test data."""
        self.test_dir = tempfile.mkdtemp()
        self.test_csv = Path(self.test_dir) / "test.csv"
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"
        self.categories_file = Path(self.test_dir) / "categories.json"

        # Create a test CSV file
        test_data = """Date,Merchant,Amount
2025-01-01,Starbucks,5.50
2025-01-02,Shell Gas,40.00
2025-01-03,Walmart,100.00"""
        self.test_csv.write_text(test_data)

    async def test_screen_composition(self) -> None:
        """Test that import screen has required elements."""
        app = App()
        async with app.run_test() as pilot:
            screen = ImportScreen()
            await pilot.app.push_screen(screen)

            # Check required widgets
            assert pilot.app.screen.query_one("#file_path_input", Input)
            assert pilot.app.screen.query_one("#browse_button", Button)
            assert pilot.app.screen.query_one("#file_preview", DataTable)
            assert pilot.app.screen.query_one("#date_select", Select)
            assert pilot.app.screen.query_one("#merchant_select", Select)
            assert pilot.app.screen.query_one("#amount_select", Select)
            assert pilot.app.screen.query_one("#suggest_categories_checkbox", Checkbox)
            assert pilot.app.screen.query_one("#import_button", Button)

    async def test_import_button_initially_disabled(self) -> None:
        """Test that import button is initially disabled."""
        app = App()
        async with app.run_test() as pilot:
            screen = ImportScreen()
            await pilot.app.push_screen(screen)

            import_button = pilot.app.screen.query_one("#import_button", Button)
            assert import_button.disabled is True

    async def test_preview_hidden_on_mount(self) -> None:
        """Test that preview sections are hidden on mount."""
        app = App()
        async with app.run_test() as pilot:
            screen = ImportScreen()
            await pilot.app.push_screen(screen)

            assert pilot.app.screen.query_one("#file_preview_label").display is False
            assert pilot.app.screen.query_one("#file_preview").display is False
            assert pilot.app.screen.query_one("#map_columns_label").display is False

    async def test_handle_file_select(self) -> None:
        """Test handling file selection."""
        app = App()
        async with app.run_test() as pilot:
            screen = ImportScreen()
            await pilot.app.push_screen(screen)

            # Simulate file selection
            screen.handle_file_select(str(self.test_csv))
            await pilot.pause(0.1)

            # File path should be set
            assert screen.file_path == str(self.test_csv)
            file_input = pilot.app.screen.query_one("#file_path_input", Input)
            assert file_input.value == str(self.test_csv)

    async def test_load_and_preview_csv(self) -> None:
        """Test loading and previewing CSV file."""
        app = App()
        async with app.run_test() as pilot:
            screen = ImportScreen()
            await pilot.app.push_screen(screen)

            # Set file path and load
            screen.file_path = str(self.test_csv)
            screen.load_and_preview_csv()
            await pilot.pause()

            # DataFrame should be loaded
            assert screen.df is not None
            assert len(screen.df) == 3

            # Preview should be visible
            assert pilot.app.screen.query_one("#file_preview_label").display is True
            assert pilot.app.screen.query_one("#file_preview").display is True
            assert pilot.app.screen.query_one("#map_columns_label").display is True

            # Import button should be enabled
            import_button = pilot.app.screen.query_one("#import_button", Button)
            assert import_button.disabled is False

            # Selects should have options
            date_select = pilot.app.screen.query_one("#date_select", Select)
            assert len(date_select._options) > 0

    async def test_browse_button_exists(self) -> None:
        """Test that browse button exists and triggers file browser screen."""
        app = App()

        async with app.run_test() as pilot:
            screen = ImportScreen()
            await pilot.app.push_screen(screen)

            # Browse button should exist
            browse_button = pilot.app.screen.query_one("#browse_button", Button)
            assert browse_button is not None
            assert browse_button.id == "browse_button"

    async def test_import_data_with_negative_amounts(self) -> None:
        """Test importing data with negative amounts (expenses)."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file), \
             patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Create CSV with negative amounts (expenses)
            expense_csv = Path(self.test_dir) / "expenses.csv"
            expense_data = """Date,Store,Price
01/01/2025,Coffee Shop,-5.50
02/01/2025,Gas Station,-40.00"""
            expense_csv.write_text(expense_data)

            app = App()
            app.pop_screen = MagicMock()

            async with app.run_test() as pilot:
                screen = ImportScreen()
                await pilot.app.push_screen(screen)

                # Load CSV
                screen.file_path = str(expense_csv)
                screen.load_and_preview_csv()
                await pilot.pause()

                # Set column mappings
                date_select = pilot.app.screen.query_one("#date_select", Select)
                date_select.value = "Date"
                merchant_select = pilot.app.screen.query_one("#merchant_select", Select)
                merchant_select.value = "Store"
                amount_select = pilot.app.screen.query_one("#amount_select", Select)
                amount_select.value = "Price"

                # Import data
                screen.import_data()
                await pilot.pause()

                # Verify transactions were saved
                assert self.transactions_file.exists()
                df = pd.read_parquet(self.transactions_file)
                assert len(df) == 2
                assert all(df["Amount"] > 0)  # Should convert to positive

    async def test_import_skips_positive_amounts(self) -> None:
        """Test that import skips positive amounts (income)."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file), \
             patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Create CSV with mixed amounts
            mixed_csv = Path(self.test_dir) / "mixed.csv"
            mixed_data = """Date,Store,Amount
01/01/2025,Coffee Shop,-5.50
02/01/2025,Salary,2000.00
03/01/2025,Gas Station,-40.00"""
            mixed_csv.write_text(mixed_data)

            app = App()
            app.pop_screen = MagicMock()

            async with app.run_test() as pilot:
                screen = ImportScreen()
                await pilot.app.push_screen(screen)

                screen.file_path = str(mixed_csv)
                screen.load_and_preview_csv()
                await pilot.pause()

                # Set column mappings
                date_select = pilot.app.screen.query_one("#date_select", Select)
                date_select.value = "Date"
                merchant_select = pilot.app.screen.query_one("#merchant_select", Select)
                merchant_select.value = "Store"
                amount_select = pilot.app.screen.query_one("#amount_select", Select)
                amount_select.value = "Amount"

                # Import data
                screen.import_data()
                await pilot.pause()

                # Only negative amounts (expenses) should be imported
                df = pd.read_parquet(self.transactions_file)
                assert len(df) == 2  # Salary should be skipped
                assert "Salary" not in df["Merchant"].values

    async def test_import_skips_invalid_dates(self) -> None:
        """Test that import skips rows with invalid dates."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file), \
             patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Create CSV with invalid date
            invalid_csv = Path(self.test_dir) / "invalid.csv"
            invalid_data = """Date,Store,Amount
01/01/2025,Coffee Shop,-5.50
INVALID_DATE,Gas Station,-40.00
03/01/2025,Walmart,-100.00"""
            invalid_csv.write_text(invalid_data)

            app = App()
            app.pop_screen = MagicMock()

            async with app.run_test() as pilot:
                screen = ImportScreen()
                await pilot.app.push_screen(screen)

                screen.file_path = str(invalid_csv)
                screen.load_and_preview_csv()
                await pilot.pause()

                # Set column mappings
                date_select = pilot.app.screen.query_one("#date_select", Select)
                date_select.value = "Date"
                merchant_select = pilot.app.screen.query_one("#merchant_select", Select)
                merchant_select.value = "Store"
                amount_select = pilot.app.screen.query_one("#amount_select", Select)
                amount_select.value = "Amount"

                # Import data
                screen.import_data()
                await pilot.pause()

                # Only valid dates should be imported
                df = pd.read_parquet(self.transactions_file)
                assert len(df) == 2
                assert "Gas Station" not in df["Merchant"].values

    async def test_import_skips_empty_merchants(self) -> None:
        """Test that import skips rows with empty merchants."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file), \
             patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Create CSV with empty merchant
            empty_csv = Path(self.test_dir) / "empty.csv"
            empty_data = """Date,Store,Amount
01/01/2025,Coffee Shop,-5.50
02/01/2025,,-40.00
03/01/2025,Walmart,-100.00"""
            empty_csv.write_text(empty_data)

            app = App()
            app.pop_screen = MagicMock()

            async with app.run_test() as pilot:
                screen = ImportScreen()
                await pilot.app.push_screen(screen)

                screen.file_path = str(empty_csv)
                screen.load_and_preview_csv()
                await pilot.pause()

                # Set column mappings
                date_select = pilot.app.screen.query_one("#date_select", Select)
                date_select.value = "Date"
                merchant_select = pilot.app.screen.query_one("#merchant_select", Select)
                merchant_select.value = "Store"
                amount_select = pilot.app.screen.query_one("#amount_select", Select)
                amount_select.value = "Amount"

                # Import data
                screen.import_data()
                await pilot.pause()

                # Only rows with merchants should be imported
                df = pd.read_parquet(self.transactions_file)
                assert len(df) == 2


if __name__ == "__main__":
    unittest.main()
