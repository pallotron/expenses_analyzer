"""Tests for soft delete functionality."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from datetime import datetime
import pandas as pd

from expenses.data_handler import (
    load_transactions_from_parquet,
    save_transactions_to_parquet,
    append_transactions,
    delete_transactions,
    restore_deleted_transactions,
)


class TestSoftDelete(unittest.TestCase):
    """Test suite for soft delete functionality."""

    def setUp(self) -> None:
        """Create temporary test environment."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"

    def test_new_transactions_have_deleted_false(self) -> None:
        """Test that newly created transactions have Deleted=False."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Test Store"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)

            loaded = load_transactions_from_parquet()
            assert len(loaded) == 1
            assert "Deleted" in loaded.columns
            assert loaded.iloc[0]["Deleted"] == False  # noqa: E712

    def test_soft_delete_marks_transaction_as_deleted(self) -> None:
        """Test that soft delete marks transactions with Deleted=True."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create initial transactions
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1), datetime(2025, 1, 2)],
                    "Merchant": ["Store A", "Store B"],
                    "Amount": [10.00, 20.00],
                }
            )
            append_transactions(df)

            # Delete one transaction
            to_delete = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            delete_transactions(to_delete)

            # Normal load should not show deleted transaction
            active = load_transactions_from_parquet()
            assert len(active) == 1
            assert active.iloc[0]["Merchant"] == "Store B"

            # Load with include_deleted should show both
            all_trans = load_transactions_from_parquet(include_deleted=True)
            assert len(all_trans) == 2
            deleted_row = all_trans[all_trans["Merchant"] == "Store A"].iloc[0]
            assert deleted_row["Deleted"] == True  # noqa: E712

    def test_load_filters_deleted_by_default(self) -> None:
        """Test that load_transactions_from_parquet excludes deleted by default."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create and immediately soft-delete a transaction
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)
            delete_transactions(df)

            # Default load should return empty
            active = load_transactions_from_parquet()
            assert len(active) == 0

            # Explicit include_deleted should show it
            all_trans = load_transactions_from_parquet(include_deleted=True)
            assert len(all_trans) == 1
            assert all_trans.iloc[0]["Deleted"] == True  # noqa: E712

    def test_multiple_deletes(self) -> None:
        """Test soft-deleting multiple transactions."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create 5 transactions
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, i) for i in range(1, 6)],
                    "Merchant": [f"Store {i}" for i in range(1, 6)],
                    "Amount": [10.00 * i for i in range(1, 6)],
                }
            )
            append_transactions(df)

            # Delete 3 of them
            to_delete = pd.DataFrame(
                {
                    "Date": [
                        datetime(2025, 1, 1),
                        datetime(2025, 1, 3),
                        datetime(2025, 1, 5),
                    ],
                    "Merchant": ["Store 1", "Store 3", "Store 5"],
                    "Amount": [10.00, 30.00, 50.00],
                }
            )
            delete_transactions(to_delete)

            # Should have 2 active transactions
            active = load_transactions_from_parquet()
            assert len(active) == 2
            assert set(active["Merchant"]) == {"Store 2", "Store 4"}

            # Should still have all 5 total
            all_trans = load_transactions_from_parquet(include_deleted=True)
            assert len(all_trans) == 5

    def test_restore_deleted_transaction(self) -> None:
        """Test restoring a soft-deleted transaction."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create transaction
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)

            # Delete it
            delete_transactions(df)
            assert len(load_transactions_from_parquet()) == 0

            # Restore it
            restore_deleted_transactions(df)
            active = load_transactions_from_parquet()
            assert len(active) == 1
            assert active.iloc[0]["Merchant"] == "Store A"
            assert active.iloc[0]["Deleted"] == False  # noqa: E712

    def test_restore_multiple_transactions(self) -> None:
        """Test restoring multiple soft-deleted transactions."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create 3 transactions
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, i) for i in range(1, 4)],
                    "Merchant": [f"Store {i}" for i in range(1, 4)],
                    "Amount": [10.00 * i for i in range(1, 4)],
                }
            )
            append_transactions(df)

            # Delete all 3
            delete_transactions(df)
            assert len(load_transactions_from_parquet()) == 0

            # Restore 2 of them
            to_restore = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1), datetime(2025, 1, 3)],
                    "Merchant": ["Store 1", "Store 3"],
                    "Amount": [10.00, 30.00],
                }
            )
            restore_deleted_transactions(to_restore)

            active = load_transactions_from_parquet()
            assert len(active) == 2
            assert set(active["Merchant"]) == {"Store 1", "Store 3"}

    def test_backward_compatibility_no_deleted_column(self) -> None:
        """Test that old files without Deleted column are handled correctly."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create old-style transaction file without Deleted column
            old_df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            save_transactions_to_parquet(old_df)

            # Should load successfully and add Deleted column
            loaded = load_transactions_from_parquet()
            assert len(loaded) == 1
            assert "Deleted" in loaded.columns
            assert loaded.iloc[0]["Deleted"] == False  # noqa: E712

    def test_delete_empty_dataframe(self) -> None:
        """Test that deleting empty DataFrame does nothing."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create initial transaction
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)

            # Try to delete empty DataFrame
            empty = pd.DataFrame(columns=["Date", "Merchant", "Amount"])
            delete_transactions(empty)

            # Original transaction should still be there
            active = load_transactions_from_parquet()
            assert len(active) == 1

    def test_restore_empty_dataframe(self) -> None:
        """Test that restoring empty DataFrame does nothing."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create and delete transaction
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)
            delete_transactions(df)

            # Try to restore empty DataFrame
            empty = pd.DataFrame(columns=["Date", "Merchant", "Amount"])
            restore_deleted_transactions(empty)

            # Should still be deleted
            active = load_transactions_from_parquet()
            assert len(active) == 0

    def test_delete_nonexistent_transaction(self) -> None:
        """Test deleting a transaction that doesn't exist."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create one transaction
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)

            # Try to delete a different transaction
            nonexistent = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 2)],
                    "Merchant": ["Store B"],
                    "Amount": [20.00],
                }
            )
            delete_transactions(nonexistent)

            # Original transaction should still be active
            active = load_transactions_from_parquet()
            assert len(active) == 1
            assert active.iloc[0]["Merchant"] == "Store A"

    def test_delete_already_deleted_transaction(self) -> None:
        """Test soft-deleting an already deleted transaction (idempotent)."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create transaction
            df = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df)

            # Delete it twice
            delete_transactions(df)
            delete_transactions(df)

            # Should still be deleted (idempotent)
            active = load_transactions_from_parquet()
            assert len(active) == 0

            all_trans = load_transactions_from_parquet(include_deleted=True)
            assert len(all_trans) == 1
            assert all_trans.iloc[0]["Deleted"] == True  # noqa: E712

    def test_append_preserves_existing_deleted_state(self) -> None:
        """Test that appending new transactions preserves deleted state of existing ones."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", Path(self.test_dir) / "backups"),
        ):

            # Create and delete a transaction
            df1 = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 1)],
                    "Merchant": ["Store A"],
                    "Amount": [10.00],
                }
            )
            append_transactions(df1)
            delete_transactions(df1)

            # Append a new transaction
            df2 = pd.DataFrame(
                {
                    "Date": [datetime(2025, 1, 2)],
                    "Merchant": ["Store B"],
                    "Amount": [20.00],
                }
            )
            append_transactions(df2)

            # Old transaction should still be deleted
            active = load_transactions_from_parquet()
            assert len(active) == 1
            assert active.iloc[0]["Merchant"] == "Store B"

            all_trans = load_transactions_from_parquet(include_deleted=True)
            assert len(all_trans) == 2
            deleted_row = all_trans[all_trans["Merchant"] == "Store A"].iloc[0]
            assert deleted_row["Deleted"] == True  # noqa: E712


if __name__ == "__main__":
    unittest.main()
