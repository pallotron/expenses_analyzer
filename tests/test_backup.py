"""Tests for backup and restore functionality."""

import unittest
import tempfile
import time
import tarfile
from pathlib import Path
from unittest.mock import patch
import pandas as pd

from expenses.backup import (
    create_auto_backup,
    restore_from_backup,
    list_backups,
    get_backup_stats,
    _cleanup_old_backups,
    BACKUP_RETENTION_DAYS,
)
from expenses.data_handler import (
    save_transactions_to_parquet,
    load_transactions_from_parquet,
)


class TestBackup(unittest.TestCase):
    """Test suite for backup functionality."""

    def setUp(self) -> None:
        """Create temporary test environment."""
        self.test_dir = tempfile.mkdtemp()
        self.transactions_file = Path(self.test_dir) / "transactions.parquet"
        self.categories_file = Path(self.test_dir) / "categories.json"
        self.merchant_aliases_file = Path(self.test_dir) / "merchant_aliases.json"
        self.default_categories_file = Path(self.test_dir) / "default_categories.json"
        self.auto_backup_dir = Path(self.test_dir) / "auto_backups"

    def test_create_auto_backup_success(self) -> None:
        """Test successful backup creation as tarball."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create some test data
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test Store"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)
            self.categories_file.write_text('{"Test": "Category"}')

            # Create backup
            backup_file = create_auto_backup()

            # Verify backup was created
            assert backup_file is not None
            assert backup_file.exists()
            assert backup_file.parent == self.auto_backup_dir
            assert "backup_" in backup_file.name
            assert backup_file.suffix == ".gz"
            assert tarfile.is_tarfile(backup_file)

            # Verify contents
            with tarfile.open(backup_file, "r:gz") as tar:
                names = tar.getnames()
                assert "transactions.parquet" in names
                assert "categories.json" in names

    def test_create_auto_backup_no_file(self) -> None:
        """Test backup when no transactions file exists."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
        ):

            # Try to backup non-existent file
            backup_file = create_auto_backup()

            # Should return None
            assert backup_file is None

    def test_backup_includes_categories(self) -> None:
        """Test that backup includes categories file if it exists."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create test data
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            # Create categories file
            self.categories_file.write_text('{"Test": "Shopping"}')

            # Create backup
            backup_file = create_auto_backup()

            # Verify categories were backed up (inside tarball)
            with tarfile.open(backup_file, "r:gz") as tar:
                names = tar.getnames()
                assert "categories.json" in names

    def test_backup_includes_merchant_aliases(self) -> None:
        """Test that backup includes merchant_aliases file if it exists."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch("expenses.backup.MERCHANT_ALIASES_FILE", self.merchant_aliases_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create test data
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            # Create merchant_aliases file
            self.merchant_aliases_file.write_text('{"test merchant": "Test"}')

            # Create backup
            backup_file = create_auto_backup()

            # Verify merchant_aliases were backed up (inside tarball)
            with tarfile.open(backup_file, "r:gz") as tar:
                names = tar.getnames()
                assert "merchant_aliases.json" in names

    def test_cleanup_old_backups(self) -> None:
        """Test that old backups are removed when older than BACKUP_RETENTION_DAYS."""
        import os

        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create test data
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            # Create directory
            self.auto_backup_dir.mkdir(parents=True, exist_ok=True)

            # Manually create backup files with different ages
            current_time = time.time()
            old_timestamp = current_time - (8 * 24 * 60 * 60)  # 8 days ago
            recent_timestamp = current_time - (2 * 24 * 60 * 60)  # 2 days ago

            # Create old backup
            old_backup = self.auto_backup_dir / "backup_20251001_120000.tar.gz"
            old_backup.write_bytes(b"old backup data")
            os.utime(old_backup, (old_timestamp, old_timestamp))

            # Create recent backups
            recent_backup1 = self.auto_backup_dir / "backup_20251103_120000.tar.gz"
            recent_backup1.write_bytes(b"recent backup data 1")
            os.utime(recent_backup1, (recent_timestamp, recent_timestamp))

            recent_backup2 = self.auto_backup_dir / "backup_20251104_120000.tar.gz"
            recent_backup2.write_bytes(b"recent backup data 2")
            os.utime(recent_backup2, (current_time, current_time))

            # Verify we have 3 backups
            backups = list(self.auto_backup_dir.glob("backup_*.tar.gz"))
            assert len(backups) == 3

            # Trigger cleanup (default retention is 7 days)
            _cleanup_old_backups()

            # Verify only the old backup was removed
            backups = list(self.auto_backup_dir.glob("backup_*.tar.gz"))
            assert len(backups) == 2
            assert old_backup not in backups
            assert recent_backup1 in backups
            assert recent_backup2 in backups

    def test_restore_from_backup_success(self) -> None:
        """Test successful restore from backup."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch("expenses.backup.MERCHANT_ALIASES_FILE", self.merchant_aliases_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create original data
            original_df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Original"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(original_df)
            self.categories_file.write_text('{"Original": "Category1"}')
            self.merchant_aliases_file.write_text('{"original merchant": "Original"}')

            # Create backup
            backup_file = create_auto_backup()

            # Modify data
            modified_df = pd.DataFrame(
                {"Date": ["2025-01-02"], "Merchant": ["Modified"], "Amount": [20.00]}
            )
            save_transactions_to_parquet(modified_df)
            self.categories_file.write_text('{"Modified": "Category2"}')
            self.merchant_aliases_file.write_text('{"modified merchant": "Modified"}')

            # Restore from backup
            success = restore_from_backup(backup_file)

            assert success
            # Verify data was restored
            restored_df = load_transactions_from_parquet()
            assert len(restored_df) == 1
            assert restored_df.iloc[0]["Merchant"] == "Original"

            # Verify categories were restored
            assert self.categories_file.exists()
            import json

            with open(self.categories_file) as f:
                categories = json.load(f)
            assert categories == {"Original": "Category1"}

            # Verify merchant aliases were restored
            assert self.merchant_aliases_file.exists()
            with open(self.merchant_aliases_file) as f:
                aliases = json.load(f)
            assert aliases == {"original merchant": "Original"}

    def test_restore_from_nonexistent_backup(self) -> None:
        """Test restore fails gracefully when backup doesn't exist."""
        with patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file):
            fake_backup = Path(self.test_dir) / "nonexistent.tar.gz"
            success = restore_from_backup(fake_backup)

            assert success is False

    def test_list_backups(self) -> None:
        """Test listing available backups."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.backup.DEFAULT_CATEGORIES_FILE", self.default_categories_file
            ),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Create test data
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            # Create multiple backups
            for i in range(3):
                create_auto_backup()
                time.sleep(1.1)  # Ensure different timestamps (1 second resolution)

            # List backups
            backups = list_backups()

            assert len(backups) == 3
            # Verify backups are sorted newest first
            for i in range(len(backups) - 1):
                assert backups[i][0] >= backups[i + 1][0]

    def test_get_backup_stats(self) -> None:
        """Test getting backup statistics."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.CATEGORIES_FILE", self.categories_file),
            patch(
                "expenses.backup.DEFAULT_CATEGORIES_FILE", self.default_categories_file
            ),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Initially no backups
            stats = get_backup_stats()
            assert stats["count"] == 0
            assert stats["total_size"] == 0

            # Create test data and backups
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            create_auto_backup()
            time.sleep(1.1)
            create_auto_backup()

            # Get stats
            stats = get_backup_stats()
            assert stats["count"] == 2
            assert stats["total_size"] > 0
            assert stats["newest"] is not None
            assert stats["oldest"] is not None

    def test_backup_creates_directory(self) -> None:
        """Test that backup creates auto_backups directory if it doesn't exist."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):

            # Verify directory doesn't exist
            assert not self.auto_backup_dir.exists()

            # Create test data
            df = pd.DataFrame(
                {"Date": ["2025-01-01"], "Merchant": ["Test"], "Amount": [10.00]}
            )
            save_transactions_to_parquet(df)

            # Create backup
            create_auto_backup()

            # Verify directory was created
            assert self.auto_backup_dir.exists()
            assert self.auto_backup_dir.is_dir()

    def test_create_auto_backup_error_handling(self):
        """Test error handling during backup creation."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):
            # Create a dummy transactions file to back up
            self.transactions_file.write_text("dummy data")

            # Simulate an error during tar creation
            with patch("tarfile.open", side_effect=tarfile.TarError("Disk full")):
                backup_file = create_auto_backup()
                self.assertIsNone(backup_file)

            # Ensure partial backup is cleaned up
            self.assertEqual(len(list(self.auto_backup_dir.iterdir())), 0)

            # Simulate an error during file deletion
            with (
                patch("tarfile.open", side_effect=IOError("Disk full")),
                patch("pathlib.Path.unlink", side_effect=OSError("Permission denied")),
            ):
                backup_file = create_auto_backup()
                self.assertIsNone(backup_file)

    def test_cleanup_old_backups_error_handling(self):
        """Test error handling during old backup cleanup."""
        import os
        from datetime import datetime, timedelta

        with patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir):
            self.auto_backup_dir.mkdir(exist_ok=True)
            old_backup_time = datetime.now() - timedelta(days=BACKUP_RETENTION_DAYS + 1)
            old_backup_file = self.auto_backup_dir / "backup_old.tar.gz"
            old_backup_file.touch()
            os.utime(
                old_backup_file,
                (old_backup_time.timestamp(), old_backup_time.timestamp()),
            )

            with patch("pathlib.Path.unlink", side_effect=OSError("Permission denied")):
                _cleanup_old_backups()
                # The file should still exist as unlink failed
                self.assertTrue(old_backup_file.exists())

    def test_restore_with_emergency_backup_failure(self):
        """Test restore when emergency backup creation fails."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):
            self.transactions_file.write_text("dummy data")
            backup_file = create_auto_backup()
            self.assertIsNotNone(backup_file)

            with patch("expenses.backup.create_auto_backup", return_value=None):
                # Restore should still proceed
                self.assertTrue(restore_from_backup(backup_file))

    def test_list_backups_with_invalid_filename(self):
        """Test that list_backups skips files with invalid names."""
        with patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir):
            self.auto_backup_dir.mkdir(exist_ok=True)
            (self.auto_backup_dir / "backup_invalid_date.tar.gz").touch()
            (self.auto_backup_dir / "not_a_backup.txt").touch()

            backups = list_backups()
            self.assertEqual(len(backups), 0)

    def test_restore_from_backup_cleanup_on_error(self):
        """Test that the temporary directory is cleaned up even if restore fails."""
        with (
            patch("expenses.backup.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.backup.AUTO_BACKUP_DIR", self.auto_backup_dir),
            patch("expenses.data_handler.TRANSACTIONS_FILE", self.transactions_file),
            patch("expenses.data_handler.CONFIG_DIR", Path(self.test_dir)),
        ):
            self.transactions_file.write_text("dummy data")
            backup_file = create_auto_backup()
            self.assertIsNotNone(backup_file)

            with patch("shutil.copy2", side_effect=IOError("Disk full")):
                self.assertFalse(restore_from_backup(backup_file))

            # Check that no temp dirs are left
            self.assertFalse(
                any(
                    p.name.startswith("restore_temp_")
                    for p in self.auto_backup_dir.iterdir()
                )
            )


if __name__ == "__main__":
    unittest.main()
