from textual.app import ComposeResult
from textual.widgets import (
    Static,
    Button,
    Input,
    DataTable,
    RadioSet,
    RadioButton,
)
from textual.containers import Vertical, Horizontal

from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import (
    load_transactions_from_parquet,
    delete_transactions,
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
        yield Horizontal(
            Input(placeholder="Start Date (YYYY-MM-DD)", id="date_min_filter"),
            Input(placeholder="End Date (YYYY-MM-DD)", id="date_max_filter"),
            classes="filter-bar"
        )
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
        yield DataTable(id="preview_table", zebra_stripes=True)

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
        """Preview transactions that match the pattern within the given time frame."""
        pattern = self.query_one("#pattern_input", Input).value
        pattern_type = "regex" if self.query_one("#regex_button", RadioButton).value else "glob"
        date_min_str = self.query_one("#date_min_filter", Input).value
        date_max_str = self.query_one("#date_max_filter", Input).value

        filtered_transactions = self.transactions.copy()

        # Apply date filters first
        if date_min_str:
            try:
                date_min = pd.to_datetime(date_min_str)
                filtered_transactions = filtered_transactions[filtered_transactions["Date"] >= date_min]
            except ValueError:
                pass  # Ignore invalid date values
        if date_max_str:
            try:
                date_max = pd.to_datetime(date_max_str)
                filtered_transactions = filtered_transactions[filtered_transactions["Date"] <= date_max]
            except ValueError:
                pass  # Ignore invalid date values

        # Apply merchant pattern filter
        if pattern:
            if pattern_type == "glob":
                pattern = re.escape(pattern).replace("\\*", ".*")
            
            try:
                matching_transactions = filtered_transactions[
                    filtered_transactions["Merchant"].str.contains(pattern, case=False, na=False)
                ]
            except re.error as e:
                self.query_one("#preview_summary").update(f"Invalid regex: {e}")
                self.query_one("#delete_button", Button).disabled = True
                return
        else:
            matching_transactions = filtered_transactions

        self.preview_df = matching_transactions
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
            self.query_one("#preview_summary").update("No transactions match the pattern or time frame.")
            self.query_one("#delete_button", Button).disabled = True

    def delete_transactions(self):
        """Delete the previewed transactions after confirmation."""
        if self.preview_df.empty:
            return

        def check_delete(delete: bool) -> None:
            if delete:
                delete_transactions(self.preview_df)
                self.transactions = load_transactions_from_parquet()
                self.query_one("#preview_table", DataTable).clear()
                self.query_one("#preview_summary").update("Transactions deleted.")
                self.query_one("#delete_button", Button).disabled = True
                self.app.push_screen("summary") # Refresh summary view

        count = len(self.preview_df)
        total = self.preview_df["Amount"].sum()
        self.app.push_confirmation(
            f"Are you sure you want to permanently delete {count} transactions totaling {total:,.2f}?",
            check_delete,
        )

    def on_input_changed(self, event: Input.Changed) -> None:
        """Disable delete button when input changes."""
        self.query_one("#delete_button", Button).disabled = True
