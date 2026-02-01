from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, Input, Label, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from typing import Dict, List, Optional
import logging


# Special values for the select dropdowns
NO_CHANGE = "__no_change__"
CUSTOM = "__custom__"


class BulkEditTransactionScreen(ModalScreen[Optional[Dict]]):
    """A modal screen to bulk edit selected transactions."""

    DEFAULT_CSS = """
    BulkEditTransactionScreen {
        align: center middle;
    }

    BulkEditTransactionScreen #dialog {
        width: 60;
        height: auto;
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }

    BulkEditTransactionScreen .hidden {
        display: none;
    }

    BulkEditTransactionScreen #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }

    BulkEditTransactionScreen #count_display {
        text-align: center;
        color: $text-muted;
    }

    BulkEditTransactionScreen #instruction {
        text-align: center;
        color: $text-muted;
        margin-bottom: 1;
    }

    BulkEditTransactionScreen #button_container {
        margin-top: 1;
        align: center middle;
    }

    BulkEditTransactionScreen #help_text {
        text-align: center;
        color: $text-muted;
        margin-top: 1;
    }
    """

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Save", show=False),
    ]

    def __init__(
        self,
        selected_count: int,
        existing_merchants: Optional[List[str]] = None,
        existing_sources: Optional[List[str]] = None,
    ) -> None:
        """Initialize the bulk edit screen.

        Args:
            selected_count: Number of selected transactions to edit
            existing_merchants: List of existing merchant names for dropdown
            existing_sources: List of existing source names for dropdown
        """
        self.selected_count = selected_count
        self.existing_merchants = existing_merchants or []
        self.existing_sources = existing_sources or []
        super().__init__()

    def compose(self) -> ComposeResult:
        # Build merchant options: No change, existing merchants, Custom
        merchant_options = [("No change", NO_CHANGE)]
        for m in sorted(set(self.existing_merchants)):
            if m:  # Skip empty strings
                merchant_options.append((m, m))
        merchant_options.append(("Custom...", CUSTOM))

        # Build source options: No change, existing sources, Custom
        source_options = [("No change", NO_CHANGE)]
        for s in sorted(set(self.existing_sources)):
            if s and s != "Unknown":  # Skip empty and "Unknown"
                source_options.append((s, s))
        source_options.append(("Custom...", CUSTOM))

        yield Vertical(
            Static("Bulk Edit Transactions", id="title"),
            Static(
                f"Editing {self.selected_count} transaction(s)",
                id="count_display",
            ),
            Static(
                "Select 'No change' to keep original values",
                id="instruction",
            ),
            Label("Merchant:"),
            Select(
                merchant_options,
                value=NO_CHANGE,
                id="merchant_select",
            ),
            Input(
                value="",
                placeholder="Enter custom merchant name",
                id="merchant_input",
                classes="hidden",
            ),
            Label("Source:"),
            Select(
                source_options,
                value=NO_CHANGE,
                id="source_select",
            ),
            Input(
                value="",
                placeholder="Enter custom source name",
                id="source_input",
                classes="hidden",
            ),
            Label("Type:"),
            Select(
                [
                    ("No change", NO_CHANGE),
                    ("Expense", "expense"),
                    ("Income", "income"),
                ],
                value=NO_CHANGE,
                id="type_select",
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
        """Focus the merchant select on mount."""
        self.query_one("#merchant_select", Select).focus()

    def on_select_changed(self, event: Select.Changed) -> None:
        """Handle select dropdown changes to show/hide custom input."""
        if event.select.id == "merchant_select":
            merchant_input = self.query_one("#merchant_input", Input)
            if event.value == CUSTOM:
                merchant_input.remove_class("hidden")
                merchant_input.focus()
            else:
                merchant_input.add_class("hidden")
                merchant_input.value = ""
        elif event.select.id == "source_select":
            source_input = self.query_one("#source_input", Input)
            if event.value == CUSTOM:
                source_input.remove_class("hidden")
                source_input.focus()
            else:
                source_input.add_class("hidden")
                source_input.value = ""

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "save":
            self._save_changes()
        else:
            self.dismiss(None)

    def action_save(self) -> None:
        """Save action triggered by Ctrl+S."""
        self._save_changes()

    def action_cancel(self) -> None:
        """Cancel action triggered by Escape."""
        self.dismiss(None)

    def _get_merchant_value(self) -> Optional[str]:
        """Get the merchant value from select or custom input."""
        select_value = self.query_one("#merchant_select", Select).value
        if select_value == NO_CHANGE:
            return None
        elif select_value == CUSTOM:
            custom_value = self.query_one("#merchant_input", Input).value.strip()
            return custom_value if custom_value else None
        else:
            return select_value

    def _get_source_value(self) -> Optional[str]:
        """Get the source value from select or custom input."""
        select_value = self.query_one("#source_select", Select).value
        if select_value == NO_CHANGE:
            return None
        elif select_value == CUSTOM:
            custom_value = self.query_one("#source_input", Input).value.strip()
            return custom_value if custom_value else None
        else:
            return select_value

    def _save_changes(self) -> None:
        """Collect non-empty fields and save."""
        merchant = self._get_merchant_value()
        source = self._get_source_value()
        type_select = self.query_one("#type_select", Select)
        transaction_type = type_select.value

        # Build result dict with only non-empty values
        result = {}

        if merchant:
            result["Merchant"] = merchant

        if source:
            result["Source"] = source

        if transaction_type and transaction_type != NO_CHANGE:
            if transaction_type in ("expense", "income"):
                result["Type"] = transaction_type
            else:
                self.notify("Invalid type selected.", severity="error")
                return

        # If no fields selected, notify user
        if not result:
            self.notify(
                "No changes specified. Select at least one field to change.",
                severity="warning",
            )
            return

        logging.info(
            f"Bulk edit: applying {result} to {self.selected_count} transactions"
        )
        self.dismiss(result)
