from textual.app import ComposeResult
from textual.screen import Screen
from textual.widgets import Footer
from textual.containers import Vertical


class BaseScreen(Screen):
    """A base screen with a common header and footer."""

    def compose(self) -> ComposeResult:
        """Compose the screen with a header, content, and footer."""
        # yield Header(name="Expenses Analyzer")
        with Vertical(classes="main_content"):
            yield from self.compose_content()
        yield Footer()

    def compose_content(self) -> ComposeResult:
        """
        Yield the content of the screen.
        This method should be overridden by subclasses.
        """
        yield from []
