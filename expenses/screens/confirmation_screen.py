from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static
from textual.containers import Grid, Vertical, Horizontal
from textual.binding import Binding


class ConfirmationScreen(ModalScreen[bool]):
    """A modal screen to confirm an action."""

    BINDINGS = [
        Binding("y", "confirm_yes", "Yes", show=False),
        Binding("n", "confirm_no", "No", show=False),
        Binding("enter", "confirm_yes", "Confirm", show=False),
        Binding("escape", "confirm_no", "Cancel", show=False),
    ]

    def __init__(self, prompt: str) -> None:
        self.prompt = prompt
        super().__init__()

    def compose(self) -> ComposeResult:
        yield Vertical(
            Static(self.prompt, id="question"),
            Horizontal(
                Button("Yes", variant="success", id="yes"),
                Button("No", variant="error", id="no"),
                id="button_container",
            ),
            Static("Press Y for Yes, N for No, or Enter to confirm", id="help_text"),
            id="dialog",
        )

    def on_mount(self) -> None:
        """Focus the Yes button on mount."""
        self.query_one("#yes", Button).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "yes":
            self.dismiss(True)
        else:
            self.dismiss(False)

    def action_confirm_yes(self) -> None:
        """Confirm action with Yes."""
        self.dismiss(True)

    def action_confirm_no(self) -> None:
        """Cancel action with No."""
        self.dismiss(False)
