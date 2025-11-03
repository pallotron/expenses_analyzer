import logging
from textual.widgets import RichLog
from expenses.config import LOG_FILE


class LogViewer(RichLog):
    """A widget to display log files, updating in real-time."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._last_size = 0
        self._log_file_path = LOG_FILE

    async def on_mount(self) -> None:
        """Start monitoring the log file when the widget is mounted."""
        # Ensure the log file exists
        if not self._log_file_path.exists():
            self._log_file_path.touch()

        self.set_interval(0.5, self._check_for_updates)

    async def _check_for_updates(self) -> None:
        """Check for new content in the log file and update the display."""
        try:
            current_size = self._log_file_path.stat().st_size
            if current_size > self._last_size:
                with open(self._log_file_path, "r", encoding="utf-8") as log_file:
                    log_file.seek(self._last_size)
                    new_content = log_file.read()
                    if new_content:
                        self.write(new_content)
                self._last_size = current_size
            elif current_size < self._last_size:
                # Log file has been truncated/rotated
                self.clear()
                self._last_size = 0

        except FileNotFoundError:
            # Handle case where log file might be deleted during runtime
            self.clear()
            self._last_size = 0
        except Exception as e:
            # Silently ignore other potential errors like permission issues
            logging.debug(f"Error checking for log file updates: {e}")
