import logging
from expenses.transaction_filter import apply_filters
import pandas as pd
from typing import Dict
from textual.widgets import DataTable, Static, Button
from expenses.widgets.clearable_input import ClearableInput
from textual.widgets import Input
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from rich.style import Style
from rich.text import Text

from expenses.data_handler import (
    load_transactions_from_parquet,
    load_categories,
    delete_transactions,
    load_merchant_aliases,
    save_merchant_aliases,
    apply_merchant_aliases_to_series,
    update_single_transaction,
    update_transactions,
)
from expenses.screens.base_screen import BaseScreen
from expenses.screens.data_table_operations_mixin import DataTableOperationsMixin
from textual.binding import Binding
from typing import Any

from datetime import datetime


class TransactionScreen(BaseScreen, DataTableOperationsMixin):
    """The main screen for displaying all transactions."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
        Binding("e", "edit_merchant", "Edit Merchant"),
        Binding("b", "bulk_edit", "Bulk Edit"),
    ]

    def __init__(
        self,
        category: str | None = None,
        year: int | None = None,
        month: int | None = None,
        merchant: str | None = None,
        transaction_type: str | None = None,
        source: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.filter_category: str | None = category
        self.filter_merchant: str | None = merchant
        self.filter_source: str | None = source
        # Only default to current year/month when opening screen directly (no year specified)
        # When drilling down from summary with year but no month, show full year
        if year is None:
            # Direct open - default to current month
            self.filter_year: int = datetime.now().year
            self.filter_month: int | None = datetime.now().month
        else:
            # Drill-down from summary - use provided values
            self.filter_year = year
            self.filter_month = month  # None means "all year"
        self.filter_type: str | None = transaction_type
        self.columns: list[str] = [
            "Date",
            "Merchant",
            "Amount",
            "Type",
            "Source",
            "Category",
        ]
        self.sort_column: str = "Date"
        self.sort_order: str = "desc"
        self.selected_rows: set[int] = set()
        self.display_df: pd.DataFrame = pd.DataFrame()
        self.transactions: pd.DataFrame = pd.DataFrame()
        self.categories: Dict[str, str] = {}
        self.merchant_aliases: Dict[str, str] = {}

    def compose_content(self) -> ComposeResult:
        title = "Transactions"
        if self.filter_category:
            month_name = f" in {self.filter_month}" if self.filter_month else ""
            year_name = f" for {self.filter_year}" if self.filter_year else ""
            title = f"Transactions for '{self.filter_category}'{month_name}{year_name}"
        elif self.filter_merchant:
            month_name = f" in {self.filter_month}" if self.filter_month else ""
            year_name = f" for {self.filter_year}" if self.filter_year else ""
            title = f"Transactions for merchant '{self.filter_merchant}'{month_name}{year_name}"

        yield Static(title, classes="title")
        yield Horizontal(
            ClearableInput(placeholder="Start Date (YYYY-MM-DD)", id="date_min_filter"),
            ClearableInput(placeholder="End Date (YYYY-MM-DD)", id="date_max_filter"),
            ClearableInput(
                placeholder="Filter by Merchant...",
                id="merchant_filter",
                value=self.filter_merchant or "",
            ),
            ClearableInput(placeholder="Min Amount...", id="amount_min_filter"),
            ClearableInput(placeholder="Max Amount...", id="amount_max_filter"),
            ClearableInput(
                placeholder="Filter by Source...",
                id="source_filter",
                value=self.filter_source or "",
            ),
            ClearableInput(
                placeholder="Filter by Category...",
                id="category_filter",
                value=self.filter_category or "",
            ),
            ClearableInput(
                placeholder="Type (income/expense)...",
                id="type_filter",
                value=self.filter_type or "",
            ),
            id="filters",
        )
        yield Horizontal(
            Static(id="total_display", classes="total"),
            Button("Select All", id="select_all_button"),
            Button("Delete Selected", id="delete_button", variant="error"),
            classes="button-bar",
        )
        # Split view: Transaction table on left, Merchant summary on right
        yield Horizontal(
            DataTable(id="transaction_table", cursor_type="row", zebra_stripes=True),
            Vertical(
                DataTable(
                    id="merchant_summary_table",
                    cursor_type="row",
                    zebra_stripes=True,
                ),
                classes="merchant-summary",
            ),
            classes="content-split",
        )

    def on_mount(self) -> None:
        """Load data and populate the table when the screen is mounted."""
        logging.info(
            f"TransactionScreen mounted with filters: year={self.filter_year}, "
            f"month={self.filter_month}, category='{self.filter_category}'"
        )

        # Pre-fill date filters if year and/or month are provided
        if self.filter_year:
            if self.filter_month:
                start_date = pd.Timestamp(f"{self.filter_year}-{self.filter_month}-01")
                end_date = start_date + pd.offsets.MonthEnd(1)
            else:  # Year-to-date view
                start_date = pd.Timestamp(f"{self.filter_year}-01-01")
                end_date = pd.Timestamp(f"{self.filter_year}-12-31")
            self.query_one("#date_min_filter", ClearableInput).value = (
                start_date.strftime("%Y-%m-%d")
            )
            self.query_one("#date_max_filter", ClearableInput).value = (
                end_date.strftime("%Y-%m-%d")
            )

        self.transactions = load_transactions_from_parquet()
        self.categories = load_categories()
        self.merchant_aliases = load_merchant_aliases()

        if not self.transactions.empty:
            self.transactions["Date"] = pd.to_datetime(self.transactions["Date"])

        logging.info(f"Loaded {len(self.transactions)} total transactions.")

        self.populate_table()
        self.query_one("#transaction_table", DataTable).focus()

    def on_screen_resume(self, event: Any) -> None:
        """Called when the screen is resumed, e.g., after an import."""
        self.transactions = load_transactions_from_parquet()
        self.categories = load_categories()
        self.merchant_aliases = load_merchant_aliases()

        if not self.transactions.empty:
            self.transactions["Date"] = pd.to_datetime(self.transactions["Date"])

        self.populate_table()

    def on_input_changed(self, event: Input.Changed) -> None:
        """Called when any input's value changes to re-filter the table."""
        self.populate_table()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle Enter key press in filter inputs."""
        # Refresh the table when Enter is pressed in any filter
        self.populate_table()

    def populate_table(self) -> None:
        """Populate the transaction table with data, applying filters."""
        table = self.query_one("#transaction_table", DataTable)
        total_display = self.query_one("#total_display", Static)
        table.clear(columns=True)

        if self.transactions.empty:
            table.add_columns(*self.columns)
            total_display.update("Total: 0.00")
            return

        # --- Prepare Data ---
        display_df = self.transactions.copy()

        # Apply merchant aliases for display
        display_df["DisplayMerchant"] = apply_merchant_aliases_to_series(
            display_df["Merchant"], self.merchant_aliases
        )

        display_df["Category"] = (
            display_df["Merchant"].map(self.categories).fillna("Other")
        )

        # --- Filtering ---
        type_filter_value = self.query_one("#type_filter", ClearableInput).value
        filters = {
            "date_min": (
                "Date",
                ">=",
                pd.to_datetime(
                    self.query_one("#date_min_filter", ClearableInput).value,
                    errors="coerce",
                ),
            ),
            "date_max": (
                "Date",
                "<=",
                pd.to_datetime(
                    self.query_one("#date_max_filter", ClearableInput).value,
                    errors="coerce",
                ),
            ),
            "merchant": (
                "DisplayMerchant",
                "contains",
                self.query_one("#merchant_filter", ClearableInput).value,
            ),
            "amount_min": (
                "Amount",
                ">=",
                pd.to_numeric(
                    self.query_one("#amount_min_filter", ClearableInput).value,
                    errors="coerce",
                ),
            ),
            "amount_max": (
                "Amount",
                "<=",
                pd.to_numeric(
                    self.query_one("#amount_max_filter", ClearableInput).value,
                    errors="coerce",
                ),
            ),
            "source": (
                "Source",
                "contains",
                self.query_one("#source_filter", ClearableInput).value,
            ),
            "category": (
                "Category",
                "contains",
                self.query_one("#category_filter", ClearableInput).value,
            ),
            "type": (
                "Type",
                "contains",
                type_filter_value,
            ),
        }
        display_df = self.transactions.copy()

        # Apply merchant aliases for display
        display_df["DisplayMerchant"] = apply_merchant_aliases_to_series(
            display_df["Merchant"], self.merchant_aliases
        )

        # Add Category column before filtering so category filters work
        display_df["Category"] = (
            display_df["Merchant"].map(self.categories).fillna("Other")
        )

        display_df = apply_filters(display_df, filters)

        # Ensure Type column exists (backward compatibility)
        if "Type" not in display_df.columns:
            display_df["Type"] = "expense"

        self.display_df = display_df

        # --- Calculate and Display Cash Flow Summary ---
        if "Type" in self.display_df.columns:
            income_total = self.display_df[self.display_df["Type"] == "income"][
                "Amount"
            ].sum()
            expense_total = self.display_df[self.display_df["Type"] == "expense"][
                "Amount"
            ].sum()
            net = income_total - expense_total
            net_color = "green" if net >= 0 else "red"
            total_display.update(
                f"[green]Income: {income_total:,.2f}[/green] | "
                f"[red]Expenses: {expense_total:,.2f}[/red] | "
                f"[{net_color}]Net: {net:,.2f}[/{net_color}]"
            )
        else:
            total_amount = self.display_df["Amount"].sum()
            total_display.update(f"Total: {total_amount:,.2f}")

        # --- Update Select All Button ---
        select_all_button = self.query_one("#select_all_button", Button)
        if (
            not self.display_df.empty
            and set(self.display_df.index) == self.selected_rows
        ):
            select_all_button.label = "Deselect All"
        else:
            select_all_button.label = "Select All"

        # --- Sorting ---
        if self.sort_column in self.display_df.columns:
            self.display_df = self.display_df.sort_values(
                by=self.sort_column, ascending=(self.sort_order == "asc")
            )

        # --- Add Columns with Correct Headers and Widths ---
        column_widths = {"Date": 12, "Amount": 15, "Source": 25, "Category": 20}
        for col_name in self.columns:
            icon = (
                " ▲"
                if self.sort_order == "asc" and col_name == self.sort_column
                else (
                    " ▼"
                    if self.sort_order == "desc" and col_name == self.sort_column
                    else ""
                )
            )
            table.add_column(
                f"{col_name}{icon}",
                key=col_name,
                width=column_widths.get(col_name),  # Merchant will have width=None
            )

        # --- Format and Add Rows ---
        selected_style = Style(bgcolor="yellow", color="black")
        income_style = Style(color="green")
        expense_style = Style(color="white")
        for i, row in self.display_df.iterrows():
            is_income = row.get("Type", "expense") == "income"
            if i in self.selected_rows:
                style = selected_style
            elif is_income:
                style = income_style
            else:
                style = expense_style

            row_type = row.get("Type", "expense")
            row_data = [
                row["Date"].strftime("%Y-%m-%d") if pd.notna(row["Date"]) else "",
                row["DisplayMerchant"] or row["Merchant"] or "",
                f"{row['Amount']:,.2f}" if pd.notna(row["Amount"]) else "",
                row_type.capitalize() if row_type else "Expense",
                row.get("Source", "Unknown") or "Unknown",
                row["Category"] or "",
            ]

            styled_row = [Text(str(cell), style=style) for cell in row_data]
            table.add_row(*styled_row, key=str(i))

        # Update merchant summary table
        self.populate_merchant_summary(self.display_df)

    def populate_merchant_summary(self, filtered_df: pd.DataFrame) -> None:
        """Populate the merchant summary table with grouped transaction data."""
        merchant_table = self.query_one("#merchant_summary_table", DataTable)
        merchant_table.clear(columns=True)

        if filtered_df.empty:
            merchant_table.add_columns("Merchant", "Total", "Count", "Type", "Category")
            return

        # Ensure Type column exists
        if "Type" not in filtered_df.columns:
            filtered_df = filtered_df.copy()
            filtered_df["Type"] = "expense"

        def get_type_summary(types):
            """Return type summary: Income, Expense, or Mixed."""
            unique_types = types.dropna().unique()
            if len(unique_types) == 0:
                return "Expense"
            elif len(unique_types) == 1:
                return unique_types[0].capitalize()
            else:
                return "Mixed"

        # Group by DisplayMerchant and aggregate
        merchant_summary = filtered_df.groupby("DisplayMerchant", as_index=False).agg(
            {
                "Amount": ["sum", "count"],
                "Type": get_type_summary,
                "Category": lambda x: x.mode()[0] if len(x.mode()) > 0 else "Other",
            }
        )

        # Flatten multi-level columns
        merchant_summary.columns = ["Merchant", "Total", "Count", "Type", "Category"]

        # Sort by total amount descending
        merchant_summary = merchant_summary.sort_values("Total", ascending=False)

        # Add columns with appropriate widths
        merchant_table.add_column("Merchant", width=None)  # Flexible width
        merchant_table.add_column("Total", width=15)
        merchant_table.add_column("Count", width=10)
        merchant_table.add_column("Type", width=10)
        merchant_table.add_column("Category", width=20)

        # Add rows
        for _, row in merchant_summary.iterrows():
            merchant_table.add_row(
                row["Merchant"] or "",
                f"{row['Total']:,.2f}",
                str(int(row["Count"])),
                row["Type"] or "Expense",
                row["Category"] or "",
            )

    def action_toggle_selection(self) -> None:
        """Toggle selection for the current row."""
        table = self.query_one("#transaction_table", DataTable)
        if table.cursor_row is None:
            return

        # Get the original index from the unfiltered DataFrame
        row_index = self.display_df.index[table.cursor_row]

        if row_index in self.selected_rows:
            self.selected_rows.remove(row_index)
        else:
            self.selected_rows.add(row_index)

        # After modification, we need to update the specific row in the table
        # to reflect the change (e.g., adding/removing a '*' prefix).
        # We can achieve this by re-populating the table and restoring the cursor
        # position.
        cursor_row = table.cursor_row
        self.populate_table()
        table.move_cursor(row=cursor_row)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "delete_button":
            self.delete_selected_transactions()
        elif event.button.id == "select_all_button":
            self.select_all_transactions()

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """Handle Enter key on a row - opens the edit dialog."""
        if event.data_table.id == "transaction_table":
            self.action_edit_transaction()

    def select_all_transactions(self) -> None:
        """Select or deselect all visible transactions."""
        if not self.display_df.empty:
            # If all are already selected, deselect all. Otherwise, select all.
            if set(self.display_df.index) == self.selected_rows:
                self.selected_rows.clear()
            else:
                self.selected_rows = set(self.display_df.index)
            self.populate_table()

    def delete_selected_transactions(self) -> None:
        """Delete the selected transactions after confirmation."""
        if not self.selected_rows:
            return

        transactions_to_delete = self.transactions.loc[list(self.selected_rows)]

        def check_delete(delete: bool) -> None:
            if delete:
                delete_transactions(transactions_to_delete)
                self.selected_rows.clear()
                self.on_screen_resume(None)  # Reload data

        count = len(transactions_to_delete)
        total = transactions_to_delete["Amount"].sum()
        self.app.push_confirmation(
            f"Are you sure you want to permanently delete {count} transactions totaling {total:,.2f}?",
            check_delete,
        )

    def update_table(self) -> None:
        """Update the table."""
        self.populate_table()

    def action_edit_merchant(self) -> None:
        """Edit merchant alias for the current row."""
        table = self.query_one("#transaction_table", DataTable)
        if table.cursor_row is None:
            return

        # Get the original index from the display DataFrame
        row_index = self.display_df.index[table.cursor_row]
        row = self.display_df.loc[row_index]

        original_merchant = row["Merchant"]

        # Find if there's already an alias for this merchant
        current_alias = row.get("DisplayMerchant")
        if current_alias == original_merchant:
            current_alias = None  # No alias currently

        # Import here to avoid circular import
        from expenses.screens.edit_transaction_screen import EditTransactionScreen

        def handle_edit_result(result):
            """Handle the result from the edit screen."""
            if not result:
                return  # User cancelled

            pattern, alias = result

            # Load current aliases
            aliases = load_merchant_aliases()

            # Add or update the pattern
            aliases[pattern] = alias

            # Save back to file
            save_merchant_aliases(aliases)

            # Reload and refresh the display
            self.merchant_aliases = load_merchant_aliases()
            self.populate_table()

            # Restore cursor position
            table.move_cursor(row=table.cursor_row)

            self.app.show_notification(
                f"Added alias: '{original_merchant}' → '{alias}'", timeout=3
            )
            logging.info(f"Added merchant alias: pattern='{pattern}', alias='{alias}'")

        self.app.push_screen(
            EditTransactionScreen(original_merchant, current_alias), handle_edit_result
        )

    def action_edit_transaction(self) -> None:
        """Edit the current transaction (Enter key)."""
        table = self.query_one("#transaction_table", DataTable)
        if table.cursor_row is None:
            return

        if self.display_df.empty:
            return

        # Get the original index from the display DataFrame
        row_index = self.display_df.index[table.cursor_row]
        row = self.transactions.loc[row_index]

        # Build transaction data dict
        transaction_data = {
            "Date": row["Date"],
            "Merchant": row["Merchant"],
            "Amount": row["Amount"],
            "Source": row.get("Source", "Unknown"),
            "Type": row.get("Type", "expense"),
        }

        # Import here to avoid circular import
        from expenses.screens.edit_single_transaction_screen import (
            EditSingleTransactionScreen,
        )

        def handle_edit_result(result):
            """Handle the result from the edit screen."""
            if not result:
                return  # User cancelled

            original_index = result.pop("original_index")

            try:
                success = update_single_transaction(original_index, **result)
                if success:
                    self.app.show_notification("Transaction updated", timeout=3)
                    # Reload data
                    self.on_screen_resume(None)
                    # Restore cursor position
                    table.move_cursor(row=table.cursor_row)
                else:
                    self.app.show_notification(
                        "Failed to update transaction", timeout=3
                    )
            except Exception as e:
                logging.error(f"Error updating transaction: {e}")
                self.app.show_notification(f"Error: {e}", timeout=5)

        self.app.push_screen(
            EditSingleTransactionScreen(transaction_data, row_index),
            handle_edit_result,
        )

    def action_bulk_edit(self) -> None:
        """Bulk edit selected transactions (b key)."""
        if not self.selected_rows:
            self.app.show_notification("No transactions selected", timeout=3)
            return

        # Import here to avoid circular import
        from expenses.screens.bulk_edit_transaction_screen import (
            BulkEditTransactionScreen,
        )

        # Get existing merchants (use DisplayMerchant which has aliases applied)
        existing_merchants = []
        if not self.display_df.empty and "DisplayMerchant" in self.display_df.columns:
            existing_merchants = (
                self.display_df["DisplayMerchant"].dropna().unique().tolist()
            )

        # Get existing sources
        existing_sources = []
        if not self.transactions.empty and "Source" in self.transactions.columns:
            existing_sources = self.transactions["Source"].dropna().unique().tolist()

        def handle_bulk_edit_result(result):
            """Handle the result from the bulk edit screen."""
            if not result:
                return  # User cancelled

            # Build updates list for all selected rows
            updates = []
            for row_index in self.selected_rows:
                update = {"original_index": row_index, **result}
                updates.append(update)

            try:
                count = update_transactions(updates)
                if count > 0:
                    self.app.show_notification(
                        f"Updated {count} transaction(s)", timeout=3
                    )
                    # Clear selection and reload
                    self.selected_rows.clear()
                    self.on_screen_resume(None)
                else:
                    self.app.show_notification(
                        "No transactions were updated", timeout=3
                    )
            except Exception as e:
                logging.error(f"Error bulk updating transactions: {e}")
                self.app.show_notification(f"Error: {e}", timeout=5)

        self.app.push_screen(
            BulkEditTransactionScreen(
                len(self.selected_rows),
                existing_merchants=existing_merchants,
                existing_sources=existing_sources,
            ),
            handle_bulk_edit_result,
        )
