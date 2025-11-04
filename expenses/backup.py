"""Backup and restore functionality for transaction data."""

import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from expenses.config import CONFIG_DIR, TRANSACTIONS_FILE, CATEGORIES_FILE

# Auto-backup configuration
AUTO_BACKUP_DIR = CONFIG_DIR / "auto_backups"
MAX_AUTO_BACKUPS = 5


def create_auto_backup() -> Optional[Path]:
    """Create automatic backup before destructive operations.

    This function creates timestamped backups of both transactions and categories
    files. It maintains a rolling window of the most recent backups and automatically
    cleans up old ones.

    Returns:
        Path to backup file if successful, None otherwise
    """
    AUTO_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if not TRANSACTIONS_FILE.exists():
        logging.debug("No transactions file to backup")
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_file = AUTO_BACKUP_DIR / f"transactions_{timestamp}.parquet"

    try:
        # Backup transactions file
        shutil.copy2(TRANSACTIONS_FILE, backup_file)
        logging.info(f"Auto-backup created: {backup_file.name}")

        # Also backup categories if they exist
        if CATEGORIES_FILE.exists():
            cat_backup = AUTO_BACKUP_DIR / f"categories_{timestamp}.json"
            shutil.copy2(CATEGORIES_FILE, cat_backup)
            logging.debug(f"Categories backed up: {cat_backup.name}")

        # Clean up old backups
        _cleanup_old_backups()

        return backup_file

    except (OSError, IOError) as e:
        logging.warning(f"Could not create auto-backup: {e}")
        return None


def _cleanup_old_backups() -> None:
    """Keep only the most recent N backups to save disk space."""
    if not AUTO_BACKUP_DIR.exists():
        return

    # Get all backup files sorted by modification time (newest first)
    backups = sorted(
        AUTO_BACKUP_DIR.glob("transactions_*.parquet"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    # Remove old backups beyond the limit
    for old_backup in backups[MAX_AUTO_BACKUPS:]:
        try:
            old_backup.unlink()

            # Also remove corresponding categories file
            timestamp = old_backup.stem.replace("transactions_", "")
            cat_backup = AUTO_BACKUP_DIR / f"categories_{timestamp}.json"
            if cat_backup.exists():
                cat_backup.unlink()

            logging.debug(f"Removed old backup: {old_backup.name}")
        except OSError as e:
            logging.warning(f"Could not remove old backup {old_backup.name}: {e}")


def restore_from_backup(backup_file: Path) -> bool:
    """Restore transactions from a backup file.

    Before restoring, this creates an emergency backup of the current state
    in case the restore operation needs to be undone.

    Args:
        backup_file: Path to backup parquet file

    Returns:
        True if successful, False otherwise
    """
    if not backup_file.exists():
        logging.error(f"Backup file not found: {backup_file}")
        return False

    try:
        # Create emergency backup of current file before restoring
        if TRANSACTIONS_FILE.exists():
            emergency_backup = TRANSACTIONS_FILE.with_suffix(".parquet.pre-restore")
            shutil.copy2(TRANSACTIONS_FILE, emergency_backup)
            logging.info(f"Emergency backup created: {emergency_backup.name}")

        # Restore transactions from backup
        shutil.copy2(backup_file, TRANSACTIONS_FILE)
        logging.info(f"Restored transactions from: {backup_file.name}")

        # Try to restore categories if they exist
        timestamp = backup_file.stem.replace("transactions_", "")
        cat_backup = backup_file.parent / f"categories_{timestamp}.json"
        if cat_backup.exists() and CATEGORIES_FILE.exists():
            shutil.copy2(cat_backup, CATEGORIES_FILE)
            logging.info(f"Restored categories from: {cat_backup.name}")

        return True

    except (OSError, IOError) as e:
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
    for backup_file in AUTO_BACKUP_DIR.glob("transactions_*.parquet"):
        try:
            timestamp_str = backup_file.stem.replace("transactions_", "")
            # Try parsing with microseconds first, fall back to without
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
