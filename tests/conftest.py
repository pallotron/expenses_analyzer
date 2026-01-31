"""Pytest configuration and fixtures for the test suite."""

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def isolate_backup_directory(tmp_path):
    """Automatically isolate backup directory for all tests.

    This prevents tests from creating backups in the real
    ~/.config/expenses_analyzer/auto_backups directory.
    """
    auto_backup_dir = tmp_path / "auto_backups"
    auto_backup_dir.mkdir(parents=True, exist_ok=True)

    with patch("expenses.backup.AUTO_BACKUP_DIR", auto_backup_dir):
        yield auto_backup_dir
