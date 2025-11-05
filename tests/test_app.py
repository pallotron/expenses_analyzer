"""Tests for ExpensesApp."""

import unittest
from unittest.mock import MagicMock
from expenses.app import ExpensesApp
from expenses.widgets.notification import Notification


class TestExpensesApp(unittest.IsolatedAsyncioTestCase):
    """Test suite for ExpensesApp."""

    async def test_app_composition(self) -> None:
        """Test that app has required widgets."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            # App should have header and footer
            from textual.widgets import Header, Footer

            assert pilot.app.query_one(Header)
            assert pilot.app.query_one(Footer)

    async def test_app_mounts_summary_screen(self) -> None:
        """Test that app mounts summary screen on startup."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()
            # Summary screen should be active
            from expenses.screens.summary_screen import SummaryScreen

            assert isinstance(pilot.app.screen, SummaryScreen)

    async def test_app_has_screens_registered(self) -> None:
        """Test that all screens are registered."""
        app = ExpensesApp()
        assert "summary" in app.SCREENS
        assert "import" in app.SCREENS
        assert "categorize" in app.SCREENS
        assert "file_browser" in app.SCREENS
        assert "transactions" in app.SCREENS
        assert "delete" in app.SCREENS

    async def test_app_has_bindings(self) -> None:
        """Test that app has key bindings defined."""
        app = ExpensesApp()
        binding_keys = {b.key for b in app.BINDINGS}
        assert "s" in binding_keys  # Summary
        assert "t" in binding_keys  # Transactions
        assert "i" in binding_keys  # Import
        assert "c" in binding_keys  # Categorize
        assert "D" in binding_keys  # Delete (uppercase D)
        assert "escape" in binding_keys  # Back
        assert "ctrl+q" in binding_keys  # Quit

    async def test_action_pop_screen_with_multiple_screens(self) -> None:
        """Test that pop_screen works with multiple screens."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()
            initial_stack_size = len(pilot.app.screen_stack)

            # Push another screen
            await pilot.app.push_screen("import")
            await pilot.pause()
            assert len(pilot.app.screen_stack) == initial_stack_size + 1

            # Pop it
            pilot.app.action_pop_screen()
            await pilot.pause()
            assert len(pilot.app.screen_stack) == initial_stack_size

    async def test_action_pop_screen_does_not_pop_last_screen(self) -> None:
        """Test that pop_screen doesn't pop the last screen."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause(0.2)

            # The summary screen is automatically pushed on mount
            # Try to pop - should not pop the last screen
            pilot.app.action_pop_screen()
            await pilot.pause()

            # Should still have at least one screen
            assert len(pilot.app.screen_stack) >= 1

    async def test_action_quit(self) -> None:
        """Test that quit action exits the app."""
        app = ExpensesApp()
        app.exit = MagicMock()

        async with app.run_test() as pilot:
            pilot.app.action_quit()
            await pilot.pause()

            # Exit should be called
            assert pilot.app.exit.called

    async def test_push_confirmation(self) -> None:
        """Test pushing a confirmation screen."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            callback = MagicMock()

            # Push confirmation
            pilot.app.push_confirmation("Are you sure?", callback)
            await pilot.pause()

            # Should now be on confirmation screen
            from expenses.screens.confirmation_screen import ConfirmationScreen

            assert isinstance(pilot.app.screen, ConfirmationScreen)

    async def test_show_notification(self) -> None:
        """Test showing a notification."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()

            # Show notification
            pilot.app.show_notification("Test message", timeout=1)
            await pilot.pause()

            # Notification should exist
            notifications = pilot.app.screen.query(Notification)
            assert len(notifications) > 0

    async def test_show_notification_with_default_timeout(self) -> None:
        """Test showing a notification with default timeout."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()

            # Show notification without timeout param
            pilot.app.show_notification("Test message")
            await pilot.pause()

            # Notification should exist with default timeout
            notification = pilot.app.screen.query_one(Notification)
            assert notification.timeout == 3

    async def test_keyboard_shortcuts(self) -> None:
        """Test that keyboard shortcuts work."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()

            # Press 'i' to go to import screen
            await pilot.press("i")
            await pilot.pause()

            from expenses.screens.import_screen import ImportScreen

            assert isinstance(pilot.app.screen, ImportScreen)

            # Press 'c' to go to categorize screen
            await pilot.press("c")
            await pilot.pause()

            from expenses.screens.categorize_screen import CategorizeScreen

            assert isinstance(pilot.app.screen, CategorizeScreen)

    async def test_escape_key_pops_screen(self) -> None:
        """Test that escape key pops a screen."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()

            # Push a screen
            await pilot.app.push_screen("import")
            await pilot.pause()
            from expenses.screens.import_screen import ImportScreen

            assert isinstance(pilot.app.screen, ImportScreen)

            # Press escape
            await pilot.press("escape")
            await pilot.pause()

            # Should be back on summary
            from expenses.screens.summary_screen import SummaryScreen

            assert isinstance(pilot.app.screen, SummaryScreen)

    async def test_escape_on_summary_screen_stays_on_summary(self) -> None:
        """Test that pressing ESC multiple times on summary screen doesn't navigate away."""
        app = ExpensesApp()
        async with app.run_test() as pilot:
            await pilot.pause()
            from expenses.screens.summary_screen import SummaryScreen

            # Should start on summary
            assert isinstance(pilot.app.screen, SummaryScreen)

            # Press escape multiple times
            await pilot.press("escape")
            await pilot.pause()
            assert isinstance(pilot.app.screen, SummaryScreen)

            await pilot.press("escape")
            await pilot.pause()
            assert isinstance(pilot.app.screen, SummaryScreen)

            await pilot.press("escape")
            await pilot.pause()
            assert isinstance(pilot.app.screen, SummaryScreen)


if __name__ == "__main__":
    unittest.main()
