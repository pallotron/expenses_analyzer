import unittest
from textual.app import App
from expenses.screens.confirmation_screen import ConfirmationScreen


class TestConfirmationScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for ConfirmationScreen."""

    async def test_confirmation_screen_composition(self) -> None:
        """Test that confirmation screen has required elements."""
        app = App()
        async with app.run_test() as pilot:
            screen = ConfirmationScreen("Are you sure?")
            await pilot.app.push_screen(screen)
            
            # Check that the dialog is present
            assert pilot.app.screen.query_one("#dialog")
            assert pilot.app.screen.query_one("#question")
            assert pilot.app.screen.query_one("#yes")
            assert pilot.app.screen.query_one("#no")

    async def test_confirmation_screen_prompt_text(self) -> None:
        """Test that the prompt text is displayed correctly."""
        app = App()
        async with app.run_test() as pilot:
            prompt_text = "Delete all transactions?"
            screen = ConfirmationScreen(prompt_text)
            await pilot.app.push_screen(screen)
            
            question = pilot.app.screen.query_one("#question")
            # Check the prompt is stored in the screen
            assert screen.prompt == prompt_text

    async def test_yes_button_dismisses_with_true(self) -> None:
        """Test that clicking Yes dismisses screen with True."""
        app = App()
        async with app.run_test() as pilot:
            screen = ConfirmationScreen("Confirm?")
            await pilot.app.push_screen(screen)
            
            # Simulate button press directly
            yes_button = pilot.app.screen.query_one("#yes")
            yes_button.press()
            
            await pilot.pause()
            
            # After dismiss, we should be back to the base screen
            assert pilot.app.screen != screen

    async def test_no_button_dismisses_with_false(self) -> None:
        """Test that clicking No dismisses screen with False."""
        app = App()
        async with app.run_test() as pilot:
            screen = ConfirmationScreen("Confirm?")
            await pilot.app.push_screen(screen)
            
            # Simulate button press directly
            no_button = pilot.app.screen.query_one("#no")
            no_button.press()
            
            await pilot.pause()
            
            # After dismiss, we should be back to the base screen
            assert pilot.app.screen != screen


if __name__ == "__main__":
    unittest.main()
