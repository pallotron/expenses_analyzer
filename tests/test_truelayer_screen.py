import unittest
from unittest.mock import Mock, patch
from expenses.screens.truelayer_screen import TrueLayerScreen


class TestTrueLayerScreen(unittest.TestCase):
    """Test suite for TrueLayerScreen."""

    def test_screen_initialization(self) -> None:
        """Test screen initializes with correct default values."""
        with (
            patch("expenses.screens.truelayer_screen.TRUELAYER_CLIENT_ID", "test_id"),
            patch(
                "expenses.screens.truelayer_screen.TRUELAYER_CLIENT_SECRET",
                "test_secret",
            ),
        ):
            screen = TrueLayerScreen()
            assert screen.code_check_timer is None
            assert screen.pending_transactions is None
            assert screen.pending_connection_id is None
            assert screen.pending_provider_name is None
            assert screen.redirect_uri == "http://localhost:3000/truelayer-callback"
            assert screen.accounts_list == []
            assert screen.account_checkboxes == {}

    def test_redirect_uri_configuration(self) -> None:
        """Test that redirect URI is correctly configured."""
        with (
            patch("expenses.screens.truelayer_screen.TRUELAYER_CLIENT_ID", "test_id"),
            patch(
                "expenses.screens.truelayer_screen.TRUELAYER_CLIENT_SECRET",
                "test_secret",
            ),
        ):
            screen = TrueLayerScreen()
            assert "localhost:3000" in screen.redirect_uri
            assert "truelayer-callback" in screen.redirect_uri

    def test_pending_transactions_initialization(self) -> None:
        """Test that pending transactions is initialized as None."""
        with (
            patch("expenses.screens.truelayer_screen.TRUELAYER_CLIENT_ID", "test_id"),
            patch(
                "expenses.screens.truelayer_screen.TRUELAYER_CLIENT_SECRET",
                "test_secret",
            ),
        ):
            screen = TrueLayerScreen()
            assert screen.pending_transactions is None
            assert screen.pending_connection_id is None
            assert screen.pending_provider_name is None

    def test_has_compose_content_method(self) -> None:
        """Test that screen has compose_content method."""
        with (
            patch("expenses.screens.truelayer_screen.TRUELAYER_CLIENT_ID", "test_id"),
            patch(
                "expenses.screens.truelayer_screen.TRUELAYER_CLIENT_SECRET",
                "test_secret",
            ),
        ):
            screen = TrueLayerScreen()
            assert hasattr(screen, "compose_content")
            assert callable(screen.compose_content)

    def test_accounts_list_initialization(self) -> None:
        """Test that accounts list is initialized as empty."""
        with (
            patch("expenses.screens.truelayer_screen.TRUELAYER_CLIENT_ID", "test_id"),
            patch(
                "expenses.screens.truelayer_screen.TRUELAYER_CLIENT_SECRET",
                "test_secret",
            ),
        ):
            screen = TrueLayerScreen()
            assert isinstance(screen.accounts_list, list)
            assert len(screen.accounts_list) == 0

    def test_account_checkboxes_initialization(self) -> None:
        """Test that account checkboxes dict is initialized as empty."""
        with (
            patch("expenses.screens.truelayer_screen.TRUELAYER_CLIENT_ID", "test_id"),
            patch(
                "expenses.screens.truelayer_screen.TRUELAYER_CLIENT_SECRET",
                "test_secret",
            ),
        ):
            screen = TrueLayerScreen()
            assert isinstance(screen.account_checkboxes, dict)
            assert len(screen.account_checkboxes) == 0


if __name__ == "__main__":
    unittest.main()
