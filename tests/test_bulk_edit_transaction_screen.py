import unittest
from expenses.screens.bulk_edit_transaction_screen import (
    BulkEditTransactionScreen,
    NO_CHANGE,
    CUSTOM,
)


class TestBulkEditTransactionScreen(unittest.TestCase):
    """Tests for BulkEditTransactionScreen."""

    def test_screen_initialization(self) -> None:
        """Test screen initializes with selected count."""
        screen = BulkEditTransactionScreen(selected_count=5)
        self.assertEqual(screen.selected_count, 5)
        self.assertEqual(screen.existing_merchants, [])
        self.assertEqual(screen.existing_sources, [])

    def test_screen_initialization_single_transaction(self) -> None:
        """Test screen initializes with single transaction."""
        screen = BulkEditTransactionScreen(selected_count=1)
        self.assertEqual(screen.selected_count, 1)

    def test_screen_initialization_many_transactions(self) -> None:
        """Test screen initializes with many transactions."""
        screen = BulkEditTransactionScreen(selected_count=100)
        self.assertEqual(screen.selected_count, 100)

    def test_screen_with_existing_merchants(self) -> None:
        """Test screen initializes with existing merchants."""
        merchants = ["Amazon", "Starbucks", "Walmart"]
        screen = BulkEditTransactionScreen(
            selected_count=5,
            existing_merchants=merchants,
        )
        self.assertEqual(screen.existing_merchants, merchants)

    def test_screen_with_existing_sources(self) -> None:
        """Test screen initializes with existing sources."""
        sources = ["Manual", "CSV Import", "TrueLayer"]
        screen = BulkEditTransactionScreen(
            selected_count=5,
            existing_sources=sources,
        )
        self.assertEqual(screen.existing_sources, sources)

    def test_screen_with_all_options(self) -> None:
        """Test screen initializes with all options."""
        merchants = ["Amazon", "Starbucks"]
        sources = ["Manual", "CSV Import"]
        screen = BulkEditTransactionScreen(
            selected_count=10,
            existing_merchants=merchants,
            existing_sources=sources,
        )
        self.assertEqual(screen.selected_count, 10)
        self.assertEqual(screen.existing_merchants, merchants)
        self.assertEqual(screen.existing_sources, sources)

    def test_special_constants(self) -> None:
        """Test special constants are defined."""
        self.assertEqual(NO_CHANGE, "__no_change__")
        self.assertEqual(CUSTOM, "__custom__")


if __name__ == "__main__":
    unittest.main()
