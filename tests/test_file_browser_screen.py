"""Tests for FileBrowserScreen."""

import unittest
import tempfile
from pathlib import Path
from textual.app import App
from textual.widgets import DirectoryTree, Button
from expenses.screens.file_browser_screen import FileBrowserScreen


class TestFileBrowserScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for FileBrowserScreen."""

    async def test_screen_composition(self) -> None:
        """Test that file browser screen has required elements."""
        app = App()
        async with app.run_test() as pilot:
            screen = FileBrowserScreen()
            await pilot.app.push_screen(screen)

            # Check that required widgets are present
            assert pilot.app.screen.query_one(DirectoryTree)
            assert pilot.app.screen.query_one("#up_button", Button)

    async def test_up_button_navigates_to_parent(self) -> None:
        """Test that up button navigates to parent directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a subdirectory
            subdir = Path(tmpdir) / "subdir"
            subdir.mkdir()

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen()
                await pilot.app.push_screen(screen)

                # Set the tree to the subdirectory
                tree = pilot.app.screen.query_one(DirectoryTree)
                tree.path = str(subdir)
                await pilot.pause()

                # Click the up button
                up_button = pilot.app.screen.query_one("#up_button", Button)
                up_button.press()
                await pilot.pause()

                # Verify we moved to parent (tree.path is a Path object)
                assert str(tree.path) == tmpdir

    async def test_file_selection_dismisses_with_path(self) -> None:
        """Test that selecting a file dismisses screen with file path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a test file
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("test content")

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen()
                result = None

                def callback(path):
                    nonlocal result
                    result = path

                await pilot.app.push_screen(screen, callback)

                # Get the directory tree
                tree = pilot.app.screen.query_one(DirectoryTree)
                tree.path = tmpdir
                await pilot.pause()

                # Simulate file selection by calling the handler directly
                event = DirectoryTree.FileSelected(tree, test_file)
                screen.on_directory_tree_file_selected(event)
                await pilot.pause()

                # Verify the path was passed back
                assert result == str(test_file)

    async def test_up_button_at_root_stays_at_root(self) -> None:
        """Test that up button at root directory doesn't navigate further."""
        app = App()
        async with app.run_test() as pilot:
            screen = FileBrowserScreen()
            await pilot.app.push_screen(screen)

            tree = pilot.app.screen.query_one(DirectoryTree)
            # Set to root
            tree.path = "/"
            await pilot.pause()

            # Try to go up
            up_button = pilot.app.screen.query_one("#up_button", Button)
            up_button.press()
            await pilot.pause()

            # Should still be at root (tree.path is a Path object)
            assert str(tree.path) == "/"


if __name__ == "__main__":
    unittest.main()
