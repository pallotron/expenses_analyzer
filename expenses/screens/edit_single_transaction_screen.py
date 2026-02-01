from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, Input, Label, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from typing import Dict, Optional
import logging
import pandas as pd


class EditSingleTransactionScreen(ModalScreen[Optional[Dict]]):
    """A modal screen to edit a single transaction."""

    DEFAULT_CSS = """
    EditSingleTransactionScreen {
        align: center middle;
    }

    EditSingleTransactionScreen #dialog {
        width: 60;
        height: auto;
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }

    EditSingleTransactionScreen #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }

    EditSingleTransactionScreen #button_container {
        margin-top: 1;
        align: center middle;
    }

    EditSingleTransactionScreen #help_text {
        text-align: center;
        color: $text-muted;
        margin-top: 1;
    }
    """

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Save", show=False),
    ]

    def __init__(self, transaction_data: Dict, original_index: int) -> None:
        """Initialize the edit screen.

        Args:
            transaction_data: Dict with transaction fields (Date, Merchant, Amount, Source, Type)
            original_index: The DataFrame index of the transaction
        """
        self.transaction_data = transaction_data
        self.original_index = original_index
        super().__init__()

    def compose(self) -> ComposeResult:
        # Format date for display
        date_value = self.transaction_data.get("Date", "")
        if pd.notna(date_value):
            if hasattr(date_value, "strftime"):
                date_value = date_value.strftime("%Y-%m-%d")
            else:
                date_value = str(date_value)[:10]
        else:
            date_value = ""

        # Format amount for display
        amount_value = self.transaction_data.get("Amount", "")
        if pd.notna(amount_value):
            amount_value = f"{float(amount_value):.2f}"
        else:
            amount_value = ""

        # Get current type
        current_type = str(self.transaction_data.get("Type", "expense")).lower()
        if current_type not in ("expense", "income"):
            current_type = "expense"

        yield Vertical(
            Static("Edit Transaction", id="title"),
            Label("Date (YYYY-MM-DD):"),
            Input(
                value=date_value,
                placeholder="YYYY-MM-DD",
                id="date_input",
            ),
            Label("Merchant:"),
            Input(
                value=str(self.transaction_data.get("Merchant", "")),
                placeholder="Merchant name",
                id="merchant_input",
            ),
            Label("Amount:"),
            Input(
                value=amount_value,
                placeholder="0.00",
                id="amount_input",
            ),
            Label("Source:"),
            Input(
                value=str(self.transaction_data.get("Source", "Unknown") or "Unknown"),
                placeholder="Source",
                id="source_input",
            ),
            Label("Type:"),
            Select(
                [("Expense", "expense"), ("Income", "income")],
                value=current_type,
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
        """Focus the date input on mount."""
        self.query_one("#date_input", Input).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "save":
            self._save_transaction()
        else:
            self.dismiss(None)

    def action_save(self) -> None:
        """Save action triggered by Ctrl+S."""
        self._save_transaction()

    def action_cancel(self) -> None:
        """Cancel action triggered by Escape."""
        self.dismiss(None)

    def _validate_date(self, date_str: str) -> bool:
        """Validate date string format."""
        if not date_str:
            return False
        try:
            pd.to_datetime(date_str, format="%Y-%m-%d")
            return True
        except (ValueError, TypeError):
            return False

    def _validate_amount(self, amount_str: str) -> bool:
        """Validate amount string is numeric."""
        if not amount_str:
            return False
        try:
            float(amount_str)
            return True
        except ValueError:
            return False

    def _save_transaction(self) -> None:
        """Validate and save the transaction."""
        date_str = self.query_one("#date_input", Input).value.strip()
        merchant = self.query_one("#merchant_input", Input).value.strip()
        amount_str = self.query_one("#amount_input", Input).value.strip()
        source = self.query_one("#source_input", Input).value.strip()
        type_select = self.query_one("#type_select", Select)
        transaction_type = type_select.value

        # Validate date
        if not self._validate_date(date_str):
            self.notify("Invalid date format. Use YYYY-MM-DD.", severity="error")
            return

        # Validate merchant
        if not merchant:
            self.notify("Merchant name is required.", severity="error")
            return

        # Validate amount
        if not self._validate_amount(amount_str):
            self.notify("Invalid amount. Enter a numeric value.", severity="error")
            return

        # Validate type
        if transaction_type not in ("expense", "income"):
            self.notify("Invalid type. Select expense or income.", severity="error")
            return

        # Build result dict
        result = {
            "original_index": self.original_index,
            "Date": date_str,
            "Merchant": merchant,
            "Amount": float(amount_str),
            "Source": source or "Unknown",
            "Type": transaction_type,
        }

        logging.info(f"Saving edited transaction: index={self.original_index}")
        self.dismiss(result)
