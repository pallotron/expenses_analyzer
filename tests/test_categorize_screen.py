"""Tests for CategorizeScreen."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pandas as pd
import json
from textual.app import App
from textual.widgets import Button, DataTable, Select
from expenses.screens.categorize_screen import CategorizeScreen
from expenses.widgets.clearable_input import ClearableInput


class TestCategorizeScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for CategorizeScreen."""

    def setUp(self) -> None:
        """Create temporary test data."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"
        self.categories_file = Path(self.test_dir) / "categories.json"
        self.default_categories_file = Path(self.test_dir) / "default_categories.json"

        # Create test transactions
        self.test_transactions = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"]
                ),
                "Merchant": ["Starbucks", "Shell Gas", "Walmart", "Starbucks"],
                "Amount": [5.50, 40.00, 100.00, 6.00],
            }
        )

        # Create test categories
        self.test_categories = {
            "Starbucks": "Food & Dining",
            "Shell Gas": "Transportation",
        }

        # Create default categories
        self.default_categories = [
            "Food & Dining",
            "Transportation",
            "Shopping",
            "Entertainment",
        ]

    async def test_screen_composition(self) -> None:
        """Test that categorize screen has required elements."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Check required widgets
                assert pilot.app.screen.query_one("#merchant_filter", ClearableInput)
                assert pilot.app.screen.query_one("#category_filter", ClearableInput)
                assert pilot.app.screen.query_one("#category_input", ClearableInput)
                assert pilot.app.screen.query_one("#category_select", Select)
                assert pilot.app.screen.query_one("#apply_button", Button)
                assert pilot.app.screen.query_one("#save_categories_button", Button)
                assert pilot.app.screen.query_one("#categorization_table", DataTable)

    async def test_loads_merchants_on_mount(self) -> None:
        """Test that merchants are loaded and displayed on mount."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Check that merchants are loaded
                assert (
                    len(screen.all_merchant_data) == 3
                )  # Starbucks, Shell Gas, Walmart (Starbucks deduplicated)

                # Verify table has rows
                table = pilot.app.screen.query_one("#categorization_table", DataTable)
                assert table.row_count > 0

    async def test_merchant_filter(self) -> None:
        """Test filtering merchants by name."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Apply merchant filter
                merchant_filter = pilot.app.screen.query_one(
                    "#merchant_filter", ClearableInput
                )
                merchant_filter.value = "star"
                await pilot.pause()

                # Should only show Starbucks
                assert len(screen.merchant_data) == 1
                assert screen.merchant_data[0]["Merchant"] == "Starbucks"

    async def test_category_filter(self) -> None:
        """Test filtering merchants by category."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Apply category filter
                category_filter = pilot.app.screen.query_one(
                    "#category_filter", ClearableInput
                )
                category_filter.value = "food"
                await pilot.pause()

                # Should only show merchants with Food & Dining category
                assert len(screen.merchant_data) == 1
                assert screen.merchant_data[0]["Category"] == "Food & Dining"

    async def test_combined_filters(self) -> None:
        """Test applying both merchant and category filters together."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Apply both filters
                merchant_filter = pilot.app.screen.query_one(
                    "#merchant_filter", ClearableInput
                )
                merchant_filter.value = "s"  # Matches Starbucks and Shell Gas
                await pilot.pause()

                category_filter = pilot.app.screen.query_one(
                    "#category_filter", ClearableInput
                )
                category_filter.value = "trans"  # Matches Transportation
                await pilot.pause()

                # Should only show Shell Gas (has 's' and is Transportation)
                assert len(screen.merchant_data) == 1
                assert screen.merchant_data[0]["Merchant"] == "Shell Gas"

    async def test_toggle_selection(self) -> None:
        """Test toggling row selection."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Toggle selection (space key)
                assert len(screen.selected_rows) == 0
                screen.action_toggle_selection()
                await pilot.pause()

                # One row should be selected
                assert len(screen.selected_rows) == 1

                # Toggle again to deselect
                screen.action_toggle_selection()
                await pilot.pause()

                # Should be deselected
                assert len(screen.selected_rows) == 0

    async def test_apply_category_to_selected(self) -> None:
        """Test applying a category to selected merchants."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Select Walmart (which should be at index 2 after sorting)
                walmart_index = next(
                    i
                    for i, item in enumerate(screen.merchant_data)
                    if item["Merchant"] == "Walmart"
                )
                screen.selected_rows.add(walmart_index)

                # Set new category
                category_input = pilot.app.screen.query_one(
                    "#category_input", ClearableInput
                )
                category_input.value = "Shopping"

                # Click apply button
                apply_button = pilot.app.screen.query_one("#apply_button", Button)
                apply_button.press()
                await pilot.pause()

                # Verify Walmart now has Shopping category
                walmart_data = next(
                    item
                    for item in screen.all_merchant_data
                    if item["Merchant"] == "Walmart"
                )
                assert walmart_data["Category"] == "Shopping"

    async def test_apply_category_with_no_selection(self) -> None:
        """Test that applying category with no selection does nothing."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                original_data = screen.all_merchant_data.copy()

                # No selection, set category
                category_input = pilot.app.screen.query_one(
                    "#category_input", ClearableInput
                )
                category_input.value = "New Category"

                # Click apply button
                apply_button = pilot.app.screen.query_one("#apply_button", Button)
                apply_button.press()
                await pilot.pause()

                # Data should not change
                assert screen.all_merchant_data == original_data

    async def test_save_categories(self) -> None:
        """Test saving categories to file."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            app.show_notification = MagicMock()
            app.pop_screen = MagicMock()

            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Modify a category
                walmart_index = next(
                    i
                    for i, item in enumerate(screen.merchant_data)
                    if item["Merchant"] == "Walmart"
                )
                screen.selected_rows.add(walmart_index)
                category_input = pilot.app.screen.query_one(
                    "#category_input", ClearableInput
                )
                category_input.value = "Shopping"
                apply_button = pilot.app.screen.query_one("#apply_button", Button)
                apply_button.press()
                await pilot.pause()

                # Save categories
                save_button = pilot.app.screen.query_one(
                    "#save_categories_button", Button
                )
                save_button.press()
                await pilot.pause()

                # Verify file was saved
                saved_data = json.loads(self.categories_file.read_text())
                assert "Walmart" in saved_data
                assert saved_data["Walmart"] == "Shopping"
                assert saved_data["Starbucks"] == "Food & Dining"

                # Verify notification was shown
                assert pilot.app.show_notification.called

    async def test_select_dropdown_updates_input(self) -> None:
        """Test that selecting from dropdown updates category input."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Simulate selecting from dropdown
                category_select = pilot.app.screen.query_one("#category_select", Select)

                # Create a mock event
                event = Select.Changed(category_select, "Shopping")
                screen.on_select_changed(event)
                await pilot.pause()

                # Category input should be updated
                category_input = pilot.app.screen.query_one(
                    "#category_input", ClearableInput
                )
                assert category_input.value == "Shopping"

    async def test_empty_transactions(self) -> None:
        """Test screen behavior with no transactions."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            # Create empty transactions
            empty_df = pd.DataFrame(columns=["Date", "Merchant", "Amount"])
            empty_df.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps({}))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Should have no merchant data
                assert len(screen.all_merchant_data) == 0
                assert len(screen.merchant_data) == 0

    async def test_screen_resume_reloads_data(self) -> None:
        """Test that screen resume reloads data."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                initial_count = len(screen.all_merchant_data)

                # Add a new transaction
                new_transactions = pd.concat(
                    [
                        self.test_transactions,
                        pd.DataFrame(
                            {
                                "Date": [pd.to_datetime("2025-01-05")],
                                "Merchant": ["Target"],
                                "Amount": [75.00],
                            }
                        ),
                    ]
                )
                new_transactions.to_parquet(self.transactions_file, index=False)

                # Simulate screen resume by calling the method directly
                from unittest.mock import Mock

                event = Mock()
                screen.on_screen_resume(event)
                await pilot.pause()

                # Merchant count should increase
                assert len(screen.all_merchant_data) == initial_count + 1

    async def test_categories_exclude_uncategorized_on_save(self) -> None:
        """Test that uncategorized merchants are not saved."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            # Start with empty categories
            self.categories_file.write_text(json.dumps({}))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            app.show_notification = MagicMock()
            app.pop_screen = MagicMock()

            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # All merchants should be Uncategorized
                assert all(
                    item["Category"] == "Uncategorized"
                    for item in screen.all_merchant_data
                )

                # Save without categorizing anything
                save_button = pilot.app.screen.query_one(
                    "#save_categories_button", Button
                )
                save_button.press()
                await pilot.pause()

                # Saved file should be empty (no uncategorized merchants saved)
                saved_data = json.loads(self.categories_file.read_text())
                assert len(saved_data) == 0

    async def test_auto_categorize_button_exists(self) -> None:
        """Test that auto-categorize button is present in the UI."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Check auto-categorize button exists
                assert pilot.app.screen.query_one("#auto_categorize_button", Button)

    async def test_auto_categorize_with_gemini_api(self) -> None:
        """Test auto-categorization with Gemini API."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("os.getenv") as mock_getenv,
            patch(
                "expenses.screens.categorize_screen.get_gemini_category_suggestions_for_merchants"
            ) as mock_gemini,
        ):

            # Mock GEMINI_API_KEY environment variable
            mock_getenv.return_value = "fake_api_key"

            # Mock Gemini API response
            mock_gemini.return_value = {
                "Walmart": "Shopping",
            }

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            # Only Starbucks and Shell Gas are categorized, Walmart is uncategorized
            self.categories_file.write_text(json.dumps(self.test_categories))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            app.show_notification = MagicMock()

            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Verify Walmart is uncategorized
                walmart_data = next(
                    (
                        item
                        for item in screen.all_merchant_data
                        if item["Merchant"] == "Walmart"
                    ),
                    None,
                )
                assert walmart_data is not None
                assert walmart_data["Category"] == "Uncategorized"

                # Click auto-categorize button
                auto_button = pilot.app.screen.query_one(
                    "#auto_categorize_button", Button
                )
                auto_button.press()
                await pilot.pause()
                await pilot.pause()  # Give worker time to complete

                # Verify Gemini was called with uncategorized merchants
                mock_gemini.assert_called_once_with(["Walmart"])

                # Verify Walmart is now categorized
                walmart_data = next(
                    (
                        item
                        for item in screen.all_merchant_data
                        if item["Merchant"] == "Walmart"
                    ),
                    None,
                )
                assert walmart_data["Category"] == "Shopping"

                # Verify categories were saved
                saved_data = json.loads(self.categories_file.read_text())
                assert saved_data["Walmart"] == "Shopping"

    async def test_auto_categorize_without_api_key(self) -> None:
        """Test auto-categorization without GEMINI_API_KEY shows error."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.data_handler.DEFAULT_CATEGORIES_FILE",
                self.default_categories_file,
            ),
        ):

            self.test_transactions.to_parquet(self.transactions_file, index=False)
            self.categories_file.write_text(json.dumps({}))
            self.default_categories_file.write_text(json.dumps(self.default_categories))

            app = App()
            app.show_notification = MagicMock()

            async with app.run_test() as pilot:
                screen = CategorizeScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Patch getenv only when clicking the button
                with patch("os.getenv") as mock_getenv:
                    mock_getenv.return_value = None

                    # Click auto-categorize button
                    auto_button = pilot.app.screen.query_one(
                        "#auto_categorize_button", Button
                    )
                    auto_button.press()
                    await pilot.pause()
                    await pilot.pause()

                    # Verify notification was shown
                    assert pilot.app.show_notification.called
                    call_args = pilot.app.show_notification.call_args[0][0]
                    assert "GEMINI_API_KEY" in call_args


if __name__ == "__main__":
    unittest.main()
