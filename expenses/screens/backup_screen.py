"""Backup and restore screen for managing data backups."""

import logging
from pathlib import Path
from textual.app import ComposeResult
from textual.widgets import DataTable, Static, Button
from textual.containers import Horizontal
from textual.binding import Binding

from expenses.screens.base_screen import BaseScreen
from expenses.backup import (
    create_auto_backup,
    restore_from_backup,
    list_backups,
    get_backup_stats,
    AUTO_BACKUP_DIR,
)
from expenses.config import TRANSACTIONS_FILE, CATEGORIES_FILE


class BackupScreen(BaseScreen):
    """Screen for managing backups and restoring data."""

    BINDINGS = [
        Binding("r", "refresh_list", "Refresh", show=True),
    ]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.selected_backup: Path | None = None

    def compose_content(self) -> ComposeResult:
        """Compose the backup management interface."""
        yield Static("Backup Management", classes="title")

        # Stats section
        yield Static("", id="backup_stats", classes="stats")
        yield Static("", id="current_files_info", classes="info")

        # Action buttons
        yield Horizontal(
            Button("Create Backup", id="create_backup_button", variant="success"),
            Button(
                "Restore Selected",
                id="restore_button",
                variant="warning",
                disabled=True,
            ),
            Button(
                "Delete Selected", id="delete_button", variant="error", disabled=True
            ),
            classes="button-bar",
        )

        # Backups table
        yield Static("Available Backups:", classes="label")
        yield DataTable(id="backups_table", cursor_type="row", zebra_stripes=True)

    def on_mount(self) -> None:
        """Initialize the screen when mounted."""
        self.refresh_backup_list()
        self.query_one("#backups_table", DataTable).focus()

    def refresh_backup_list(self) -> None:
        """Refresh the list of available backups and statistics."""
        # Update statistics
        stats = get_backup_stats()
        stats_text = (
            f"Total Backups: {stats['count']} | "
            f"Total Size: {self._format_size(stats['total_size'])}"
        )
        if stats["newest"]:
            stats_text += f" | Newest: {stats['newest'].strftime('%Y-%m-%d %H:%M:%S')}"
        if stats["oldest"]:
            stats_text += f" | Oldest: {stats['oldest'].strftime('%Y-%m-%d %H:%M:%S')}"

        self.query_one("#backup_stats", Static).update(stats_text)

        # Update current files info
        trans_size = (
            TRANSACTIONS_FILE.stat().st_size if TRANSACTIONS_FILE.exists() else 0
        )
        cat_size = CATEGORIES_FILE.stat().st_size if CATEGORIES_FILE.exists() else 0
        files_info = (
            f"Current Data: transactions.parquet ({self._format_size(trans_size)}), "
            f"categories.json ({self._format_size(cat_size)})"
        )
        self.query_one("#current_files_info", Static).update(files_info)

        # Populate backups table
        table = self.query_one("#backups_table", DataTable)
        table.clear(columns=True)

        table.add_column("Timestamp", width=22)
        table.add_column("Size", width=15)
        table.add_column("File", width=None)

        backups = list_backups()

        if not backups:
            table.add_row("No backups available", "", "")
            self.query_one("#restore_button", Button).disabled = True
            self.query_one("#delete_button", Button).disabled = True
            return

        for timestamp, filepath, size in backups:
            table.add_row(
                timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                self._format_size(size),
                filepath.name,
                key=str(filepath),
            )

    def _format_size(self, size_bytes: int) -> str:
        """Format file size in human-readable format."""
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        else:
            return f"{size_bytes / (1024 * 1024):.1f} MB"

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """Handle row selection in the backups table."""
        if event.row_key.value == "No backups available":
            return

        self.selected_backup = Path(event.row_key.value)
        self.query_one("#restore_button", Button).disabled = False
        self.query_one("#delete_button", Button).disabled = False
        logging.info(f"Selected backup: {self.selected_backup.name}")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "create_backup_button":
            self.create_manual_backup()
        elif event.button.id == "restore_button":
            self.restore_selected_backup()
        elif event.button.id == "delete_button":
            self.delete_selected_backup()

    def create_manual_backup(self) -> None:
        """Create a manual backup of current data."""
        logging.info("Creating manual backup...")
        backup_path = create_auto_backup()

        if backup_path:
            self.app.show_notification(
                f"Backup created: {backup_path.name}",
                timeout=3.0,
            )
            self.refresh_backup_list()
        else:
            self.app.show_notification(
                "Failed to create backup. Check logs for details.",
                timeout=5.0,
            )

    def restore_selected_backup(self) -> None:
        """Restore from the selected backup after confirmation."""
        if not self.selected_backup:
            return

        def check_restore(confirmed: bool) -> None:
            if confirmed:
                logging.info(f"Restoring from backup: {self.selected_backup.name}")
                success = restore_from_backup(self.selected_backup)

                if success:
                    self.app.show_notification(
                        f"Successfully restored from {self.selected_backup.name}",
                        timeout=5.0,
                    )
                    self.refresh_backup_list()
                    # Notify all screens to reload data
                    self.app.refresh()
                else:
                    self.app.show_notification(
                        "Failed to restore backup. Check logs for details.",
                        timeout=5.0,
                    )

        backup_time = None
        for timestamp, filepath, _ in list_backups():
            if filepath == self.selected_backup:
                backup_time = timestamp.strftime("%Y-%m-%d %H:%M:%S")
                break

        self.app.push_confirmation(
            f"Are you sure you want to restore from backup '{self.selected_backup.name}'?\n\n"
            f"Backup time: {backup_time}\n\n"
            f"This will replace your current data (an emergency backup will be created first).",
            check_restore,
        )

    def delete_selected_backup(self) -> None:
        """Delete the selected backup after confirmation."""
        if not self.selected_backup:
            return

        def check_delete(confirmed: bool) -> None:
            if confirmed:
                try:
                    # Delete the backup file
                    self.selected_backup.unlink()

                    # Also delete corresponding categories file
                    timestamp = self.selected_backup.stem.replace("transactions_", "")
                    cat_backup = AUTO_BACKUP_DIR / f"categories_{timestamp}.json"
                    if cat_backup.exists():
                        cat_backup.unlink()

                    logging.info(f"Deleted backup: {self.selected_backup.name}")
                    self.app.show_notification(
                        f"Deleted backup: {self.selected_backup.name}",
                        timeout=3.0,
                    )
                    self.selected_backup = None
                    self.refresh_backup_list()
                except OSError as e:
                    logging.error(f"Failed to delete backup: {e}")
                    self.app.show_notification(
                        f"Failed to delete backup: {e}",
                        timeout=5.0,
                    )

        self.app.push_confirmation(
            f"Are you sure you want to delete backup '{self.selected_backup.name}'?\n\n"
            f"This action cannot be undone.",
            check_delete,
        )

    def action_refresh_list(self) -> None:
        """Action to refresh the backup list."""
        self.refresh_backup_list()
        self.app.show_notification("Backup list refreshed", timeout=2.0)
