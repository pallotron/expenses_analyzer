from textual.widgets import Input
from textual.binding import Binding
from typing import ClassVar


class ClearableInput(Input):
    """An Input widget that can be cleared with a key binding."""

    BINDINGS: ClassVar[list[Binding]] = [
        Binding("ctrl+u", "clear_input", "Clear Input", show=True),
    ]

    def action_clear_input(self) -> None:
        """Clear the input."""
        self.value = ""
