from textual.app import ComposeResult
from textual.widgets import DirectoryTree

from expenses.screens.base_screen import BaseScreen

class FileBrowserScreen(BaseScreen):
    """A screen for browsing files."""

    def compose_content(self) -> ComposeResult:
        yield DirectoryTree("./", id="file_tree")

    def on_directory_tree_file_selected(self, event: DirectoryTree.FileSelected) -> None:
        """Called when a file is selected."""
        self.dismiss(str(event.path))
