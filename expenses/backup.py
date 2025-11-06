"""Backup and restore functionality for transaction data."""

import logging
import shutil
import tarfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from expenses.config import (
    CONFIG_DIR,
    TRANSACTIONS_FILE,
    CATEGORIES_FILE,
    DEFAULT_CATEGORIES_FILE,
    MERCHANT_ALIASES_FILE,
)

# Auto-backup configuration
AUTO_BACKUP_DIR = CONFIG_DIR / "auto_backups"
BACKUP_RETENTION_DAYS = 7  # Keep backups for at least 7 days

# Path to plaid_items.json
PLAID_ITEMS_FILE = CONFIG_DIR / "plaid_items.json"


def create_auto_backup() -> Optional[Path]:
    """Create automatic backup tarball of all important config files.

    This function creates a compressed tarball containing:
    - transactions.parquet
    - categories.json
    - merchant_aliases.json (if exists)
    - plaid_items.json (if exists)
    - default_categories.json (if exists)

    Backups are retained for at least BACKUP_RETENTION_DAYS (default: 7 days)
    before being automatically cleaned up.

    Returns:
        Path to backup tarball if successful, None otherwise
    """
    AUTO_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if not TRANSACTIONS_FILE.exists():
        logging.debug("No transactions file to backup")
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_file = AUTO_BACKUP_DIR / f"backup_{timestamp}.tar.gz"

    try:
        with tarfile.open(backup_file, "w:gz") as tar:
            # Always backup transactions
            tar.add(TRANSACTIONS_FILE, arcname="transactions.parquet")
            logging.debug("Added transactions.parquet to backup")

            # Backup categories if it exists
            if CATEGORIES_FILE.exists():
                tar.add(CATEGORIES_FILE, arcname="categories.json")
                logging.debug("Added categories.json to backup")

            # Backup merchant aliases if it exists
            if MERCHANT_ALIASES_FILE.exists():
                tar.add(MERCHANT_ALIASES_FILE, arcname="merchant_aliases.json")
                logging.debug("Added merchant_aliases.json to backup")

            # Backup plaid items if it exists
            if PLAID_ITEMS_FILE.exists():
                tar.add(PLAID_ITEMS_FILE, arcname="plaid_items.json")
                logging.debug("Added plaid_items.json to backup")

            # Backup default categories if it exists
            if DEFAULT_CATEGORIES_FILE.exists():
                tar.add(DEFAULT_CATEGORIES_FILE, arcname="default_categories.json")
                logging.debug("Added default_categories.json to backup")

        logging.info(f"Auto-backup created: {backup_file.name}")

        # Clean up old backups
        _cleanup_old_backups()

        return backup_file

    except (OSError, IOError, tarfile.TarError) as e:
        logging.warning(f"Could not create auto-backup: {e}")
        # Clean up partial backup if it exists
        if backup_file.exists():
            try:
                backup_file.unlink()
            except OSError:
                pass
        return None


def _cleanup_old_backups() -> None:
    """Remove backups older than BACKUP_RETENTION_DAYS to save disk space."""
    if not AUTO_BACKUP_DIR.exists():
        return

    cutoff_time = datetime.now().timestamp() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60)

    # Get all backup tarballs
    backups = list(AUTO_BACKUP_DIR.glob("backup_*.tar.gz"))

    # Remove backups older than retention period
    for backup in backups:
        try:
            if backup.stat().st_mtime < cutoff_time:
                backup.unlink()
                logging.debug(
                    f"Removed old backup: {backup.name} (older than {BACKUP_RETENTION_DAYS} days)"
                )
        except OSError as e:
            logging.warning(f"Could not remove old backup {backup.name}: {e}")


