"""Extended tests for TransactionScreen to improve coverage."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock, Mock
import pandas as pd
import json
from textual.app import App
from textual.widgets import Button, DataTable
from expenses.screens.transaction_screen import TransactionScreen
from expenses.widgets.clearable_input import ClearableInput


class TestTransactionScreenExtended(unittest.IsolatedAsyncioTestCase):
    """Extended test suite for TransactionScreen."""

    def setUp(self) -> None:
        """Create temporary test data."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"
        self.categories_file = Path(self.test_dir) / "categories.json"

        # Create test transactions with Category column
        self.test_transactions = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    ["2025-01-15", "2025-02-10", "2025-03-05", "2025-01-20"]
                ),
                "Merchant": ["Starbucks", "Shell Gas", "Walmart", "Amazon"],
                "Amount": [5.50, 40.00, 100.00, 75.00],
                "Category": ["Food & Dining", "Transportation", "Shopping", "Shopping"],
            }
        )

        self.test_categories = {
            "Starbucks": "Food & Dining",
            "Shell Gas": "Transportation",
            "Walmart": "Shopping",
            "Amazon": "Shopping",
        }

    async def test_screen_with_category_filter(self) -> None:
        """Test screen initialization with category filter."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                # Create screen with category filter
                screen = TransactionScreen(category="Shopping")
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Title should reflect the filter
                title = pilot.app.screen.query_one(".title")
                assert "Shopping" in str(title.render())

    async def test_screen_with_year_filter(self) -> None:
        """Test screen initialization with year filter."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                # Create screen with year filter
                screen = TransactionScreen(year=2025)
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Date filters should be pre-filled
                date_min = pilot.app.screen.query_one(
                    "#date_min_filter", ClearableInput
                )
                date_max = pilot.app.screen.query_one(
                    "#date_max_filter", ClearableInput
                )

                assert date_min.value == "2025-01-01"
                assert date_max.value == "2025-12-31"

    async def test_screen_with_year_and_month_filter(self) -> None:
        """Test screen initialization with year and month filter."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                # Create screen with year and month filter
                screen = TransactionScreen(year=2025, month=2)
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Date filters should be pre-filled for February
                date_min = pilot.app.screen.query_one(
                    "#date_min_filter", ClearableInput
                )
                date_max = pilot.app.screen.query_one(
                    "#date_max_filter", ClearableInput
                )

                assert date_min.value == "2025-02-01"
                assert date_max.value == "2025-02-28"

    async def test_on_screen_resume_reloads_data(self) -> None:
        """Test that screen resume reloads data."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                initial_count = len(screen.transactions)

                # Add more transactions
                new_transactions = pd.concat(
                    [
                        self.test_transactions,
                        pd.DataFrame(
                            {
                                "Date": [pd.to_datetime("2025-04-01")],
                                "Merchant": ["Target"],
                                "Amount": [50.00],
                            }
                        ),
                    ]
                )
                new_transactions.to_parquet(self.transactions_file, index=False)

                # Trigger screen resume
                event = Mock()
                screen.on_screen_resume(event)
                await pilot.pause()

                # Should have more transactions
                assert len(screen.transactions) == initial_count + 1

    async def test_input_changed_triggers_repopulate(self) -> None:
        """Test that changing input triggers table repopulation."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                initial_display_count = len(screen.display_df)

                # Change merchant filter
                merchant_filter = pilot.app.screen.query_one(
                    "#merchant_filter", ClearableInput
                )
                merchant_filter.value = "Starbucks"
                await pilot.pause()

                # Should have fewer displayed transactions
                assert len(screen.display_df) < initial_display_count

    async def test_table_displays_transactions(self) -> None:
        """Test that table displays transactions correctly."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Table should have rows
                table = pilot.app.screen.query_one("#transaction_table", DataTable)
                assert table.row_count > 0

    async def test_toggle_selection_adds_and_removes(self) -> None:
        """Test toggling selection adds and removes rows."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Toggle selection on first row
                screen.action_toggle_selection()
                await pilot.pause()
                assert len(screen.selected_rows) == 1

                # Toggle again to deselect
                screen.action_toggle_selection()
                await pilot.pause()
                assert len(screen.selected_rows) == 0

    async def test_delete_button_pressed(self) -> None:
        """Test delete button press triggers deletion."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            app.push_confirmation = MagicMock()

            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Select a row
                screen.action_toggle_selection()
                await pilot.pause()

                # Press delete button
                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                delete_button.press()
                await pilot.pause()

                # Should trigger confirmation
                assert pilot.app.push_confirmation.called

    async def test_delete_selected_with_no_selection(self) -> None:
        """Test delete with no selection does nothing."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            app.push_confirmation = MagicMock()

            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Try to delete without selecting anything
                screen.delete_selected_transactions()
                await pilot.pause()

                # Should not trigger confirmation
                assert not pilot.app.push_confirmation.called

    async def test_update_table_method(self) -> None:
        """Test update_table method repopulates."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                initial_display_count = len(screen.display_df)

                # Call update_table
                screen.update_table()
                await pilot.pause()

                # Should still have same count (no filters changed)
                assert len(screen.display_df) == initial_display_count

    async def test_empty_transactions_display(self) -> None:
        """Test display with no transactions."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
        ):

            # Create empty transactions
            empty_df = pd.DataFrame(columns=["Date", "Merchant", "Amount"])
            empty_df.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps({}))

            app = App()
            async with app.run_test() as pilot:
                screen = TransactionScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Should have empty display
                assert len(screen.display_df) == 0


if __name__ == "__main__":
    unittest.main()
