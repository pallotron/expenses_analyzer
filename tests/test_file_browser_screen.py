"""Tests for FileBrowserScreen."""

import unittest
import tempfile
from pathlib import Path
from textual.app import App
from textual.widgets import DataTable, Button
from expenses.screens.file_browser_screen import FileBrowserScreen


class TestFileBrowserScreen(unittest.IsolatedAsyncioTestCase):
    """Test suite for FileBrowserScreen."""

    async def test_screen_composition(self) -> None:
        """Test that file browser screen has required elements."""
        app = App()
        async with app.run_test() as pilot:
            screen = FileBrowserScreen()
            await pilot.app.push_screen(screen)

            assert pilot.app.screen.query_one("#file_table", DataTable)
            assert pilot.app.screen.query_one("#up_button", Button)

    async def test_up_button_navigates_to_parent(self) -> None:
        """Test that up button navigates to parent directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = Path(tmpdir) / "subdir"
            subdir.mkdir()

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)])
                await pilot.app.push_screen(screen)

                # Navigate into the subdirectory
                screen._current_path = subdir
                screen._load_directory()
                await pilot.pause()

                assert screen._current_path.resolve() == subdir.resolve()

                # Click the up button
                up_button = pilot.app.screen.query_one("#up_button", Button)
                up_button.press()
                await pilot.pause()

                assert screen._current_path.resolve() == Path(tmpdir).resolve()

    async def test_csv_file_selection_dismisses_with_path(self) -> None:
        """Test that selecting a CSV file dismisses screen with file path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.csv"
            test_file.write_text("date,merchant,amount\n2024-01-01,Shop,10.00")

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)])
                result = None

                def callback(path):
                    nonlocal result
                    result = path

                await pilot.app.push_screen(screen, callback)

                # Navigate to the tmpdir
                screen._current_path = Path(tmpdir)
                screen._load_directory()
                await pilot.pause()

                # Simulate row selection for the CSV file
                row_key = str(test_file)
                screen._row_map[row_key] = (test_file, False)

                class FakeRowKey:
                    value = row_key

                class FakeEvent:
                    row_key = FakeRowKey()

                screen.on_data_table_row_selected(FakeEvent())
                await pilot.pause()

                assert result == str(test_file)

    async def test_non_csv_files_not_shown(self) -> None:
        """Test that non-CSV files are not shown in the file browser."""
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "data.csv").write_text("a,b\n1,2")
            (Path(tmpdir) / "notes.txt").write_text("hello")
            (Path(tmpdir) / "image.png").write_bytes(b"\x89PNG")

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)])
                await pilot.app.push_screen(screen)

                screen._current_path = Path(tmpdir)
                screen._load_directory()
                await pilot.pause()

                # Only the CSV file should be in _row_map (dirs would also be included)
                file_entries = [
                    path for path, is_dir in screen._row_map.values() if not is_dir
                ]
                assert len(file_entries) == 1
                assert file_entries[0].suffix.lower() == ".csv"

    async def test_sorting_by_modified_descending_by_default(self) -> None:
        """Test that files are sorted by modified date descending by default."""
        app = App()
        async with app.run_test() as pilot:
            screen = FileBrowserScreen()
            await pilot.app.push_screen(screen)

            assert screen._sort_key == "modified"
            assert screen._sort_reverse is True

    async def test_up_button_at_root_stays_within_safe_roots(self) -> None:
        """Test that up button does not navigate outside safe roots."""
        with tempfile.TemporaryDirectory() as tmpdir:
            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)])
                await pilot.app.push_screen(screen)

                screen._current_path = Path(tmpdir)
                screen._load_directory()
                await pilot.pause()

                initial_path = screen._current_path

                # Try to go up (parent is outside safe roots)
                up_button = pilot.app.screen.query_one("#up_button", Button)
                up_button.press()
                await pilot.pause()

                # Should not have moved outside safe roots
                assert screen._current_path == initial_path

    async def test_file_suffix_filters_shown_files(self) -> None:
        """Test that file_suffix controls which file type is shown."""
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "payslip.pdf").write_bytes(b"%PDF-1.4")
            (Path(tmpdir) / "data.csv").write_text("a,b\n1,2")

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)], file_suffix=".pdf")
                await pilot.app.push_screen(screen)

                screen._current_path = Path(tmpdir)
                screen._load_directory()
                await pilot.pause()

                file_entries = [
                    path for path, is_dir in screen._row_map.values() if not is_dir
                ]
                assert len(file_entries) == 1
                assert file_entries[0].suffix.lower() == ".pdf"

    async def test_select_dirs_button_dismisses_with_current_folder(self) -> None:
        """Test that the Select This Folder button dismisses with current path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = Path(tmpdir) / "subdir"
            subdir.mkdir()

            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)], select_dirs=True)
                result = None

                def callback(path):
                    nonlocal result
                    result = path

                await pilot.app.push_screen(screen, callback)

                screen._current_path = subdir
                screen._load_directory()
                await pilot.pause()

                select_button = pilot.app.screen.query_one("#select_folder_button", Button)
                select_button.press()
                await pilot.pause()

                assert result == str(subdir)

    async def test_no_select_folder_button_by_default(self) -> None:
        """Test that the Select This Folder button is absent by default."""
        with tempfile.TemporaryDirectory() as tmpdir:
            app = App()
            async with app.run_test() as pilot:
                screen = FileBrowserScreen(safe_roots=[Path(tmpdir)])
                await pilot.app.push_screen(screen)

                with self.assertRaises(Exception):
                    pilot.app.screen.query_one("#select_folder_button", Button)


if __name__ == "__main__":
    unittest.main()
