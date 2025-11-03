import os
from textual.app import ComposeResult
from textual.widgets import DirectoryTree, Button
from textual.containers import Vertical

from expenses.screens.base_screen import BaseScreen


class FileBrowserScreen(BaseScreen):
    """A screen for browsing files."""

    def compose_content(self) -> ComposeResult:
        yield Vertical(
            Button("Up a directory", id="up_button"),
            DirectoryTree("./", id="file_tree"),
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Called when the 'Up' button is pressed."""
        if event.button.id == "up_button":
            tree = self.query_one(DirectoryTree)
            current_path = os.path.abspath(tree.path)
            parent_path = os.path.dirname(current_path)
            if parent_path != current_path:
                tree.path = parent_path

    def on_directory_tree_file_selected(
        self, event: DirectoryTree.FileSelected
    ) -> None:
        """Called when a file is selected."""
        self.dismiss(str(event.path))
