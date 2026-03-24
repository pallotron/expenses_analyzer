import os
from datetime import datetime
from pathlib import Path

from textual.app import ComposeResult
from textual.widgets import Button, DataTable, Static
from textual.containers import Vertical

from expenses.screens.base_screen import BaseScreen


class FileBrowserScreen(BaseScreen):
    """A screen for browsing files, showing only CSV files."""

    def __init__(self, *args, safe_roots: list[Path] | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._current_path = Path.home()
        self._sort_key = "modified"
        self._sort_reverse = True  # newest first by default
        self._row_map: dict[str, tuple[Path, bool]] = {}
        if safe_roots is not None:
            self._safe_roots = [root.resolve() for root in safe_roots]
        else:
            self._safe_roots = self._get_safe_roots()

    def _get_safe_roots(self) -> list[Path]:
        safe_roots = [
            Path.home(),
            Path.home() / "Documents",
            Path.home() / "Downloads",
        ]
        if os.name == "nt":
            for drive_letter in "DEFGHIJ":
                drive_path = Path(f"{drive_letter}:\\")
                if drive_path.exists():
                    safe_roots.append(drive_path)
        return [root.resolve() for root in safe_roots if root.exists()]

    def _is_safe_path(self, path: Path) -> bool:
        try:
            resolved_path = path.resolve()
            for safe_root in self._safe_roots:
                try:
                    resolved_path.relative_to(safe_root)
                    return True
                except ValueError:
                    continue
            return False
        except (RuntimeError, OSError):
            return False

    def compose_content(self) -> ComposeResult:
        yield Vertical(
            Static("", id="current_path_label"),
            Button("Up a directory", id="up_button"),
            DataTable(id="file_table", cursor_type="row"),
        )

    def on_mount(self) -> None:
        self._load_directory()

    def _column_label(self, label: str, key: str) -> str:
        if self._sort_key == key:
            return label + (" \u25bc" if self._sort_reverse else " \u25b2")
        return label

    def _load_directory(self) -> None:
        self.query_one("#current_path_label", Static).update(str(self._current_path))
        table = self.query_one("#file_table", DataTable)
        table.clear(columns=True)
        self._row_map = {}

        table.add_columns(
            self._column_label("Name", "name"),
            self._column_label("Modified", "modified"),
        )

        try:
            dirs: list[tuple[Path, str, float]] = []
            files: list[tuple[Path, str, float]] = []

            for entry in self._current_path.iterdir():
                try:
                    mtime = entry.stat().st_mtime
                    mod_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
                except OSError:
                    mtime = 0.0
                    mod_str = "-"

                if entry.is_dir() and not entry.name.startswith("."):
                    dirs.append((entry, mod_str, mtime))
                elif entry.suffix.lower() == ".csv":
                    files.append((entry, mod_str, mtime))

            sort_fn = (
                (lambda x: x[2]) if self._sort_key == "modified"
                else (lambda x: x[0].name.lower())
            )
            dirs.sort(key=sort_fn, reverse=self._sort_reverse)
            files.sort(key=sort_fn, reverse=self._sort_reverse)

            for entry, mod_str, _ in dirs:
                row_key = str(entry)
                table.add_row(f"[DIR] {entry.name}", mod_str, key=row_key)
                self._row_map[row_key] = (entry, True)

            for entry, mod_str, _ in files:
                row_key = str(entry)
                table.add_row(entry.name, mod_str, key=row_key)
                self._row_map[row_key] = (entry, False)

        except PermissionError:
            pass

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "up_button":
            parent_path = self._current_path.parent
            if parent_path != self._current_path and self._is_safe_path(parent_path):
                self._current_path = parent_path
                self._load_directory()

    def on_data_table_header_selected(self, event: DataTable.HeaderSelected) -> None:
        label = event.label.plain.replace(" \u25bc", "").replace(" \u25b2", "")
        if label == "Modified":
            if self._sort_key == "modified":
                self._sort_reverse = not self._sort_reverse
            else:
                self._sort_key = "modified"
                self._sort_reverse = True
        elif label == "Name":
            if self._sort_key == "name":
                self._sort_reverse = not self._sort_reverse
            else:
                self._sort_key = "name"
                self._sort_reverse = False
        self._load_directory()

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        row_key = event.row_key.value
        if row_key not in self._row_map:
            return
        path, is_dir = self._row_map[row_key]
        if is_dir:
            if self._is_safe_path(path):
                self._current_path = path.resolve()
                self._load_directory()
        else:
            if self._is_safe_path(path):
                self.dismiss(str(path))
