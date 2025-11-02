import logging
import pandas as pd
from textual.widgets import DataTable, Static, Input, Button
from textual.app import ComposeResult
from textual.containers import Horizontal

from expenses.data_handler import load_transactions_from_parquet, load_categories, delete_transactions
from expenses.screens.base_screen import BaseScreen
from textual.binding import Binding


class TransactionScreen(BaseScreen):
    """The main screen for displaying all transactions."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
    ]

    def __init__(self, category: str = None, year: int = None, month: int = None, **kwargs):
        super().__init__(**kwargs)
        self.filter_category = category
        self.filter_year = year
        self.filter_month = month
        self.columns = ["Date", "Merchant", "Amount", "Category"]
        self.sort_column = "Date"
        self.sort_order = "desc"
        self.selected_rows = set()
        self.display_df = pd.DataFrame()

    def compose_content(self) -> ComposeResult:
        title = "Transactions"
        if self.filter_category:
            month_name = f" in {self.filter_month}" if self.filter_month else ""
            year_name = f" for {self.filter_year}" if self.filter_year else ""
            title = f"Transactions for '{self.filter_category}'{month_name}{year_name}"

        yield Static(title, classes="title")
        yield Horizontal(
            Input(placeholder="Start Date (YYYY-MM-DD)", id="date_min_filter"),
            Input(placeholder="End Date (YYYY-MM-DD)", id="date_max_filter"),
            Input(placeholder="Filter by Merchant...", id="merchant_filter"),
            Input(placeholder="Min Amount...", id="amount_min_filter"),
            Input(placeholder="Max Amount...", id="amount_max_filter"),
            Input(placeholder="Filter by Category...", id="category_filter",
                  value=self.filter_category or ""),
            id="filters",
        )
        yield Horizontal(
            Static(id="total_display", classes="total"),
            Button("Delete Selected", id="delete_button", variant="error"),
            classes="button-bar"
        )
        yield DataTable(id="transaction_table", zebra_stripes=True)

    def on_mount(self) -> None:
        """Load data and populate the table when the screen is mounted."""
        logging.info(f"TransactionScreen mounted with filters: year={self.filter_year}, "
                     f"month={self.filter_month}, category='{self.filter_category}'")
        self.transactions = load_transactions_from_parquet()
        self.categories = load_categories()

        if not self.transactions.empty:
            self.transactions['Date'] = pd.to_datetime(self.transactions['Date'])

        logging.info(f"Loaded {len(self.transactions)} total transactions.")

        # Apply initial filters from constructor
        if self.filter_year:
            self.transactions = self.transactions[self.transactions['Date'].dt.year == self.filter_year]
        if self.filter_month:
            self.transactions = self.transactions[self.transactions['Date'].dt.month == self.filter_month]

        self.populate_table()

    def on_screen_resume(self, event) -> None:
        """Called when the screen is resumed, e.g., after an import."""
        self.transactions = load_transactions_from_parquet()
        self.categories = load_categories()

        if not self.transactions.empty:
            self.transactions['Date'] = pd.to_datetime(self.transactions['Date'])

        # Re-apply initial filters
        if self.filter_year:
            self.transactions = self.transactions[self.transactions['Date'].dt.year == self.filter_year]
        if self.filter_month:
            self.transactions = self.transactions[self.transactions['Date'].dt.month == self.filter_month]

        self.populate_table()

    def on_input_changed(self, event: Input.Changed) -> None:
        """Called when any input's value changes to re-filter the table."""
        self.populate_table()

    def _apply_filters_to_transactions(self, df: pd.DataFrame) -> pd.DataFrame:
        """Applies all filters from the input widgets to the transactions DataFrame."""
        filtered_df = df.copy()

        filter_configs = [
            ("#date_min_filter", "Date", ">=", pd.to_datetime),
            ("#date_max_filter", "Date", "<=", pd.to_datetime),
            ("#merchant_filter", "Merchant", "contains", str),
            ("#amount_min_filter", "Amount", ">=", float),
            ("#amount_max_filter", "Amount", "<=", float),
        ]

        for css_id, column, op, converter in filter_configs:
            value = self.query_one(css_id, Input).value
            if not value:
                continue

            try:
                converted_value = converter(value)
                if op == ">=":
                    filtered_df = filtered_df[filtered_df[column] >= converted_value]
                elif op == "<=":
                    filtered_df = filtered_df[filtered_df[column] <= converted_value]
                elif op == "contains":
                    filtered_df = filtered_df[
                        filtered_df[column].str.contains(
                            converted_value, case=False, na=False
                        )
                    ]
            except (ValueError, TypeError):
                pass

        category_filter = self.query_one("#category_filter", Input).value
        if category_filter:
            # If the filter is the one passed from the summary, do an exact match
            if category_filter == self.filter_category:
                filtered_df = filtered_df[filtered_df["Category"] == category_filter]
            # Otherwise, do a substring search for manual typing
            else:
                filtered_df = filtered_df[
                    filtered_df["Category"].str.contains(
                        category_filter, case=False, na=False
                    )
                ]
        return filtered_df

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
        display_df["Category"] = (
            display_df["Merchant"].map(self.categories).fillna("Other")
        )

        # --- Filtering ---
        display_df = self._apply_filters_to_transactions(display_df)

        self.display_df = display_df

        # --- Calculate and Display Total ---
        total_amount = self.display_df['Amount'].sum()
        total_display.update(f"Total: {total_amount:,.2f}")

        # --- Sorting ---
        if self.sort_column in self.display_df.columns:
            self.display_df = self.display_df.sort_values(
                by=self.sort_column, ascending=(self.sort_order == "asc")
            )

        # --- Add Columns with Correct Headers and Widths ---
        column_widths = {"Date": 12, "Amount": 15, "Category": 20}
        for col_name in self.columns:
            icon = (" ▲" if self.sort_order == "asc" and col_name == self.sort_column
                    else " ▼" if self.sort_order == "desc" and col_name == self.sort_column else "")
            table.add_column(
                f"{col_name}{icon}",
                key=col_name,
                width=column_widths.get(col_name)  # Merchant will have width=None
            )

        # --- Format and Add Rows ---
        rows = []
        for i, row in self.display_df.iterrows():
            prefix = "* " if i in self.selected_rows else ""
            rows.append([
                row["Date"].strftime("%Y-%m-%d") if pd.notna(row["Date"]) else "",
                f"{prefix}{row['Merchant'] or ''}",
                f"{row['Amount']:,.2f}" if pd.notna(row['Amount']) else "",
                row["Category"] or ""
            ])
        table.add_rows(rows)

    def action_toggle_selection(self) -> None:
        """Toggle selection for the current row."""
        table = self.query_one("#transaction_table", DataTable)
        if table.cursor_row is not None:
            row_index = self.display_df.index[table.cursor_row]
            if row_index in self.selected_rows:
                self.selected_rows.remove(row_index)
            else:
                self.selected_rows.add(row_index)
            self.populate_table()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "delete_button":
            self.delete_selected_transactions()

    def delete_selected_transactions(self):
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

    def on_data_table_header_selected(self, event: DataTable.HeaderSelected) -> None:
        """Handle header clicks to change sorting."""
        column_name = self.columns[event.column_index]

        if column_name == self.sort_column:
            self.sort_order = "asc" if self.sort_order == "desc" else "desc"
        else:
            self.sort_column = column_name
            self.sort_order = "asc"

        self.populate_table()
