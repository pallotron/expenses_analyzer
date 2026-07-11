"""Extended tests for TransactionScreen to improve coverage."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock, Mock
import pandas as pd
import json
from textual.app import App
from textual.containers import Vertical
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

        # Create test transactions with all required columns
        # Use current year+month: TransactionScreen() defaults to current month filter
        from datetime import datetime

        now = datetime.now()
        self.test_transactions = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    [
                        f"{now.year}-{now.month:02d}-01",
                        f"{now.year}-{now.month:02d}-05",
                        f"{now.year}-{now.month:02d}-10",
                        f"{now.year}-{now.month:02d}-15",
                    ]
                ),
                "Merchant": ["Starbucks", "Shell Gas", "Walmart", "Amazon"],
                "Amount": [5.50, 40.00, 100.00, 75.00],
                "Category": ["Food & Dining", "Transportation", "Shopping", "Shopping"],
                "Source": ["CSV Import", "CSV Import", "CSV Import", "CSV Import"],
                "Deleted": [False, False, False, False],
                "Type": ["expense", "expense", "expense", "expense"],
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

                # Add more transactions with all required columns
                from datetime import datetime

                current_year = datetime.now().year
                new_transactions = pd.concat(
                    [
                        self.test_transactions,
                        pd.DataFrame(
                            {
                                "Date": [pd.to_datetime(f"{current_year}-04-01")],
                                "Merchant": ["Target"],
                                "Amount": [50.00],
                                "Category": ["Shopping"],
                                "Source": ["CSV Import"],
                                "Deleted": [False],
                                "Type": ["expense"],
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

    async def test_typing_does_not_filter_until_applied(self) -> None:
        """Typing in a filter does nothing; Apply Filters triggers filtering."""
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

                merchant_filter = pilot.app.screen.query_one(
                    "#merchant_filter", ClearableInput
                )
                merchant_filter.value = "Starbucks"
                await pilot.pause()

                # Typing alone must not filter
                assert len(screen.display_df) == initial_display_count

                pilot.app.screen.query_one("#apply_filters_button", Button).press()
                await pilot.pause()
                assert len(screen.display_df) == 1

    async def test_clear_filters_resets_everything(self) -> None:
        """Clear Filters empties inputs, resets budget toggle, repopulates."""
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

                merchant_filter = pilot.app.screen.query_one(
                    "#merchant_filter", ClearableInput
                )
                merchant_filter.value = "Starbucks"
                pilot.app.screen.query_one("#apply_filters_button", Button).press()
                await pilot.pause()
                assert len(screen.display_df) == 1

                screen.filter_budget_type = "essential"
                pilot.app.screen.query_one("#clear_filters_button", Button).press()
                await pilot.pause()

                assert merchant_filter.value == ""
                date_min = pilot.app.screen.query_one(
                    "#date_min_filter", ClearableInput
                )
                assert date_min.value == ""
                assert screen.filter_budget_type is None
                assert len(screen.display_df) == len(self.test_transactions)

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

    async def test_budget_buttons_set_filter(self) -> None:
        """Budget buttons set filter_budget_type and press x cycles it."""
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

                essential_button = pilot.app.screen.query_one(
                    "#budget_essential_button", Button
                )
                essential_button.press()
                await pilot.pause()
                assert screen.filter_budget_type == "essential"
                assert essential_button.variant == "primary"

                await pilot.press("x")
                assert screen.filter_budget_type == "discretionary"
                await pilot.press("x")
                assert screen.filter_budget_type is None

    async def test_filter_inputs_have_labels(self) -> None:
        """Every filter input has a visible label above it."""
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

                labels = pilot.app.screen.query(".filter-label")
                label_texts = {str(label.render()) for label in labels}
                assert label_texts == {
                    "Start date",
                    "End date",
                    "Merchant",
                    "Min amount",
                    "Max amount",
                    "Source",
                    "Category",
                    "Tags",
                }

    async def test_tables_stacked_vertically(self) -> None:
        """The content split container is a Vertical (tables stacked)."""
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

                split = pilot.app.screen.query_one(".content-split")
                assert isinstance(split, Vertical)


if __name__ == "__main__":
    unittest.main()
