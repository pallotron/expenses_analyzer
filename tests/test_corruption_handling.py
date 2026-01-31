"""Tests for corrupted file handling."""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import pandas as pd

from expenses.data_handler import (
    load_transactions_from_parquet,
    load_categories,
    save_transactions_to_parquet,
    check_and_clear_corruption_flag,
)
from expenses.backup import attempt_auto_recovery, create_auto_backup


class TestCorruptionHandling(unittest.TestCase):
    """Test suite for handling corrupted data files."""

    def setUp(self) -> None:
        """Create temporary test environment."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"
        self.categories_file = Path(self.test_dir) / "categories.json"
        self.auto_backup_dir = Path(self.test_dir) / "auto_backups"

        # Clear any corruption flag from previous tests
        check_and_clear_corruption_flag()

    def test_corrupted_parquet_returns_empty_df(self) -> None:
        """Test that corrupted parquet file returns empty DataFrame."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create a corrupted parquet file (write garbage data)
            self.transactions_file.write_text("This is not a valid parquet file!")

            # Should return empty DataFrame instead of crashing
            df = load_transactions_from_parquet()

            assert df.empty
            assert list(df.columns) == [
                "Date",
                "Merchant",
                "Amount",
                "Source",
                "Deleted",
                "Type",
            ]

    def test_corrupted_categories_returns_empty_dict(self) -> None:
        """Test that corrupted categories file returns empty dict."""
        with patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Create corrupted JSON file
            self.categories_file.write_text("{this is: not valid JSON}")

            # Should return empty dict instead of crashing
            categories = load_categories()

            assert categories == {}

    def test_missing_categories_file_returns_empty_dict(self) -> None:
        """Test that missing categories file returns empty dict."""
        with patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Don't create the file
            categories = load_categories()

            assert categories == {}

    def test_auto_recovery_with_available_backup(self) -> None:
        """Test automatic recovery when backup is available."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create original valid data
            original_df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test Store"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(original_df)

            # Create backup
            backup = create_auto_backup()
            assert backup is not None

            # Corrupt the main file
            self.transactions_file.write_text("corrupted data")

            # Attempt auto-recovery
            success = attempt_auto_recovery()

            assert success
            # Verify data was restored
            restored_df = load_transactions_from_parquet()
            assert len(restored_df) == 1
            assert restored_df.iloc[0]["Merchant"] == "Test Store"

    def test_auto_recovery_no_backups_available(self) -> None:
        """Test auto-recovery fails gracefully when no backups exist."""
        with patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir):

            # Don't create any backups
            success = attempt_auto_recovery()

            assert success is False

    def test_parquet_corruption_after_valid_file(self) -> None:
        """Test handling corruption of previously valid file."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create valid file
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Store"], "Amount": [15.00]}
            )
            save_transactions_to_parquet(df)

            # Verify it loads correctly
            loaded = load_transactions_from_parquet()
            assert len(loaded) == 1

            # Corrupt the file
            self.transactions_file.write_bytes(b"\x00\x01\x02\x03")

            # Should return empty DataFrame
            corrupted_load = load_transactions_from_parquet()
            assert corrupted_load.empty
            assert list(corrupted_load.columns) == [
                "Date",
                "Merchant",
                "Amount",
                "Source",
                "Deleted",
                "Type",
            ]

    def test_categories_ioerror_handling(self) -> None:
        """Test handling of IOError when reading categories."""
        with patch("expenses.data_handler.CATEGORIES_FILE", self.categories_file):

            # Create valid categories file
            self.categories_file.write_text('{"Store": "Shopping"}')

            # Make it unreadable (Unix only)
            try:
                self.categories_file.chmod(0o000)
                categories = load_categories()
                # Should return empty dict on permission error
                assert categories == {}
            except (OSError, PermissionError):
                # Windows may not support chmod
                pass
            finally:
                # Restore permissions for cleanup
                try:
                    self.categories_file.chmod(0o600)
                except (OSError, PermissionError):
                    pass

    def test_empty_parquet_file(self) -> None:
        """Test handling of empty parquet file."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create empty file
            self.transactions_file.touch()

            # Should return empty DataFrame
            df = load_transactions_from_parquet()
            assert df.empty
            assert list(df.columns) == [
                "Date",
                "Merchant",
                "Amount",
                "Source",
                "Deleted",
                "Type",
            ]

    def test_truncated_parquet_file(self) -> None:
        """Test handling of truncated parquet file."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create valid file first
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Store"], "Amount": [20.00]}
            )
            save_transactions_to_parquet(df)

            # Read the file and truncate it
            content = self.transactions_file.read_bytes()
            self.transactions_file.write_bytes(content[: len(content) // 2])

            # Should return empty DataFrame
            truncated_load = load_transactions_from_parquet()
            assert truncated_load.empty

    def test_recovery_creates_emergency_backup(self) -> None:
        """Test that recovery creates emergency backup before restoring."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create and backup original data
            df1 = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Original"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df1)
            create_auto_backup()

            # Modify to different data
            df2 = pd.DataFrame(
                {"Date": ["2025-01-02"], "Merchant": ["Modified"], "Amount": [20.00]}
            )
            save_transactions_to_parquet(df2)

            # Restore from backup
            success = attempt_auto_recovery()
            assert success

            # Check emergency backup was created
            # Check emergency backup tarball was created (starts with emergency_)
            emergency_backups = list(self.auto_backup_dir.glob("emergency_*.tar.gz"))
            assert len(emergency_backups) > 0, "No emergency backup found"
            emergency_backup = emergency_backups[0]
            assert emergency_backup.exists()

    def test_corruption_flag_is_set(self) -> None:
        """Test that corruption detection sets the flag for TUI notification."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create corrupted file
            self.transactions_file.write_bytes(b"\x00\x01\x02corrupted")

            # Load should set the corruption flag
            df = load_transactions_from_parquet()
            assert df.empty

            # Check that flag was set
            msg = check_and_clear_corruption_flag()
            assert msg is not None
            assert "corrupted" in msg.lower()

            # Flag should be cleared after first check
            msg2 = check_and_clear_corruption_flag()
            assert msg2 is None

    def test_no_corruption_flag_for_valid_file(self) -> None:
        """Test that valid file doesn't set corruption flag."""
        with (
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create valid file
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Store"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            # Load should not set flag
            loaded = load_transactions_from_parquet()
            assert len(loaded) == 1

            # Check that flag was NOT set
            msg = check_and_clear_corruption_flag()
            assert msg is None


if __name__ == "__main__":
    unittest.main()
