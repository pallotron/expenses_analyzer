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
BACKUP_MIN_INTERVAL_SECONDS = 300  # Minimum 5 minutes between backups
BACKUP_MAX_COUNT = 50  # Keep at most 50 backups


def _get_newest_backup_time() -> Optional[datetime]:
    """Get the timestamp of the most recent backup.

    Returns:
        datetime of newest backup, or None if no backups exist
    """
    if not AUTO_BACKUP_DIR.exists():
        return None

    backups = list(AUTO_BACKUP_DIR.glob("backup_*.tar.gz"))
    if not backups:
        return None

    # Get the most recently modified backup
    newest = max(backups, key=lambda p: p.stat().st_mtime)
    return datetime.fromtimestamp(newest.stat().st_mtime)


def create_auto_backup(force: bool = False) -> Optional[Path]:
    """Create automatic backup tarball of all important config files.

    This function creates a compressed tarball containing:
    - transactions.parquet
    - categories.json
    - merchant_aliases.json (if exists)
    - default_categories.json (if exists)

    Backups are throttled to prevent excessive creation:
    - Minimum BACKUP_MIN_INTERVAL_SECONDS (5 min) between backups
    - Maximum BACKUP_MAX_COUNT (50) backups retained
    - Backups older than BACKUP_RETENTION_DAYS (7 days) are removed

    Args:
        force: If True, create backup regardless of throttling

    Returns:
        Path to backup tarball if successful, None otherwise
    """
    AUTO_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if not TRANSACTIONS_FILE.exists():
        logging.debug("No transactions file to backup")
        return None

    # Check if we should skip this backup due to throttling
    if not force:
        newest_backup_time = _get_newest_backup_time()
        if newest_backup_time:
            seconds_since_last = (datetime.now() - newest_backup_time).total_seconds()
            if seconds_since_last < BACKUP_MIN_INTERVAL_SECONDS:
                logging.debug(
                    f"Skipping backup: only {seconds_since_last:.0f}s since last backup "
                    f"(minimum {BACKUP_MIN_INTERVAL_SECONDS}s)"
                )
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
    """Remove old backups based on age and count limits.

    Cleanup rules:
    1. Remove backups older than BACKUP_RETENTION_DAYS
    2. Keep at most BACKUP_MAX_COUNT backups (removing oldest first)
    """
    if not AUTO_BACKUP_DIR.exists():
        return

    cutoff_time = datetime.now().timestamp() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60)

    # Get all backup tarballs with their modification times
    backups = []
    for backup in AUTO_BACKUP_DIR.glob("backup_*.tar.gz"):
        try:
            mtime = backup.stat().st_mtime
            backups.append((backup, mtime))
        except OSError:
            continue

    # Sort by modification time (newest first)
    backups.sort(key=lambda x: x[1], reverse=True)

    # Remove backups that are either too old or exceed the count limit
    for i, (backup, mtime) in enumerate(backups):
        should_remove = False
        reason = ""

        if mtime < cutoff_time:
            should_remove = True
            reason = f"older than {BACKUP_RETENTION_DAYS} days"
        elif i >= BACKUP_MAX_COUNT:
            should_remove = True
            reason = f"exceeds max count of {BACKUP_MAX_COUNT}"

        if should_remove:
            try:
                backup.unlink()
                logging.debug(f"Removed backup: {backup.name} ({reason})")
            except OSError as e:
                logging.warning(f"Could not remove backup {backup.name}: {e}")


def _create_emergency_backup() -> None:
    """Create an emergency backup before restoration."""
    # Always force emergency backups regardless of throttling
    emergency_backup = create_auto_backup(force=True)
    if emergency_backup:
        emergency_name = emergency_backup.name.replace("backup_", "emergency_")
        emergency_backup.rename(emergency_backup.parent / emergency_name)
        logging.info(f"Emergency backup created: {emergency_name}")


def _restore_file_if_exists(temp_dir: Path, filename: str, target_path: Path) -> bool:
    """Restore a single file from temp directory if it exists."""
    temp_file = temp_dir / filename
    if temp_file.exists():
        shutil.copy2(temp_file, target_path)
        logging.info(f"Restored {filename}")
        return True
    return False


def _restore_files_from_temp(temp_dir: Path) -> list[str]:
    """Restore all files from temporary extraction directory."""
    restored_files = []

    file_mappings = [
        ("transactions.parquet", TRANSACTIONS_FILE),
        ("categories.json", CATEGORIES_FILE),
        ("merchant_aliases.json", MERCHANT_ALIASES_FILE),
        ("default_categories.json", DEFAULT_CATEGORIES_FILE),
    ]

    for filename, target_path in file_mappings:
        if _restore_file_if_exists(temp_dir, filename, target_path):
            restored_files.append(filename)

    return restored_files


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
        _create_emergency_backup()

        # Extract the backup to a temporary directory first
        temp_dir = AUTO_BACKUP_DIR / f"restore_temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        temp_dir.mkdir(exist_ok=True)

        try:
            with tarfile.open(backup_file, "r:gz") as tar:
                tar.extractall(temp_dir, filter="data")
                logging.debug(f"Extracted backup to {temp_dir}")

                restored_files = _restore_files_from_temp(temp_dir)
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
