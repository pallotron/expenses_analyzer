import logging
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import Footer, Header

from expenses.config import CONFIG_DIR, LOG_FILE
from expenses.screens.summary_screen import SummaryScreen
from expenses.screens.import_screen import ImportScreen
from expenses.screens.categorize_screen import CategorizeScreen
from expenses.screens.file_browser_screen import FileBrowserScreen
from expenses.screens.transaction_screen import TransactionScreen
from expenses.screens.delete_screen import DeleteScreen
from expenses.screens.confirmation_screen import ConfirmationScreen
from expenses.widgets.notification import Notification
from typing import Callable

# Ensure config directory and log file exist
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
if not LOG_FILE.exists():
    LOG_FILE.touch()

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    filename=LOG_FILE,
    filemode="a",
)
logging.info("Application starting...")
# ---


class ExpensesApp(App):
    """A textual app to manage expenses."""

    CSS_PATH = "main.css"

    SCREENS = {
        "summary": SummaryScreen,
        "import": ImportScreen,
        "categorize": CategorizeScreen,
        "file_browser": FileBrowserScreen,
        "transactions": TransactionScreen,
        "delete": DeleteScreen,
    }

    BINDINGS = [
        Binding("s", "push_screen('summary')", "Summary", show=True),
        Binding("t", "push_screen('transactions')", "Transactions", show=True),
        Binding("i", "push_screen('import')", "Import", show=True),
        Binding("c", "push_screen('categorize')", "Categorize", show=True),
        Binding("d", "push_screen('delete')", "Delete", show=True),
        Binding("escape", "pop_screen", "Back", show=False),
        Binding("ctrl+q", "quit", "Quit", show=True),
    ]

    def compose(self) -> ComposeResult:
        """Create child widgets for the app."""
        yield Header()
        yield Footer()

    def on_mount(self) -> None:
        """Called when the app is first mounted."""
        self.push_screen("summary")

    def action_pop_screen(self) -> None:
        """Pop a screen from the stack, but not if it's the last one."""
        if len(self.screen_stack) > 1:
            self.pop_screen()

    def action_quit(self) -> None:
        """An action to quit the app."""
        logging.info("Application shutting down.")
        self.exit()

    def push_confirmation(self, prompt: str, callback: Callable[[bool], None]) -> None:
        """Push a confirmation screen."""
        self.push_screen(ConfirmationScreen(prompt), callback)

    def show_notification(self, message: str, timeout: int = 3) -> None:
        """Show a notification."""
        notification = Notification(message, timeout)
        self.screen.mount(notification)
        notification.add_class("visible")


if __name__ == "__main__":
    app = ExpensesApp()
    app.run()
