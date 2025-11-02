from textual.widgets import Static
from textual.timer import Timer


class Notification(Static):
    """A widget to display notifications."""

    def __init__(self, message: str, timeout: int = 3) -> None:
        super().__init__(message, classes="notification")
        self.timeout = timeout
        self.timer: Timer | None = None

    def on_mount(self) -> None:
        """Start the timer to remove the notification."""
        self.timer = self.set_timer(self.timeout, self.remove)

    def on_click(self) -> None:
        """Remove the notification when clicked."""
        if self.timer:
            self.timer.stop()
        self.remove()
