import logging
from textual.app import ComposeResult
from textual.widgets import Static, DataTable, Input, Button
from textual.containers import Horizontal
from textual.binding import Binding
from typing import Any

from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import (
    load_category_types,
    save_category_types,
    load_categories,
    load_default_categories,
)


class BudgetTypesScreen(BaseScreen):
    """Screen for managing essential/discretionary category classifications
    and annual budgets."""

    BINDINGS = [
        Binding("space", "toggle_type", "Toggle Type"),
        Binding("enter", "toggle_type", "Toggle Type"),
        Binding("ctrl+e", "set_essential_budget", "Set Essential Budget"),
        Binding("ctrl+d", "set_discretionary_budget", "Set Discr. Budget"),
    ]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.category_types = load_category_types()
        self._build_category_list()

    def _build_category_list(self) -> None:
        """Build the full list of expense categories from categories.json
        values and default_categories.json. Excludes income categories."""
        categories_map = load_categories()
        default_expense_cats = load_default_categories(
            transaction_type="expense"
        )
        default_income_cats = set(
            load_default_categories(transaction_type="income")
        )

        # Collect unique category names from expense defaults
        all_cats = set(default_expense_cats)
        # Add categories assigned to merchants, excluding known income cats
        all_cats.update(
            c for c in categories_map.values() if c not in default_income_cats
        )

        # Also include any categories already in category_types
        for group in ("essential", "discretionary"):
            group_data = self.category_types.get(group, {})
            all_cats.update(group_data.get("categories", []))

        self._all_categories = sorted(all_cats)

    def _get_type_for_category(self, category: str) -> str:
        essential_cats = self.category_types.get(
            "essential", {}
        ).get("categories", [])
        if category in essential_cats:
            return "Essential"
        return "Discretionary"

    def compose_content(self) -> ComposeResult:
        yield Static("Budget Types — Essential vs Discretionary", classes="title")

        essential_budget = self.category_types.get(
            "essential", {}
        ).get("annual_budget")
        discretionary_budget = self.category_types.get(
            "discretionary", {}
        ).get("annual_budget")

        ess_label = (
            f"{essential_budget:,.0f}" if essential_budget is not None else "None"
        )
        disc_label = (
            f"{discretionary_budget:,.0f}"
            if discretionary_budget is not None
            else "None"
        )

        yield Static(
            f"Essential Budget: [bold]{ess_label}[/bold]  |  "
            f"Discretionary Budget: [bold]{disc_label}[/bold]",
            id="budget_summary",
            classes="help-text",
        )

        yield Horizontal(
            Input(
                placeholder="Essential annual budget",
                id="essential_budget_input",
            ),
            Button("Set Essential", id="btn_set_essential"),
            Input(
                placeholder="Discretionary annual budget",
                id="discretionary_budget_input",
            ),
            Button("Set Discretionary", id="btn_set_discretionary"),
            classes="action-bar",
        )

        yield DataTable(
            id="category_types_table",
            cursor_type="row",
            zebra_stripes=True,
        )

        yield Static(
            "Space/Enter: toggle type  |  Changes auto-save",
            classes="help-text",
        )

    def on_mount(self) -> None:
        self._populate_table()

    def _populate_table(self) -> None:
        table = self.query_one("#category_types_table", DataTable)
        cursor_row = table.cursor_row
        table.clear(columns=True)
        table.add_columns("Category", "Type")

        for cat in self._all_categories:
            ctype = self._get_type_for_category(cat)
            table.add_row(cat, ctype, key=cat)

        if cursor_row is not None:
            table.move_cursor(row=cursor_row)

    def action_toggle_type(self) -> None:
        """Toggle the selected category between Essential and Discretionary."""
        table = self.query_one("#category_types_table", DataTable)
        if table.cursor_row is None:
            return

        row_key = table.get_cell_at((table.cursor_row, 0))
        category = str(row_key)

        essential_cats = self.category_types.get(
            "essential", {}
        ).get("categories", [])
        discretionary_cats = self.category_types.get(
            "discretionary", {}
        ).get("categories", [])

        if category in essential_cats:
            essential_cats.remove(category)
            discretionary_cats.append(category)
        else:
            if category in discretionary_cats:
                discretionary_cats.remove(category)
            essential_cats.append(category)

        self.category_types["essential"]["categories"] = essential_cats
        self.category_types["discretionary"]["categories"] = discretionary_cats
        save_category_types(self.category_types)
        self._populate_table()

    def _set_budget(self, budget_type: str, input_id: str) -> None:
        """Set annual budget from input field."""
        try:
            inp = self.query_one(f"#{input_id}", Input)
            value_str = inp.value.strip()
            if not value_str or value_str.lower() == "none":
                self.category_types[budget_type]["annual_budget"] = None
            else:
                value_str = value_str.replace(",", "")
                self.category_types[budget_type]["annual_budget"] = float(
                    value_str
                )
            inp.value = ""
            save_category_types(self.category_types)
            self._update_budget_summary()
            self.app.show_notification("Budget saved")
        except (ValueError, KeyError) as e:
            logging.warning(f"Invalid budget value: {e}")
            self.app.show_notification("Invalid budget value")

    def _update_budget_summary(self) -> None:
        essential_budget = self.category_types.get(
            "essential", {}
        ).get("annual_budget")
        discretionary_budget = self.category_types.get(
            "discretionary", {}
        ).get("annual_budget")

        ess_label = (
            f"{essential_budget:,.0f}" if essential_budget is not None else "None"
        )
        disc_label = (
            f"{discretionary_budget:,.0f}"
            if discretionary_budget is not None
            else "None"
        )

        summary = self.query_one("#budget_summary", Static)
        summary.update(
            f"Essential Budget: [bold]{ess_label}[/bold]  |  "
            f"Discretionary Budget: [bold]{disc_label}[/bold]"
        )

    def action_set_essential_budget(self) -> None:
        self._set_budget("essential", "essential_budget_input")

    def action_set_discretionary_budget(self) -> None:
        self._set_budget("discretionary", "discretionary_budget_input")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn_set_essential":
            self._set_budget("essential", "essential_budget_input")
        elif event.button.id == "btn_set_discretionary":
            self._set_budget("discretionary", "discretionary_budget_input")
