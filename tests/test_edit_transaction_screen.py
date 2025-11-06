import unittest
from textual.app import App
from expenses.screens.edit_transaction_screen import EditTransactionScreen


class TestEditTransactionScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for EditTransactionScreen."""

    async def test_screen_composition(self) -> None:
        """Test that screen has required elements."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("APPLE.COM/BILL")
            await pilot.app.push_screen(screen)

            # Check that all required elements are present
            assert pilot.app.screen.query_one("#dialog")
            assert pilot.app.screen.query_one("#title")
            assert pilot.app.screen.query_one("#instruction")
            assert pilot.app.screen.query_one("#original_merchant")
            assert pilot.app.screen.query_one("#pattern_input")
            assert pilot.app.screen.query_one("#pattern_help")
            assert pilot.app.screen.query_one("#alias_input")
            assert pilot.app.screen.query_one("#save")
            assert pilot.app.screen.query_one("#cancel")
            assert pilot.app.screen.query_one("#help_text")

    async def test_pattern_suggestion_basic(self) -> None:
        """Test that pattern suggestion works for basic merchant names."""
        screen = EditTransactionScreen("APPLE.COM/BILL")
        # Dots should be escaped (note: backslash in the pattern itself needs escaping in Python string)
        assert "APPLE" in screen.suggested_pattern
        assert "\\.COM" in screen.suggested_pattern
        assert screen.suggested_pattern.endswith(".*")

    async def test_pattern_suggestion_with_date(self) -> None:
        """Test that dates are removed from pattern suggestion."""
        screen = EditTransactionScreen("POS APPLE.COM/BI 02/08")
        # Date should be removed, and result should match POS APPLE.COM/BI.*
        assert "02/08" not in screen.suggested_pattern
        assert "POS" in screen.suggested_pattern
        assert "APPLE" in screen.suggested_pattern

    async def test_pattern_suggestion_with_trailing_numbers(self) -> None:
        """Test that trailing numbers are removed from pattern."""
        screen = EditTransactionScreen("AMAZON MKTPLACE 12345")
        # Trailing numbers should be removed
        assert "12345" not in screen.suggested_pattern
        assert "AMAZON" in screen.suggested_pattern

    async def test_pattern_suggestion_escapes_special_chars(self) -> None:
        """Test that special regex characters are escaped."""
        screen = EditTransactionScreen("TEST*MERCHANT+NAME?")
        # Special chars should be escaped
        assert "\\*" in screen.suggested_pattern
        assert "\\+" in screen.suggested_pattern
        assert "\\?" in screen.suggested_pattern

    async def test_new_alias_initialization(self) -> None:
        """Test creating a new alias (no existing alias)."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("APPLE.COM/BILL", current_alias=None)
            await pilot.app.push_screen(screen)

            # Pattern input should have suggested pattern
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            assert pattern_input.value == screen.suggested_pattern

            # Alias input should be empty
            alias_input = pilot.app.screen.query_one("#alias_input")
            assert alias_input.value == ""

    async def test_edit_existing_alias_initialization(self) -> None:
        """Test editing an existing alias."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("APPLE.COM/BILL", current_alias="Apple")
            await pilot.app.push_screen(screen)

            # Pattern input should be empty when editing
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            assert pattern_input.value == ""

            # Alias input should have the current alias
            alias_input = pilot.app.screen.query_one("#alias_input")
            assert alias_input.value == "Apple"

    async def test_cancel_button_dismisses(self) -> None:
        """Test that cancel button dismisses screen with False."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            cancel_button = pilot.app.screen.query_one("#cancel")
            cancel_button.press()

            await pilot.pause()
            # After dismiss, we should be back to the base screen
            assert pilot.app.screen != screen

    async def test_save_with_valid_pattern_and_alias(self) -> None:
        """Test saving with valid pattern and alias."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Set pattern and alias
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            alias_input = pilot.app.screen.query_one("#alias_input")

            pattern_input.value = "TEST.*"
            alias_input.value = "Test Store"

            # Click save
            save_button = pilot.app.screen.query_one("#save")
            save_button.press()

            await pilot.pause()
            # Screen should be dismissed
            assert pilot.app.screen != screen

    async def test_save_without_alias_shows_error(self) -> None:
        """Test that saving without alias shows error."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Set only pattern, no alias
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            pattern_input.value = "TEST.*"

            alias_input = pilot.app.screen.query_one("#alias_input")
            alias_input.value = ""

            # Click save
            save_button = pilot.app.screen.query_one("#save")
            save_button.press()

            await pilot.pause()
            # Screen should still be active (not dismissed)
            assert pilot.app.screen == screen

    async def test_save_with_invalid_regex_shows_error(self) -> None:
        """Test that invalid regex pattern shows error."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Set invalid regex pattern
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            alias_input = pilot.app.screen.query_one("#alias_input")

            pattern_input.value = "TEST[INVALID"  # Unclosed bracket
            alias_input.value = "Test"

            # Click save
            save_button = pilot.app.screen.query_one("#save")
            save_button.press()

            await pilot.pause()
            # Screen should still be active (not dismissed due to error)
            assert pilot.app.screen == screen

    async def test_save_with_alias_but_no_pattern_shows_error(self) -> None:
        """Test that saving with alias but no pattern shows error."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Clear pattern, set alias
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            alias_input = pilot.app.screen.query_one("#alias_input")

            pattern_input.value = ""
            alias_input.value = "Test Store"

            # Click save
            save_button = pilot.app.screen.query_one("#save")
            save_button.press()

            await pilot.pause()
            # Screen should still be active
            assert pilot.app.screen == screen

    async def test_save_with_empty_both_dismisses(self) -> None:
        """Test that emptying both pattern and alias dismisses."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Clear both
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            alias_input = pilot.app.screen.query_one("#alias_input")

            pattern_input.value = ""
            alias_input.value = ""

            # Click save
            save_button = pilot.app.screen.query_one("#save")
            save_button.press()

            await pilot.pause()
            # Should dismiss
            assert pilot.app.screen != screen

    async def test_escape_key_cancels(self) -> None:
        """Test that Escape key cancels the dialog."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Press escape
            await pilot.press("escape")
            await pilot.pause()

            # Should be dismissed
            assert pilot.app.screen != screen

    async def test_ctrl_s_saves(self) -> None:
        """Test that Ctrl+S triggers save."""
        app = App()
        async with app.run_test() as pilot:
            screen = EditTransactionScreen("TEST MERCHANT")
            await pilot.app.push_screen(screen)

            # Set valid values
            pattern_input = pilot.app.screen.query_one("#pattern_input")
            alias_input = pilot.app.screen.query_one("#alias_input")

            pattern_input.value = "TEST.*"
            alias_input.value = "Test"

            # Press Ctrl+S
            await pilot.press("ctrl+s")
            await pilot.pause()

            # Should be dismissed
            assert pilot.app.screen != screen

    async def test_pattern_suggestion_with_multiple_spaces(self) -> None:
        """Test that multiple spaces are normalized."""
        screen = EditTransactionScreen("TEST   MERCHANT   NAME")
        # Multiple spaces should be converted to \s+
        assert "\\s+" in screen.suggested_pattern
        # Should not have multiple consecutive spaces
        assert "  " not in screen.suggested_pattern

    async def test_pattern_suggestion_with_parentheses(self) -> None:
        """Test that parentheses are properly escaped."""
        screen = EditTransactionScreen("MERCHANT(TEST)")
        assert "\\(" in screen.suggested_pattern
        assert "\\)" in screen.suggested_pattern

    async def test_pattern_suggestion_with_brackets(self) -> None:
        """Test that brackets are properly escaped."""
        screen = EditTransactionScreen("MERCHANT[TEST]")
        assert "\\[" in screen.suggested_pattern
        assert "\\]" in screen.suggested_pattern

    async def test_pattern_suggestion_with_backslash(self) -> None:
        """Test that backslashes are properly escaped."""
        screen = EditTransactionScreen("MERCHANT\\TEST")
        assert "\\\\" in screen.suggested_pattern


if __name__ == "__main__":
    unittest.main()
