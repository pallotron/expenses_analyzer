from textual.app import ComposeResult
from textual.widgets import (
    Static,
    Button,
    Input,
    DataTable,
    RadioSet,
    RadioButton,
)
from textual.containers import Horizontal

from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import (
    load_transactions_from_parquet,
    delete_transactions_by_merchant,
)
import pandas as pd
import re


class DeleteScreen(BaseScreen):
    """A screen to delete transactions based on a merchant pattern."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.transactions = load_transactions_from_parquet()
        self.preview_df = pd.DataFrame()

    def compose_content(self) -> ComposeResult:
        yield Static("Delete Transactions", classes="title")
        yield Input(placeholder="Enter merchant pattern (regex or glob)", id="pattern_input")
        with RadioSet(id="pattern_type"):
            yield RadioButton("Regex", value="regex", id="regex_button")
            yield RadioButton("Glob", value="glob", id="glob_button")
        yield Horizontal(
            Button("Preview Deletions", id="preview_button", variant="primary"),
            Button("Delete Transactions", id="delete_button", variant="error", disabled=True),
            classes="button-bar",
        )
        yield Static("", id="preview_summary")
        yield DataTable(id="preview_table")

    def on_mount(self) -> None:
        """Set initial state."""
        self.query_one("#regex_button").value = True

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "preview_button":
            self.preview_deletions()
        elif event.button.id == "delete_button":
            self.delete_transactions()

    def preview_deletions(self):
        """Preview transactions that match the pattern."""
        pattern = self.query_one("#pattern_input", Input).value
        pattern_type = "regex" if self.query_one("#regex_button", RadioButton).value else "glob"

        if not pattern:
            self.query_one("#preview_summary").update("Please enter a pattern.")
            return

        if pattern_type == "glob":
            pattern = re.escape(pattern).replace("*", ".*")

        try:
            matching_merchants = self.transactions[
                self.transactions["Merchant"].str.contains(pattern, case=False, na=False)
            ]
            self.preview_df = matching_merchants
            table = self.query_one("#preview_table", DataTable)
            table.clear(columns=True)
            table.add_columns("Date", "Merchant", "Amount")

            if not self.preview_df.empty:
                for _, row in self.preview_df.iterrows():
                    table.add_row(
                        row["Date"].strftime("%Y-%m-%d"),
                        row["Merchant"],
                        f"{row['Amount']:,.2f}",
                    )
                total_amount = self.preview_df["Amount"].sum()
                count = len(self.preview_df)
                self.query_one("#preview_summary").update(
                    f"Found {count} transactions totaling {total_amount:,.2f} to be deleted."
                )
                self.query_one("#delete_button", Button).disabled = False
            else:
                self.query_one("#preview_summary").update("No transactions match the pattern.")
                self.query_one("#delete_button", Button).disabled = True

        except re.error as e:
            self.query_one("#preview_summary").update(f"Invalid regex: {e}")
            self.query_one("#delete_button", Button).disabled = True

    def delete_transactions(self):
        """Delete the previewed transactions after confirmation."""
        if self.preview_df.empty:
            return

        def check_delete(delete: bool) -> None:
            if delete:
                delete_transactions_by_merchant(self.preview_df)
                self.transactions = load_transactions_from_parquet()
                self.query_one("#preview_table", DataTable).clear()
                self.query_one("#preview_summary").update("Transactions deleted.")
                self.query_one("#delete_button", Button).disabled = True
                self.app.push_screen("summary")  # Refresh summary view

        count = len(self.preview_df)
        total = self.preview_df["Amount"].sum()
        self.app.push_confirmation(
            f"Are you sure you want to permanently delete {count} transactions totaling {total:,.2f}?",
            check_delete,
        )

    def on_input_changed(self, event: Input.Changed) -> None:
        """Disable delete button when input changes."""
        self.query_one("#delete_button", Button).disabled = True
