import pandas as pd
from typing import List, Dict, Any
from textual.widgets import Static, Button, DataTable, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
from textual.app import ComposeResult
from rich.style import Style
from rich.text import Text

from expenses.screens.base_screen import BaseScreen
from expenses.screens.data_table_operations_mixin import DataTableOperationsMixin
from expenses.data_handler import (
    load_transactions_from_parquet,
    load_categories,
    save_categories,
    load_default_categories,
)
from expenses.gemini_utils import get_gemini_category_suggestions_for_merchants
from expenses.widgets.clearable_input import ClearableInput
from textual.widgets import Input


class CategorizeScreen(BaseScreen, DataTableOperationsMixin):
    """A screen for categorizing merchants."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
    ]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.transactions: pd.DataFrame = pd.DataFrame()
        self.all_merchant_data: List[Dict[str, str]] = []
        self.merchant_data: List[Dict[str, str]] = []
        self.sort_column: str = "Merchant"
        self.sort_order: str = "asc"
        self.selected_rows: set[int] = set()
        saved_categories = load_categories()
        user_categories = list(saved_categories.values())
        default_categories = load_default_categories()
        self.categories: List[str] = sorted(
            list(set(user_categories + default_categories))
        )

    def compose_content(self) -> ComposeResult:
        """Create child widgets for the screen."""
        yield Vertical(
            Static("Categorize Merchants", classes="title"),
            Vertical(
                Horizontal(
                    ClearableInput(
                        placeholder="Filter merchants...", id="merchant_filter"
                    ),
                    ClearableInput(
                        placeholder="Filter categories...", id="category_filter"
                    ),
                    classes="filter-bar",
                ),
                Horizontal(
                    ClearableInput(
                        placeholder="Enter new category...", id="category_input"
                    ),
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
                    Button(
                        "Auto-Categorize Uncategorized", id="auto_categorize_button"
                    ),
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

        self.populate_table()

    def populate_table(self) -> None:
        """Apply filters and sorting to the merchant data."""
        merchant_filter = self.query_one(
            "#merchant_filter", ClearableInput
        ).value.lower()
        category_filter = self.query_one(
            "#category_filter", ClearableInput
        ).value.lower()

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
        self.update_table()

    def on_input_changed(self, event: Input.Changed) -> None:
        """Handle changes to the filter inputs."""
        if event.input.id in ("merchant_filter", "category_filter"):
            self.populate_table()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle Enter key press in inputs."""
        if event.input.id == "category_input":
            # Apply category to selected rows when Enter is pressed
            new_category = self.query_one(
                "#category_input", ClearableInput
            ).value.strip()
            if new_category and self.selected_rows:
                selected_merchants = {
                    self.merchant_data[i]["Merchant"] for i in self.selected_rows
                }

                for i in range(len(self.all_merchant_data)):
                    if self.all_merchant_data[i]["Merchant"] in selected_merchants:
                        self.all_merchant_data[i]["Category"] = new_category
                self.populate_table()
        elif event.input.id in ("merchant_filter", "category_filter"):
            # Refresh filter on Enter
            self.populate_table()

    def on_select_changed(self, event: Select.Changed) -> None:
        """Handle changes to the category select."""
        if event.select.id == "category_select":
            self.query_one("#category_input", ClearableInput).value = str(event.value)

    def update_table(self) -> None:
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

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "apply_button":
            new_category = self.query_one(
                "#category_input", ClearableInput
            ).value.strip()
            if new_category and self.selected_rows:
                selected_merchants = {
                    self.merchant_data[i]["Merchant"] for i in self.selected_rows
                }

                for i in range(len(self.all_merchant_data)):
                    if self.all_merchant_data[i]["Merchant"] in selected_merchants:
                        self.all_merchant_data[i]["Category"] = new_category
                self.populate_table()

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

        elif event.button.id == "auto_categorize_button":
            self.run_worker(self.auto_categorize_uncategorized(), exclusive=True)

    async def auto_categorize_uncategorized(self) -> None:
        """Auto-categorize all uncategorized merchants using Gemini AI."""
        import os

        # Check if API key is set
        if not os.getenv("GEMINI_API_KEY"):
            self.app.show_notification(
                "GEMINI_API_KEY not set. Please set it to use AI categorization.",
                timeout=5,
            )
            return

        # Find all uncategorized merchants
        uncategorized_merchants = [
            item["Merchant"]
            for item in self.all_merchant_data
            if item["Category"] == "Uncategorized"
        ]

        if not uncategorized_merchants:
            self.app.show_notification("No uncategorized merchants found!")
            return

        # Show progress notification
        self.app.show_notification(
            f"Categorizing {len(uncategorized_merchants)} merchants using AI...",
            timeout=None,
        )

        # Call Gemini API (this runs in a worker thread)
        suggested_categories = get_gemini_category_suggestions_for_merchants(
            uncategorized_merchants
        )

        if suggested_categories:
            # Update the merchant data with suggested categories
            for i in range(len(self.all_merchant_data)):
                merchant = self.all_merchant_data[i]["Merchant"]
                if merchant in suggested_categories:
                    self.all_merchant_data[i]["Category"] = suggested_categories[
                        merchant
                    ]

            # Refresh the table
            self.populate_table()

            # Save the categories
            categories_to_save = {
                item["Merchant"]: item["Category"]
                for item in self.all_merchant_data
                if item["Category"] != "Uncategorized"
            }
            save_categories(categories_to_save)

            self.app.show_notification(
                f"Successfully categorized {len(suggested_categories)} merchants!",
                timeout=3,
            )
        else:
            self.app.show_notification(
                "Failed to get AI suggestions. Check logs for details.", timeout=5
            )
