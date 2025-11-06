from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, Input, Label
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
import logging


class EditTransactionScreen(ModalScreen[bool]):
    """A modal screen to add/edit merchant alias for a transaction."""

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Save", show=False),
    ]

    def __init__(
        self, original_merchant: str, current_alias: str | None = None
    ) -> None:
        """Initialize the edit screen.

        Args:
            original_merchant: The original merchant name from the transaction
            current_alias: The current alias (if one exists), or None
        """
        self.original_merchant = original_merchant
        self.current_alias = current_alias
        self.suggested_pattern = self._suggest_pattern(original_merchant)
        super().__init__()

    def _suggest_pattern(self, merchant: str) -> str:
        """Suggest a regex pattern based on the merchant name.

        Args:
            merchant: The merchant name to analyze

        Returns:
            A suggested regex pattern
        """
        # Remove trailing dates, numbers, and common transaction IDs
        # Example: "POS APPLE.COM/BI 02/08 1" -> "POS APPLE\.COM/BI.*"
        import re

        # First, remove common variable parts before escaping
        # - Dates like 02/08, 12/31
        cleaned = re.sub(r"\s+\d{2}/\d{2}", "", merchant)
        # - Trailing numbers/IDs and extra spaces
        cleaned = re.sub(r"\s+\d+$", "", cleaned)
        # - Normalize multiple spaces to single space
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        # Now escape special regex characters (but not spaces)
        # We'll manually escape the important ones
        escaped = cleaned
        # Escape special regex chars: . * + ? ^ $ { } [ ] ( ) | \
        for char in [
            ".",
            "*",
            "+",
            "?",
            "^",
            "$",
            "{",
            "}",
            "[",
            "]",
            "(",
            ")",
            "|",
            "\\",
        ]:
            escaped = escaped.replace(char, "\\" + char)

        # Replace single spaces with \s+ to match one or more whitespace chars
        escaped = escaped.replace(" ", r"\s+")

        # Add .* at the end to match any trailing content
        if escaped and not escaped.endswith(".*"):
            escaped += ".*"

        return escaped

    def compose(self) -> ComposeResult:
        title = "Edit Merchant Alias"
        if self.current_alias:
            instruction = f"Editing alias for: {self.original_merchant}"
        else:
            instruction = f"Create alias for: {self.original_merchant}"

        yield Vertical(
            Static(title, id="title"),
            Static(instruction, id="instruction"),
            Label("Original Merchant Name:"),
            Static(self.original_merchant, id="original_merchant"),
            Label("Regex Pattern (leave empty to remove alias):"),
            Input(
                value=self.suggested_pattern if not self.current_alias else "",
                placeholder="e.g., POS APPLE\\.COM/BI.*",
                id="pattern_input",
            ),
            Static(
                "Tip: Use .* to match anything, \\d for digits, \\s for spaces",
                id="pattern_help",
            ),
            Label("Display Alias:"),
            Input(
                value=self.current_alias or "",
                placeholder="e.g., Apple",
                id="alias_input",
            ),
            Horizontal(
                Button("Save", variant="success", id="save"),
                Button("Cancel", variant="error", id="cancel"),
                id="button_container",
            ),
            Static(
                "Press Ctrl+S to save, Escape to cancel",
                id="help_text",
            ),
            id="dialog",
        )

    def on_mount(self) -> None:
        """Focus the pattern input on mount."""
        # If there's already an alias, focus on the alias input
        # Otherwise focus on the pattern input
        if self.current_alias:
            self.query_one("#alias_input", Input).focus()
        else:
            self.query_one("#pattern_input", Input).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "save":
            self._save_alias()
        else:
            self.dismiss(False)

    def action_save(self) -> None:
        """Save action triggered by Ctrl+S."""
        self._save_alias()

    def action_cancel(self) -> None:
        """Cancel action triggered by Escape."""
        self.dismiss(False)

    def _save_alias(self) -> None:
        """Validate and save the alias."""
        pattern = self.query_one("#pattern_input", Input).value.strip()
        alias = self.query_one("#alias_input", Input).value.strip()

        # If pattern is empty, we're removing the alias
        if not pattern:
            if not alias:
                # Both empty, just cancel
                self.dismiss(False)
                return
            else:
                # Alias without pattern doesn't make sense
                self.notify(
                    "Pattern is required when setting an alias", severity="error"
                )
                return

        # Validate the regex pattern
        import re

        try:
            re.compile(pattern)
        except re.error as e:
            self.notify(f"Invalid regex pattern: {e}", severity="error")
            logging.warning(f"User entered invalid regex pattern: {pattern} - {e}")
            return

        # Both pattern and alias are provided
        if not alias:
            self.notify("Alias name is required", severity="error")
            return

        # Return the pattern and alias as a tuple
        self.dismiss((pattern, alias))
