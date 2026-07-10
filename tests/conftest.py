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


@pytest.fixture(autouse=True)
def isolate_category_types(tmp_path):
    """Prevent tests from touching the real category_types.json."""
    category_types_file = tmp_path / "category_types.json"
    with patch("expenses.data_handler.CATEGORY_TYPES_FILE", category_types_file):
        yield category_types_file
