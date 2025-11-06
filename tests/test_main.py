import unittest
from unittest.mock import patch, MagicMock
from expenses.main import main


class TestMain(unittest.TestCase):
    """Test suite for main entry point."""

    @patch("expenses.main.ExpensesApp")
    def test_main_creates_and_runs_app(self, mock_app_class: MagicMock) -> None:
        """Test that main() creates an ExpensesApp instance and runs it."""
        # Create a mock app instance
        mock_app_instance = MagicMock()
        mock_app_class.return_value = mock_app_instance

        # Call main
        main()

        # Verify ExpensesApp was instantiated
        mock_app_class.assert_called_once_with()

        # Verify run() was called on the app instance
        mock_app_instance.run.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
