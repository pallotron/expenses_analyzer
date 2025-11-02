import pandas as pd
from textual.widgets import Static, Button, DataTable, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from textual.app import ComposeResult
from rich.style import Style
from rich.text import Text

from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import (
    load_transactions_from_parquet,
    load_categories,
    save_categories,
    load_default_categories,
)
from expenses.widgets.clearable_input import ClearableInput as Input


class CategorizeScreen(BaseScreen):
    """A screen for categorizing merchants."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
    ]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.transactions = pd.DataFrame()
        self.all_merchant_data: List[Dict[str, str]] = []
        self.merchant_data: List[Dict[str, str]] = []
        self.sort_column = "Merchant"
        self.sort_order = "asc"
        self.selected_rows = set()
        saved_categories = load_categories()
        user_categories = list(saved_categories.values())
        default_categories = load_default_categories()
        self.categories = sorted(list(set(user_categories + default_categories)))

    def compose_content(self) -> ComposeResult:
        """Create child widgets for the screen."""
        yield Vertical(
            Static("Categorize Merchants", classes="title"),
            Vertical(
                Horizontal(
                    Input(placeholder="Filter merchants...", id="merchant_filter"),
                    Input(placeholder="Filter categories...", id="category_filter"),
                    classes="filter-bar",
                ),
                Horizontal(
                    Input(placeholder="Enter new category...", id="category_input"),
                    Select(
                        prompt="or select existing",
                        options=[(c, c) for c in self.categories],
                        id="category_select",
                        allow_blank=True,
                    ),
                    classes="action-bar",
                ),
                Horizontal(
                    Button("Apply to Selected", id="apply_button"),
                    Button("Save Categories", id="save_categories_button"),
                    classes="action-bar",
                ),
                Static("Press SPACE to select/deselect rows.", classes="help-text"),
                id="controls_container",
            ),
            DataTable(id="categorization_table", cursor_type="row", zebra_stripes=True),
        )

    def on_mount(self) -> None:
        self.load_data_and_update_display()
        self.query_one("#categorization_table", DataTable).focus()

    def on_screen_resume(self, event) -> None:
        """Called when the screen is resumed, e.g., after an import."""
        self.load_data_and_update_display()

    def load_data_and_update_display(self) -> None:
        """Load data and update the merchant list and categorization view."""
        self.transactions = load_transactions_from_parquet()
        saved_categories = load_categories()

        if not self.transactions.empty:
            unique_merchants = self.transactions["Merchant"].dropna().unique().tolist()
            self.all_merchant_data = [
                {
                    "Merchant": merchant,
                    "Category": saved_categories.get(merchant, "Uncategorized"),
                }
                for merchant in unique_merchants
            ]
        else:
            self.all_merchant_data = []

        self.apply_filters_and_sort()

    def apply_filters_and_sort(self) -> None:
        """Apply filters and sorting to the merchant data."""
        merchant_filter = self.query_one("#merchant_filter", Input).value.lower()
        category_filter = self.query_one("#category_filter", Input).value.lower()

        filtered_data = self.all_merchant_data
        if merchant_filter:
            filtered_data = [
                item
                for item in filtered_data
                if merchant_filter in item["Merchant"].lower()
            ]
        if category_filter:
            filtered_data = [
                item
                for item in filtered_data
                if category_filter in item["Category"].lower()
            ]

        filtered_data.sort(
            key=lambda x: x[self.sort_column].lower(),
            reverse=(self.sort_order == "desc"),
        )
        self.merchant_data = filtered_data
        self.selected_rows.clear()
        self.update_categorization_table()

    def on_input_changed(self, event: Input.Changed) -> None:
        """Handle changes to the filter inputs."""
        if event.input.id in ("merchant_filter", "category_filter"):
            self.apply_filters_and_sort()

    def on_select_changed(self, event: Select.Changed) -> None:
        """Handle changes to the category select."""
        if event.select.id == "category_select":
            self.query_one("#category_input", Input).value = str(event.value)

    def update_categorization_table(self) -> None:
        table = self.query_one("#categorization_table", DataTable)
        # Preserve cursor position
        cursor_row = table.cursor_row
        table.clear(columns=True)
        table.add_columns("Merchant", "Category")

        if not self.merchant_data:
            table.add_row("No merchants to categorize.", "")
            return

        selected_style = Style(bgcolor="yellow", color="black")
        for i, item in enumerate(self.merchant_data):
            style = selected_style if i in self.selected_rows else ""

            styled_row = [
                Text(item["Merchant"], style=style),
                Text(item["Category"], style=style),
            ]
            table.add_row(*styled_row, key=str(i))

        if self.merchant_data:
            table.move_cursor(row=cursor_row)

    def action_toggle_selection(self) -> None:
        """Toggle selection for the current row."""
        table = self.query_one("#categorization_table", DataTable)
        if table.cursor_row is not None:
            if table.cursor_row in self.selected_rows:
                self.selected_rows.remove(table.cursor_row)
            else:
                self.selected_rows.add(table.cursor_row)
            self.update_categorization_table()

    def on_data_table_header_selected(self, event: DataTable.HeaderSelected) -> None:
        """Handle column header presses for sorting."""
        column_name = str(event.label)
        if column_name == self.sort_column:
            self.sort_order = "desc" if self.sort_order == "asc" else "asc"
        else:
            self.sort_column = column_name
            self.sort_order = "asc"
        self.apply_filters_and_sort()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "apply_button":
            new_category = self.query_one("#category_input", Input).value.strip()
            if new_category and self.selected_rows:
                selected_merchants = {
                    self.merchant_data[i]["Merchant"] for i in self.selected_rows
                }

                for i in range(len(self.all_merchant_data)):
                    if self.all_merchant_data[i]["Merchant"] in selected_merchants:
                        self.all_merchant_data[i]["Category"] = new_category
                self.apply_filters_and_sort()

        elif event.button.id == "save_categories_button":
            # Convert merchant_data back to the dictionary format for saving
            categories_to_save = {
                item["Merchant"]: item["Category"]
                for item in self.all_merchant_data
                if item["Category"] != "Uncategorized"
            }
            save_categories(categories_to_save)
            self.app.show_notification("Categories saved successfully!")
            self.app.pop_screen()
