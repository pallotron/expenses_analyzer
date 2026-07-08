from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, SelectionList
from textual.widgets.selection_list import Selection
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from typing import List, Optional, Tuple


def build_pattern_options(
    tags_in_use: List[str], namespaces: List[str], excluded: List[str]
) -> List[Tuple[str, bool]]:
    """Ordered (pattern, pre_ticked) pairs: ns* rows, tags in use, stale excluded."""
    excluded_set = set(excluded)
    seen: set = set()
    options: List[Tuple[str, bool]] = []
    candidates = [ns + "*" for ns in namespaces] + list(tags_in_use) + list(excluded)
    for value in candidates:
        if value and value not in seen:
            seen.add(value)
            options.append((value, value in excluded_set))
    return options


class TagExclusionScreen(ModalScreen[Optional[List[str]]]):
    """Modal to pick which tag patterns are excluded from Summary totals."""

    DEFAULT_CSS = """
    TagExclusionScreen {
        align: center middle;
    }

    TagExclusionScreen #dialog {
        width: 60;
        height: auto;
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }

    TagExclusionScreen #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }

    TagExclusionScreen #hint {
        text-align: center;
        color: $text-muted;
        margin-bottom: 1;
    }

    TagExclusionScreen #pattern_list {
        max-height: 15;
    }

    TagExclusionScreen #button_container {
        margin-top: 1;
        align: center middle;
    }

    TagExclusionScreen #help_text {
        text-align: center;
        color: $text-muted;
        margin-top: 1;
    }
    """

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Apply", show=False),
    ]

    def __init__(
        self,
        tags_in_use: List[str],
        namespaces: List[str],
        excluded: List[str],
    ) -> None:
        self.tags_in_use = tags_in_use
        self.namespaces = namespaces
        self.excluded = excluded
        super().__init__()

    def compose(self) -> ComposeResult:
        options = build_pattern_options(
            self.tags_in_use, self.namespaces, self.excluded
        )
        hint = (
            "Ticked patterns are hidden from Summary totals"
            if options
            else "No tags in use"
        )
        selections = [
            Selection(pattern, pattern, ticked) for pattern, ticked in options
        ]
        yield Vertical(
            Static("Exclude Tags from Summary", id="title"),
            Static(hint, id="hint"),
            SelectionList(*selections, id="pattern_list"),
            Horizontal(
                Button("Apply", variant="success", id="apply"),
                Button("Cancel", variant="error", id="cancel"),
                id="button_container",
            ),
            Static("Ctrl+S to apply, Escape to cancel", id="help_text"),
            id="dialog",
        )

    def on_mount(self) -> None:
        self.query_one("#pattern_list", SelectionList).focus()

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
        selected = list(self.query_one("#pattern_list", SelectionList).selected)
        self.dismiss(selected)
