import logging
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import Footer, Header

from expenses.config import LOG_FILE
from expenses.screens.summary_screen import SummaryScreen
from expenses.screens.import_screen import ImportScreen
from expenses.screens.categorize_screen import CategorizeScreen
from expenses.screens.file_browser_screen import FileBrowserScreen
from expenses.widgets.log_viewer import LogViewer

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    filename=LOG_FILE,
    filemode='a'
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
    }

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("s", "push_screen('summary')", "Summary"),
        Binding("i", "push_screen('import')", "Import"),
        Binding("c", "push_screen('categorize')", "Categorize"),
        Binding("l", "toggle_log_viewer", "Toggle Logs"),
    ]

    def compose(self) -> ComposeResult:
        """Create child widgets for the app."""
        yield Header()
        yield Footer()
        yield LogViewer(id="log_viewer", classes="-hidden")

    def on_mount(self) -> None:
        """Called when the app is first mounted."""
        self.push_screen("summary")

    def action_toggle_log_viewer(self) -> None:
        """Toggle the visibility of the log viewer."""
        log_viewer = self.query_one(LogViewer)
        log_viewer.toggle_class("-hidden")

    def action_quit(self) -> None:
        """An action to quit the app."""
        logging.info("Application shutting down.")
        self.exit()

if __name__ == "__main__":
    app = ExpensesApp()
    app.run()
