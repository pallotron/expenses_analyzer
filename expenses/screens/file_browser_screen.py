import os
from pathlib import Path
from textual.app import ComposeResult
from textual.widgets import DirectoryTree, Button
from textual.containers import Vertical
from typing import Any

from expenses.screens.base_screen import BaseScreen


class FileBrowserScreen(BaseScreen):
    """A screen for browsing files."""

    def __init__(self, *args, safe_roots: list[Path] | None = None, **kwargs):
        """Initialize the file browser with safe root directories.

        Args:
            safe_roots: Optional list of safe root directories. If None, uses default
                       safe roots (home, Documents, Downloads, and Windows drives).
        """
        super().__init__(*args, **kwargs)
        if safe_roots is not None:
            # Resolve custom safe roots
            self._safe_roots = [root.resolve() for root in safe_roots]
        else:
            self._safe_roots = self._get_safe_roots()

    def _get_safe_roots(self) -> list[Path]:
        """Get list of safe root directories that can be browsed."""
        safe_roots = [
            Path.home(),
            Path.home() / "Documents",
            Path.home() / "Downloads",
        ]

        # On Windows, allow browsing other drives if they exist
        if os.name == "nt":
            for drive_letter in "DEFGHIJ":
                drive_path = Path(f"{drive_letter}:\\")
                if drive_path.exists():
                    safe_roots.append(drive_path)

        return [root.resolve() for root in safe_roots if root.exists()]

    def _is_safe_path(self, path: Path) -> bool:
        """Ensure path is within one of the safe root directories."""
        try:
            resolved_path = path.resolve()

            # Check if path is within any of the safe roots
            for safe_root in self._safe_roots:
                try:
                    resolved_path.relative_to(safe_root)
                    return True
                except ValueError:
                    continue

            return False
        except (RuntimeError, OSError):
            # RuntimeError: infinite loop in symlink resolution
            # OSError: path doesn't exist or permission issues
            return False

    def compose_content(self) -> ComposeResult:
        # Start at home directory instead of current working directory
        start_path = str(Path.home())
        yield Vertical(
            Button("Up a directory", id="up_button"),
            DirectoryTree(start_path, id="file_tree"),
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Called when the 'Up' button is pressed."""
        if event.button.id == "up_button":
            tree = self.query_one(DirectoryTree)
            current_path = Path(tree.path).resolve()
            parent_path = current_path.parent

            # Only navigate up if parent is different and within safe boundaries
            if parent_path != current_path and self._is_safe_path(parent_path):
                tree.path = str(parent_path)
            # If parent would escape safe roots, stay at current location

    def on_directory_tree_file_selected(
        self, event: DirectoryTree.FileSelected
    ) -> None:
        """Called when a file is selected."""
        selected_path = Path(event.path)

        # Only allow selecting files within safe boundaries
        if self._is_safe_path(selected_path):
            self.dismiss(str(event.path))
        else:
            # Reject file selection outside safe roots
            # Use show_notification if available (ExpensesApp), otherwise silent fail
            if hasattr(self.app, "show_notification"):
                self.app.show_notification(
                    "Cannot select files outside allowed directories", severity="error"
                )
