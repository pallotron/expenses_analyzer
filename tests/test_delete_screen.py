"""Tests for BuildDeleteScreen."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pandas as pd
from textual.app import App
from textual.widgets import Input, Button, DataTable, RadioButton
from expenses.screens.delete_screen import BuildDeleteScreen


class TestDeleteScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for BuildDeleteScreen."""

    def setUp(self) -> None:
        """Create temporary test data."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"

        # Create test transactions
        self.test_transactions = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
                "Merchant": ["Starbucks", "Shell Gas", "Starbucks"],
                "Amount": [5.50, 40.00, 6.00],
            }
        )

    async def test_screen_composition(self) -> None:
        """Test that delete screen has required elements."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)

                # Check that required widgets are present
                assert pilot.app.screen.query_one("#pattern_input", Input)
                assert pilot.app.screen.query_one("#date_min_filter", Input)
                assert pilot.app.screen.query_one("#date_max_filter", Input)
                assert pilot.app.screen.query_one("#preview_button", Button)
                assert pilot.app.screen.query_one("#delete_button", Button)
                assert pilot.app.screen.query_one("#preview_table", DataTable)
                assert pilot.app.screen.query_one("#regex_button", RadioButton)
                assert pilot.app.screen.query_one("#glob_button", RadioButton)

    async def test_delete_button_initially_disabled(self) -> None:
        """Test that delete button is initially disabled."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)

                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                assert delete_button.disabled is True

    async def test_regex_selected_by_default(self) -> None:
        """Test that regex radio button is selected by default."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                regex_button = pilot.app.screen.query_one("#regex_button", RadioButton)
                assert regex_button.value is True

    async def test_preview_with_merchant_pattern(self) -> None:
        """Test previewing transactions with merchant pattern."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Set pattern to match Starbucks
                pattern_input = pilot.app.screen.query_one("#pattern_input", Input)
                pattern_input.value = "Starbucks"

                # Click preview button
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Check that preview shows matches
                summary = pilot.app.screen.query_one("#preview_summary")
                assert "2 transactions" in str(summary.render())
                assert "11.50" in str(
                    summary.render()
                )  # Total of two Starbucks transactions

                # Delete button should now be enabled
                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                assert delete_button.disabled is False

    async def test_preview_with_date_filter(self) -> None:
        """Test previewing transactions with date filter."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Set date filter
                date_min_input = pilot.app.screen.query_one("#date_min_filter", Input)
                date_min_input.value = "2025-01-02"
                date_max_input = pilot.app.screen.query_one("#date_max_filter", Input)
                date_max_input.value = "2025-01-02"

                # Click preview
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Should show only one transaction
                summary = pilot.app.screen.query_one("#preview_summary")
                assert "1 transactions" in str(
                    summary.render()
                ) or "1 transaction" in str(summary.render())

    async def test_preview_with_no_matches(self) -> None:
        """Test previewing when no transactions match."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Set pattern that won't match anything
                pattern_input = pilot.app.screen.query_one("#pattern_input", Input)
                pattern_input.value = "NonexistentMerchant"

                # Click preview
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Should show no matches message
                summary = pilot.app.screen.query_one("#preview_summary")
                assert "No transactions match" in str(summary.render())

                # Delete button should remain disabled
                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                assert delete_button.disabled is True

    async def test_glob_pattern_conversion(self) -> None:
        """Test that glob patterns are converted to regex."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Select glob mode
                glob_button = pilot.app.screen.query_one("#glob_button", RadioButton)
                glob_button.value = True
                await pilot.pause()

                # Use glob pattern
                pattern_input = pilot.app.screen.query_one("#pattern_input", Input)
                pattern_input.value = "Star*"

                # Click preview
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Should match Starbucks
                summary = pilot.app.screen.query_one("#preview_summary")
                assert "2 transactions" in str(summary.render())

    async def test_invalid_regex_shows_error(self) -> None:
        """Test that invalid regex pattern shows error message."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Set invalid regex pattern
                pattern_input = pilot.app.screen.query_one("#pattern_input", Input)
                pattern_input.value = "[invalid"  # Unclosed bracket

                # Click preview
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Should show error message
                summary = pilot.app.screen.query_one("#preview_summary")
                assert "Invalid regex" in str(summary.render())

                # Delete button should be disabled
                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                assert delete_button.disabled is True

    async def test_input_change_disables_delete_button(self) -> None:
        """Test that changing input disables delete button."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # First do a preview to enable delete button
                pattern_input = pilot.app.screen.query_one("#pattern_input", Input)
                pattern_input.value = "Starbucks"
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Verify delete button is enabled
                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                assert delete_button.disabled is False

                # Change the input
                pattern_input.value = "Shell"
                await pilot.pause()

                # Delete button should be disabled again
                assert delete_button.disabled is True

    async def test_delete_with_confirmation(self) -> None:
        """Test that delete button triggers confirmation."""
        with patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file):
            self.test_transactions.to_parquet(self.transactions_file, index=False)

            app = App()
            # Mock the push_confirmation method
            app.push_confirmation = MagicMock()

            async with app.run_test() as pilot:
                screen = BuildDeleteScreen()
                await pilot.app.push_screen(screen)
                await pilot.pause()

                # Do preview first
                pattern_input = pilot.app.screen.query_one("#pattern_input", Input)
                pattern_input.value = "Starbucks"
                preview_button = pilot.app.screen.query_one("#preview_button", Button)
                preview_button.press()
                await pilot.pause()

                # Click delete button
                delete_button = pilot.app.screen.query_one("#delete_button", Button)
                delete_button.press()
                await pilot.pause()

                # Verify confirmation was requested
                assert pilot.app.push_confirmation.called


if __name__ == "__main__":
    unittest.main()
