from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, Input, Label, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from typing import Dict, List, Optional

from expenses.tags import normalize_tag


class TagTransactionsScreen(ModalScreen[Optional[Dict]]):
    """Modal to add or remove tags on a set of transactions."""

    DEFAULT_CSS = """
    TagTransactionsScreen {
        align: center middle;
    }

    TagTransactionsScreen #dialog {
        width: 60;
        height: auto;
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }

    TagTransactionsScreen #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }

    TagTransactionsScreen #count_display {
        text-align: center;
        color: $text-muted;
        margin-bottom: 1;
    }

    TagTransactionsScreen #button_container {
        margin-top: 1;
        align: center middle;
    }
    """

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Apply", show=False),
    ]

    def __init__(
        self, selected_count: int, existing_tags: Optional[List[str]] = None
    ) -> None:
        self.selected_count = selected_count
        self.existing_tags = existing_tags or []
        super().__init__()

    def compose(self) -> ComposeResult:
        hint = ""
        if self.existing_tags:
            hint = f"existing: {', '.join(self.existing_tags)}"
        yield Vertical(
            Static("Tag Transactions", id="title"),
            Static(
                f"Applying to {self.selected_count} transaction(s)", id="count_display"
            ),
            Label("Tags (comma-separated, e.g. emergency, trip:paris-jun26):"),
            Input(value="", placeholder=hint or "tag1, tag2", id="tags_input"),
            Label("Mode:"),
            Select(
                [("Add tags", "add"), ("Remove tags", "remove")],
                value="add",
                id="mode_select",
            ),
            Horizontal(
                Button("Apply", variant="success", id="apply"),
                Button("Cancel", variant="error", id="cancel"),
                id="button_container",
            ),
            Static("Ctrl+S to apply, Escape to cancel", id="help_text"),
            id="dialog",
        )

    def on_mount(self) -> None:
        self.query_one("#tags_input", Input).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "apply":
            self._apply()
        else:
            self.dismiss(None)

    def action_save(self) -> None:
        self._apply()

    def action_cancel(self) -> None:
        self.dismiss(None)

    def _apply(self) -> None:
        raw = self.query_one("#tags_input", Input).value
        tags = [t for t in (normalize_tag(t) for t in raw.split(",")) if t]
        if not tags:
            self.notify("No valid tags entered.", severity="warning")
            return
        mode = self.query_one("#mode_select", Select).value
        if mode not in ("add", "remove"):
            mode = "add"
        self.dismiss({"tags": tags, "mode": mode})