def restore_from_backup(backup_file: Path) -> bool:
    """Restore data from a backup tarball.

    Before restoring, this creates an emergency backup of the current state
    in case the restore operation needs to be undone.

    Args:
        backup_file: Path to backup tarball (.tar.gz)

    Returns:
        True if successful, False otherwise
    """
    if not backup_file.exists():
        logging.error(f"Backup file not found: {backup_file}")
        return False

    if not tarfile.is_tarfile(backup_file):
        logging.error(f"Invalid backup file format: {backup_file}")
        return False

    try:
        # Create emergency backup first
        emergency_backup = create_auto_backup()
        if emergency_backup:
            emergency_name = emergency_backup.name.replace("backup_", "emergency_")
            emergency_backup.rename(emergency_backup.parent / emergency_name)
            logging.info(f"Emergency backup created: {emergency_name}")

        # Extract the backup to a temporary directory first
        temp_dir = (
            AUTO_BACKUP_DIR / f"restore_temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        )
        temp_dir.mkdir(exist_ok=True)

        try:
            with tarfile.open(backup_file, "r:gz") as tar:
                # Extract all files
                tar.extractall(temp_dir, filter="data")
                logging.debug(f"Extracted backup to {temp_dir}")

                # Restore each file
                restored_files = []

                # Restore transactions
                temp_transactions = temp_dir / "transactions.parquet"
                if temp_transactions.exists():
                    shutil.copy2(temp_transactions, TRANSACTIONS_FILE)
                    restored_files.append("transactions.parquet")
                    logging.info("Restored transactions.parquet")

                # Restore categories
                temp_categories = temp_dir / "categories.json"
                if temp_categories.exists():
                    shutil.copy2(temp_categories, CATEGORIES_FILE)
                    restored_files.append("categories.json")
                    logging.info("Restored categories.json")

                # Restore merchant aliases
                temp_aliases = temp_dir / "merchant_aliases.json"
                if temp_aliases.exists():
                    shutil.copy2(temp_aliases, MERCHANT_ALIASES_FILE)
                    restored_files.append("merchant_aliases.json")
                    logging.info("Restored merchant_aliases.json")

                # Restore plaid items
                temp_plaid = temp_dir / "plaid_items.json"
                if temp_plaid.exists():
                    shutil.copy2(temp_plaid, PLAID_ITEMS_FILE)
                    restored_files.append("plaid_items.json")
                    logging.info("Restored plaid_items.json")

                # Restore default categories
                temp_default = temp_dir / "default_categories.json"
                if temp_default.exists():
                    shutil.copy2(temp_default, DEFAULT_CATEGORIES_FILE)
                    restored_files.append("default_categories.json")
                    logging.info("Restored default_categories.json")

                logging.info(
                    f"Successfully restored {len(restored_files)} files: {', '.join(restored_files)}"
                )

        finally:
            # Clean up temp directory
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

        return True

    except (OSError, IOError, tarfile.TarError) as e:
        logging.error(f"Could not restore from backup: {e}")
        return False


def list_backups() -> list[tuple[datetime, Path, int]]:
    """List available auto-backups with metadata.

    Returns:
        List of (timestamp, filepath, size_bytes) tuples, sorted newest first
    """
    if not AUTO_BACKUP_DIR.exists():
        return []

    backups = []
    for backup_file in AUTO_BACKUP_DIR.glob("backup_*.tar.gz"):
        try:
            # Remove both .tar and .gz extensions
            timestamp_str = backup_file.name.replace("backup_", "").replace(
                ".tar.gz", ""
            )
            try:
                timestamp = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S_%f")
            except ValueError:
                timestamp = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S")
            size = backup_file.stat().st_size
            backups.append((timestamp, backup_file, size))
        except (ValueError, OSError) as e:
            logging.debug(f"Skipping invalid backup file {backup_file.name}: {e}")
            continue

    return sorted(backups, key=lambda x: x[0], reverse=True)


def get_backup_stats() -> dict[str, any]:
    """Get statistics about current backups.

    Returns:
        Dictionary with backup statistics (count, total_size, oldest, newest)
    """
    backups = list_backups()

    if not backups:
        return {
            "count": 0,
            "total_size": 0,
            "oldest": None,
            "newest": None,
        }

    total_size = sum(size for _, _, size in backups)

    return {
        "count": len(backups),
        "total_size": total_size,
        "oldest": backups[-1][0] if backups else None,
        "newest": backups[0][0] if backups else None,
    }


def attempt_auto_recovery() -> bool:
    """Attempt to automatically recover from the most recent backup.

    This function is called when a corrupted transactions file is detected.
    It will restore from the newest available backup without user intervention.

    Returns:
        True if recovery was successful, False otherwise
    """
    backups = list_backups()

    if not backups:
        logging.error("No backups available for automatic recovery")
        return False

    # Get the most recent backup
    newest_backup = backups[0][1]  # (timestamp, path, size)
    logging.info(f"Attempting automatic recovery from {newest_backup.name}")

    success = restore_from_backup(newest_backup)

    if success:
        logging.info("Automatic recovery successful")
    else:
        logging.error("Automatic recovery failed")

    return success
