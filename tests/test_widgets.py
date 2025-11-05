import unittest
import tempfile
from pathlib import Path
from textual.app import App, ComposeResult
from expenses.widgets.clearable_input import ClearableInput
from expenses.widgets.notification import Notification
from expenses.widgets.log_viewer import LogViewer


class TestClearableInput(unittest.IsolatedAsyncioTestCase):
    """Test suite for ClearableInput widget."""

    async def test_clearable_input_initial_value(self) -> None:
        """Test that ClearableInput can be initialized with a value."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield ClearableInput(value="initial text")

        app = TestApp()
        async with app.run_test() as pilot:
            input_widget = pilot.app.query_one(ClearableInput)
            assert input_widget.value == "initial text"

    async def test_clearable_input_clear_action(self) -> None:
        """Test that clear action empties the input."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield ClearableInput(value="some text")

        app = TestApp()
        async with app.run_test() as pilot:
            input_widget = pilot.app.query_one(ClearableInput)
            assert input_widget.value == "some text"

            # Trigger the clear action
            input_widget.action_clear_input()
            assert input_widget.value == ""

    async def test_clearable_input_has_binding(self) -> None:
        """Test that ClearableInput has the ctrl+u binding."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield ClearableInput()

        app = TestApp()
        async with app.run_test() as pilot:
            input_widget = pilot.app.query_one(ClearableInput)

            # Check that the binding exists
            bindings = {binding.key for binding in input_widget.BINDINGS}
            assert "ctrl+u" in bindings


class TestNotification(unittest.IsolatedAsyncioTestCase):
    """Test suite for Notification widget."""

    async def test_notification_displays_message(self) -> None:
        """Test that notification displays the message."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield Notification("Test message")

        app = TestApp()
        async with app.run_test() as pilot:
            notification = pilot.app.query_one(Notification)
            # Static widget stores content accessible via render()
            assert "Test message" in str(notification.render())

    async def test_notification_has_timeout(self) -> None:
        """Test that notification has a timeout property."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield Notification("Test", timeout=5)

        app = TestApp()
        async with app.run_test() as pilot:
            notification = pilot.app.query_one(Notification)
            assert notification.timeout == 5

    async def test_notification_default_timeout(self) -> None:
        """Test that notification has default timeout of 3."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield Notification("Test")

        app = TestApp()
        async with app.run_test() as pilot:
            notification = pilot.app.query_one(Notification)
            assert notification.timeout == 3

    async def test_notification_auto_removes(self) -> None:
        """Test that notification auto-removes after timeout."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield Notification("Test", timeout=1)

        app = TestApp()
        async with app.run_test() as pilot:
            # Initially notification should exist
            notifications = pilot.app.query(Notification)
            assert len(notifications) == 1

            # Wait for timeout + a bit more
            await pilot.pause(1.5)

            # Notification should be removed
            notifications = pilot.app.query(Notification)
            assert len(notifications) == 0


class TestLogViewer(unittest.IsolatedAsyncioTestCase):
    """Test suite for LogViewer widget."""

    async def test_log_viewer_initializes(self) -> None:
        """Test that LogViewer can be initialized."""

        class TestApp(App):
            def compose(self) -> ComposeResult:
                yield LogViewer()

        app = TestApp()
        async with app.run_test() as pilot:
            log_viewer = pilot.app.query_one(LogViewer)
            assert log_viewer is not None

    async def test_log_viewer_creates_log_file_if_missing(self) -> None:
        """Test that LogViewer creates log file if it doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "test.log"

            class TestApp(App):
                def compose(self) -> ComposeResult:
                    viewer = LogViewer()
                    viewer._log_file_path = log_path
                    yield viewer

            app = TestApp()
            async with app.run_test() as pilot:
                await pilot.pause(0.1)
                assert log_path.exists()

    async def test_log_viewer_reads_existing_content(self) -> None:
        """Test that LogViewer can read content from existing log file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "test.log"

            # Write initial content
            log_path.write_text("Initial log line\n")

            class TestApp(App):
                def compose(self) -> ComposeResult:
                    viewer = LogViewer()
                    viewer._log_file_path = log_path
                    yield viewer

            app = TestApp()
            async with app.run_test() as pilot:
                log_viewer = pilot.app.query_one(LogViewer)

                # Write new content
                with open(log_path, "a") as f:
                    f.write("New log line\n")

                # Wait for update check
                await pilot.pause(0.6)

                # Check that the viewer has content
                assert log_viewer._last_size > 0

    async def test_log_viewer_handles_truncated_file(self) -> None:
        """Test that LogViewer handles truncated log files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "test.log"
            log_path.write_text("Initial content\n")

            class TestApp(App):
                def compose(self) -> ComposeResult:
                    viewer = LogViewer()
                    viewer._log_file_path = log_path
                    yield viewer

            app = TestApp()
            async with app.run_test() as pilot:
                log_viewer = pilot.app.query_one(LogViewer)

                # Wait for initial read
                await pilot.pause(0.6)

                # Truncate the file
                log_path.write_text("")

                # Wait for update check
                await pilot.pause(0.6)

                # Last size should be reset to 0
                assert log_viewer._last_size == 0

    async def test_log_viewer_handles_deleted_file(self) -> None:
        """Test that LogViewer handles deleted log files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "test.log"
            log_path.write_text("Content\n")

            class TestApp(App):
                def compose(self) -> ComposeResult:
                    viewer = LogViewer()
                    viewer._log_file_path = log_path
                    yield viewer

            app = TestApp()
            async with app.run_test() as pilot:
                log_viewer = pilot.app.query_one(LogViewer)

                # Wait for initial read
                await pilot.pause(0.6)

                # Delete the file
                log_path.unlink()

                # Wait for update check
                await pilot.pause(0.6)

                # Should handle gracefully
                assert log_viewer._last_size == 0


if __name__ == "__main__":
    unittest.main()
