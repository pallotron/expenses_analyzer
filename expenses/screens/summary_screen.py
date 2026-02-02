import logging
from textual.app import ComposeResult
from textual.widgets import Static, TabbedContent, TabPane, DataTable, Input, Checkbox, Button
from textual.containers import Horizontal, Vertical
import pandas as pd
from datetime import datetime

from textual.binding import Binding
from rich.style import Style
from rich.text import Text

from expenses.screens.base_screen import BaseScreen
from expenses.screens.data_table_operations_mixin import DataTableOperationsMixin
from expenses.data_handler import (
    load_transactions_from_parquet,
    load_categories,
    load_merchant_aliases,
    apply_merchant_aliases_to_series,
)
from expenses.analysis import calculate_trends, get_cash_flow_totals
from typing import Dict, Set, Optional, Any


class SummaryScreen(BaseScreen, DataTableOperationsMixin):
    """A summary screen with transactions per year and month."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
        Binding("enter", "drill_down", "Drill Down"),
        Binding("ctrl+m", "toggle_compact", "Compact Mode"),
        Binding("f", "toggle_focus", "Focus Mode"),
    ]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.source_filter: Set[str] = set()  # Empty set means all sources
        self.load_and_prepare_data()
        self.selected_rows: Set[str] = set()
        self.compact_mode: bool = False
        self.focus_mode: bool = False

    def action_toggle_compact(self) -> None:
        """Toggle compact mode for All Year tabs."""
        self.compact_mode = not self.compact_mode
        for container in self.query(".all-year-container"):
            if self.compact_mode:
                container.add_class("compact")
            else:
                container.remove_class("compact")

    def action_toggle_focus(self) -> None:
        """Toggle focus mode to maximize the focused panel."""
        if self.focus_mode:
            # Restore all panels
            for panel in self.query(".panel-hidden"):
                panel.remove_class("panel-hidden")
            for panel in self.query(".panel-focused"):
                panel.remove_class("panel-focused")
            self.focus_mode = False
            return

        # Find which panel contains the focused widget
        focused = self.app.focused
        if focused is None:
            return

        # Find the parent panel (expense-breakdown, income-breakdown, or monthly-breakdown)
        panel_classes = [
            "expense-breakdown",
            "income-breakdown",
            "monthly-breakdown",
            "expense-column",
            "income-column",
        ]
        focused_panel = None
        for ancestor in focused.ancestors:
            for cls in panel_classes:
                if ancestor.has_class(cls):
                    focused_panel = ancestor
                    break
            if focused_panel:
                break

        if focused_panel is None:
            return

        # Get the parent grid (summary-grid or month-grid)
        parent_grid = None
        for ancestor in focused_panel.ancestors:
            if ancestor.has_class("summary-grid") or ancestor.has_class("month-grid"):
                parent_grid = ancestor
                break

        if parent_grid is None:
            return

        # Hide other panels, focus the current one
        for child in parent_grid.children:
            if child == focused_panel:
                child.add_class("panel-focused")
            else:
                child.add_class("panel-hidden")

        self.focus_mode = True

    def load_and_prepare_data(self) -> None:
        """Loads and prepares transaction and category data."""
        self._all_transactions: pd.DataFrame = load_transactions_from_parquet()
        self.categories: Dict[str, str] = load_categories()
        self.merchant_aliases: Dict[str, str] = load_merchant_aliases()
        logging.info(f"Loaded {len(self.merchant_aliases)} merchant alias patterns")
        if not self._all_transactions.empty:
            self._all_transactions["Date"] = pd.to_datetime(self._all_transactions["Date"])
            # Apply merchant aliases for display
            self._all_transactions["DisplayMerchant"] = apply_merchant_aliases_to_series(
                self._all_transactions["Merchant"], self.merchant_aliases
            )
            # Log some examples
            if len(self.merchant_aliases) > 0:
                sample_size = min(5, len(self._all_transactions))
                logging.debug("Sample after applying aliases:")
                for idx, row in self._all_transactions.head(sample_size).iterrows():
                    logging.debug(
                        f"  '{row['Merchant']}' -> '{row['DisplayMerchant']}'"
                    )
            self._all_transactions["Category"] = (
                self._all_transactions["Merchant"].map(self.categories).fillna("Other")
            )

    @property
    def transactions(self) -> pd.DataFrame:
        """Returns transactions filtered by source if a filter is set."""
        if not hasattr(self, '_all_transactions') or self._all_transactions.empty:
            return pd.DataFrame()
        if self.source_filter:
            # Filter by selected sources
            return self._all_transactions[
                self._all_transactions["Source"].isin(self.source_filter)
            ].copy()
        return self._all_transactions

    def on_checkbox_changed(self, event: Checkbox.Changed) -> None:
        """Handle source filter checkbox change."""
        checkbox_id = event.checkbox.id
        if checkbox_id and checkbox_id.startswith("source_"):
            # Look up the actual source name from the ID map
            source_name = self._source_id_map.get(checkbox_id)
            if source_name:
                if event.value:
                    self.source_filter.add(source_name)
                else:
                    self.source_filter.discard(source_name)
                logging.info(f"Source filter changed to: {self.source_filter}")
                self._refresh_current_view()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "select_all_sources":
            self._set_all_source_checkboxes(True)
        elif event.button.id == "select_none_sources":
            self._set_all_source_checkboxes(False)

    def _set_all_source_checkboxes(self, value: bool) -> None:
        """Set all source checkboxes to the given value."""
        for checkbox_id, source_name in self._source_id_map.items():
            try:
                checkbox = self.query_one(f"#{checkbox_id}", Checkbox)
                checkbox.value = value
            except Exception:
                pass
        # Update the filter set
        if value:
            self.source_filter = set(self._source_id_map.values())
        else:
            self.source_filter = set()
        self._refresh_current_view()

    def _get_single_source_filter(self) -> Optional[str]:
        """Get source filter for TransactionScreen (only if single source selected)."""
        if len(self.source_filter) == 1:
            return next(iter(self.source_filter))
        return None

    def _refresh_current_view(self) -> None:
        """Refresh the current view based on active tabs."""
        if not hasattr(self, '_all_transactions') or self._all_transactions.empty:
            return

        try:
            year_tabs = self.query_one("#year_tabs", TabbedContent)
            active_year_id = year_tabs.active
            if not active_year_id:
                return

            year = int(active_year_id.split("_")[1])
            month_tabs = self.query_one(f"#month_tabs_{year}", TabbedContent)
            active_month_id = month_tabs.active

            if active_month_id and active_month_id.endswith("_all"):
                self.update_cash_flow(year)
                self.update_all_year_category_view(year)
                self.update_all_year_monthly_view(year)
                self.update_top_merchants_view(year)
                self.update_all_year_income_view(year)
                self.update_top_income_view(year)
            elif active_month_id:
                month = int(active_month_id.split("_")[2])
                self.update_cash_flow(year, month)
                self.update_month_view(year, month)
                self.update_top_merchants_view(year, month)
                self.update_month_income_view(year, month)
                self.update_top_income_view(year, month)
        except Exception as e:
            logging.warning(f"Error refreshing view after source filter change: {e}")

    def compose_content(self) -> ComposeResult:
        yield Static("Cash Flow Summary", classes="title")

        if self.transactions.empty:
            yield Static("No transactions found.")
            return

        # Get unique sources for the filter
        sources = sorted(self._all_transactions["Source"].dropna().unique().tolist())
        # Initialize source_filter with all sources selected
        self.source_filter = set(sources)
        # Store mapping from sanitized ID to source name
        self._source_id_map: Dict[str, str] = {}

        def sanitize_id(s: str) -> str:
            """Convert source name to valid widget ID."""
            return s.replace(" ", "_").replace("-", "_")

        source_checkboxes = []
        for s in sources:
            safe_id = f"source_{sanitize_id(s)}"
            self._source_id_map[safe_id] = s
            source_checkboxes.append(Checkbox(s, value=True, id=safe_id))

        yield Horizontal(
            Static("Sources: ", classes="filter-label"),
            Button("All", id="select_all_sources", variant="default"),
            Button("None", id="select_none_sources", variant="default"),
            *source_checkboxes,
            classes="source-filter-bar",
        )

        years = sorted(self.transactions["Date"].dt.year.unique(), reverse=True)

        with TabbedContent(id="year_tabs"):
            for year in years:
                with TabPane(str(year), id=f"year_{year}"):
                    months_in_year = sorted(
                        self.transactions[self.transactions["Date"].dt.year == year][
                            "Date"
                        ].dt.month.unique()
                    )

                    with TabbedContent(
                        id=f"month_tabs_{year}", initial=f"month_{year}_all"
                    ):
                        # Add "All Year" tab first
                        with TabPane("All Year", id=f"month_{year}_all"):
                            yield Vertical(
                                Static(
                                    id=f"cash_flow_{year}_all",
                                    classes="cash-flow-summary",
                                ),
                                Horizontal(
                                    Vertical(
                                        Static(
                                            "Expense Categories", classes="table_title"
                                        ),
                                        DataTable(
                                            id=f"category_breakdown_{year}_all",
                                            cursor_type="row",
                                            zebra_stripes=True,
                                        ),
                                        Static(
                                            "Top Expense Merchants",
                                            classes="table_title",
                                        ),
                                        DataTable(
                                            id=f"top_merchants_{year}_all",
                                            cursor_type="row",
                                            zebra_stripes=True,
                                        ),
                                        classes="category-breakdown expense-breakdown",
                                    ),
                                    Vertical(
                                        Static(
                                            "Income Categories",
                                            classes="table_title",
                                            id=f"income_title_{year}_all",
                                        ),
                                        DataTable(
                                            id=f"income_breakdown_{year}_all",
                                            cursor_type="row",
                                            zebra_stripes=True,
                                        ),
                                        Static(
                                            "Top Income Sources", classes="table_title"
                                        ),
                                        DataTable(
                                            id=f"top_income_{year}_all",
                                            cursor_type="row",
                                            zebra_stripes=True,
                                        ),
                                        classes="category-breakdown income-breakdown",
                                    ),
                                    Vertical(
                                        Static(
                                            "Monthly Expense Breakdown",
                                            classes="table_title",
                                        ),
                                        DataTable(
                                            id=f"monthly_breakdown_{year}_all",
                                            zebra_stripes=True,
                                        ),
                                        Static(
                                            "Monthly Income Breakdown",
                                            classes="table_title",
                                        ),
                                        DataTable(
                                            id=f"monthly_income_breakdown_{year}_all",
                                            zebra_stripes=True,
                                        ),
                                        classes="monthly-breakdown",
                                    ),
                                    classes="summary-grid",
                                ),
                                id=f"all_year_container_{year}",
                                classes="all-year-container",
                            )

                        # Add individual month tabs
                        for month in months_in_year:
                            month_name = datetime(2000, month, 1).strftime("%B")
                            with TabPane(month_name, id=f"month_{year}_{month}"):
                                yield Vertical(
                                    Static(
                                        id=f"cash_flow_{year}_{month}",
                                        classes="cash-flow-summary",
                                    ),
                                    Horizontal(
                                        Vertical(
                                            Static(
                                                "Expense Categories",
                                                classes="table_title",
                                            ),
                                            DataTable(
                                                id=f"category_breakdown_{year}_{month}",
                                                zebra_stripes=True,
                                            ),
                                            Static(
                                                "Top Expense Merchants",
                                                classes="table_title",
                                            ),
                                            DataTable(
                                                id=f"top_merchants_{year}_{month}",
                                                cursor_type="row",
                                                zebra_stripes=True,
                                            ),
                                            classes="expense-column",
                                        ),
                                        Vertical(
                                            Static(
                                                "Income Categories",
                                                classes="table_title",
                                                id=f"income_title_{year}_{month}",
                                            ),
                                            DataTable(
                                                id=f"income_breakdown_{year}_{month}",
                                                zebra_stripes=True,
                                            ),
                                            Static(
                                                "Top Income Sources",
                                                classes="table_title",
                                            ),
                                            DataTable(
                                                id=f"top_income_{year}_{month}",
                                                cursor_type="row",
                                                zebra_stripes=True,
                                            ),
                                            classes="income-column",
                                        ),
                                        classes="month-grid",
                                    ),
                                    classes="single_month_container",
                                )

    def on_mount(self) -> None:
        """Populate the initial view."""
        if self.transactions.empty:
            return
        self.call_after_refresh(self.update_initial_views)

    def on_screen_resume(self, event: Any) -> None:
        """Called when the screen is resumed after being suspended."""
        # Save current state
        was_empty = self.transactions.empty
        old_years = (
            set(self.transactions["Date"].dt.year.unique()) if not was_empty else set()
        )

        # Reload data
        self.load_and_prepare_data()
        is_empty = self.transactions.empty
        new_years = (
            set(self.transactions["Date"].dt.year.unique()) if not is_empty else set()
        )

        # Check if we need to recompose
        # Recompose if we went from empty to not-empty, or if the years changed.
        needs_recompose = (was_empty and not is_empty) or (old_years != new_years)

        if needs_recompose:
            # Recompose the entire screen if the structure changed significantly
            self.app.pop_screen()
            self.app.push_screen("summary")
            return

        # If we don't need a full recompose, just update the views
        if not is_empty:
            try:
                year_tabs = self.query_one("#year_tabs", TabbedContent)
                active_year_id = year_tabs.active
                if active_year_id:
                    year = int(active_year_id.split("_")[1])

                    month_tabs = self.query_one(f"#month_tabs_{year}", TabbedContent)
                    active_month_id = month_tabs.active

                    if active_month_id and active_month_id.endswith("_all"):
                        self.update_cash_flow(year)
                        self.update_all_year_category_view(year)
                        self.update_all_year_monthly_view(year)
                        self.update_top_merchants_view(year)
                        self.update_all_year_income_view(year)
                        self.update_top_income_view(year)
                    elif active_month_id:
                        month = int(active_month_id.split("_")[2])
                        self.update_cash_flow(year, month)
                        self.update_month_view(year, month)
                        self.update_top_merchants_view(year, month)
                        self.update_month_income_view(year, month)
                        self.update_top_income_view(year, month)
            except Exception as e:
                logging.warning(f"Error updating summary screen on resume: {e}")

    def update_initial_views(self) -> None:
        """Helper to populate the views after the initial layout is ready."""
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        active_year_id = year_tabs.active
        if active_year_id:
            year = int(active_year_id.split("_")[1])
            self.update_cash_flow(year)
            self.update_all_year_category_view(year)
            self.update_all_year_monthly_view(year)
            self.update_top_merchants_view(year)
            self.update_all_year_income_view(year)
            self.update_top_income_view(year)
            self.query_one(f"#category_breakdown_{year}_all", DataTable).focus()

    def on_tabbed_content_tab_activated(
        self, event: TabbedContent.TabActivated
    ) -> None:
        """Handle tab changes to update the data."""
        self.load_and_prepare_data()  # Reload data on every tab change

        if event.tabbed_content.id == "year_tabs":
            year = int(event.pane.id.split("_")[1])
            self.update_cash_flow(year)
            self.update_all_year_category_view(year)
            self.update_all_year_monthly_view(year)
            self.update_top_merchants_view(year)
            self.update_all_year_income_view(year)
            self.update_top_income_view(year)

        elif event.tabbed_content.id.startswith("month_tabs_"):
            year = int(event.tabbed_content.id.split("_")[2])
            pane_id = event.pane.id.split("_")

            if pane_id[-1] == "all":
                self.update_cash_flow(year)
                self.update_all_year_category_view(year)
                self.update_all_year_monthly_view(year)
                self.update_top_merchants_view(year)
                self.update_all_year_income_view(year)
                self.update_top_income_view(year)
            else:
                month = int(pane_id[2])
                self.update_cash_flow(year, month)
                self.update_month_view(year, month)
                self.update_top_merchants_view(year, month)
                self.update_month_income_view(year, month)
                self.update_top_income_view(year, month)

    def action_toggle_selection(self) -> None:
        """Toggle selection for the current row in the focused table."""
        focused_widget = self.app.focused
        if (
            not isinstance(focused_widget, DataTable)
            or focused_widget.cursor_row is None
        ):
            return

        table = focused_widget
        # The category is always in the first column.
        row_key = str(table.get_cell_at((table.cursor_row, 0)))

        if "Total" in row_key:  # Don't select total rows
            return

        if row_key in self.selected_rows:
            self.selected_rows.remove(row_key)
        else:
            self.selected_rows.add(row_key)

        # Refresh the current view to show the selection
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        year = int(year_tabs.active.split("_")[1])
        month_tabs = self.query_one(f"#month_tabs_{year}", TabbedContent)
        active_month_pane_id = month_tabs.active.split("_")

        if active_month_pane_id[-1] == "all":
            if table.id.startswith("category_breakdown"):
                self.update_all_year_category_view(year)
            elif table.id.startswith("monthly_breakdown"):
                self.update_all_year_monthly_view(year)
        else:
            month = int(active_month_pane_id[-1])
            self.update_month_view(year, month)

    def _get_spending_bar(
        self, amount: float, max_value: float, bar_length: int = 20
    ) -> str:
        """Generates a text-based spending bar."""
        if max_value == 0:
            return " " * bar_length

        num_blocks = int((amount / max_value) * bar_length)
        return "█" * num_blocks + "░" * (bar_length - num_blocks)

    def update_all_year_category_view(self, year: int) -> None:
        """Populates the table in the 'All Year' tab."""
        table = self.query_one(f"#category_breakdown_{year}_all", DataTable)
        title_widget = self.query_one(
            f"#all_year_container_{year} .table_title", Static
        )
        cursor_row = table.cursor_row
        table.clear(columns=True)
        table.add_columns("Category", "Amount", "Percentage")

        year_df = self.transactions[self.transactions["Date"].dt.year == year]
        # Filter to expenses only for category breakdown
        if "Type" in year_df.columns:
            year_df = year_df[year_df["Type"] == "expense"]
        total = 0.0
        if not year_df.empty:
            category_summary = year_df.groupby("Category")["Amount"].sum().reset_index()
            category_summary = category_summary.sort_values(
                by="Amount", ascending=False
            )

            total = category_summary["Amount"].sum()
            selected_style = Style(bgcolor="yellow", color="black")
            for _, row in category_summary.iterrows():
                category = row["Category"]
                style = selected_style if category in self.selected_rows else ""
                percentage = (row["Amount"] / total) * 100 if total > 0 else 0
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                    Text(f"{percentage:.2f}%", style=style),
                ]
                table.add_row(*styled_row, key=category)

        title_widget.update(f"Expense Categories (Total: {total:,.2f})")
        table.move_cursor(row=cursor_row)

    def update_month_view(self, year: int, month: int) -> None:
        """Populates the left-hand table with a monthly category breakdown."""
        category_table = self.query_one(
            f"#category_breakdown_{year}_{month}", DataTable
        )
        title_widget = self.query_one(f"#month_{year}_{month} .table_title", Static)
        cursor_row = category_table.cursor_row
        category_table.clear(columns=True)
        category_table.add_columns("Category", "Amount", "Percentage", "Bar")
        month_df = self.transactions[
            (self.transactions["Date"].dt.year == year)
            & (self.transactions["Date"].dt.month == month)
        ]
        # Filter to expenses only
        if "Type" in month_df.columns:
            month_df = month_df[month_df["Type"] == "expense"]

        total = 0.0
        if not month_df.empty:
            category_summary = (
                month_df.groupby("Category")["Amount"].sum().reset_index()
            )
            category_summary = category_summary.sort_values(
                by="Amount", ascending=False
            )

            total = category_summary["Amount"].sum()
            max_amount = category_summary["Amount"].max()
            selected_style = Style(bgcolor="yellow", color="black")
            for _, row in category_summary.iterrows():
                category = row["Category"]
                style = selected_style if category in self.selected_rows else ""
                percentage = (row["Amount"] / total) * 100 if total > 0 else 0
                bar = self._get_spending_bar(row["Amount"], max_amount, bar_length=25)
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                    Text(f"{percentage:.2f}%", style=style),
                    bar,  # Plain string, no Text() wrapper, no style
                ]
                category_table.add_row(*styled_row, key=category)

        title_widget.update(f"Expense Categories (Total: {total:,.2f})")
        category_table.move_cursor(row=cursor_row)

    def update_top_merchants_view(self, year: int, month: Optional[int] = None) -> None:
        """Populates the top merchants table for a given period."""
        if month:
            table_id = f"top_merchants_{year}_{month}"
            df = self.transactions[
                (self.transactions["Date"].dt.year == year)
                & (self.transactions["Date"].dt.month == month)
            ].copy()
        else:
            table_id = f"top_merchants_{year}_all"
            df = self.transactions[self.transactions["Date"].dt.year == year].copy()

        # Filter to expenses only for top merchants
        if "Type" in df.columns:
            df = df[df["Type"] == "expense"]

        try:
            table = self.query_one(f"#{table_id}", DataTable)
        except Exception as e:
            logging.warning(f"DataTable for {table_id} not found: {e}")
            return  # Table might not exist yet

        table.clear(columns=True)
        table.add_columns("Merchant", "Category", "Amount")

        if not df.empty:
            # Ensure DisplayMerchant column exists (it should from load_and_prepare_data)
            if "DisplayMerchant" not in df.columns:
                logging.warning(
                    "DisplayMerchant column not found, using Merchant instead"
                )
                df["DisplayMerchant"] = df["Merchant"]

            # Debug: Log sample of merchants and their aliases
            if len(df) > 0:
                sample_size = min(5, len(df))
                logging.debug(
                    f"Top merchants view - Sample of {sample_size} transactions:"
                )
                for idx, row in df.head(sample_size).iterrows():
                    logging.debug(
                        f"  Original: '{row['Merchant']}' -> Display: '{row['DisplayMerchant']}'"
                    )

            # Group by DisplayMerchant (alias) to combine transactions with same alias
            # Also get the most common category for each display merchant
            merchant_summary = (
                df.groupby("DisplayMerchant", as_index=False)
                .agg(
                    {
                        "Amount": "sum",
                        "Category": lambda x: (
                            x.mode()[0] if len(x.mode()) > 0 else "Other"
                        ),
                    }
                )
                .sort_values("Amount", ascending=False)
            )

            logging.debug(
                f"Top merchants summary has {len(merchant_summary)} unique display merchants"
            )

            for _, row in merchant_summary.iterrows():
                display_merchant = row["DisplayMerchant"]
                amount = row["Amount"]
                category = row["Category"]
                table.add_row(
                    display_merchant, category, f"{amount:,.2f}", key=display_merchant
                )

    def update_cash_flow(self, year: int, month: Optional[int] = None) -> None:
        """Updates the cash flow summary for a year or specific month."""
        try:
            if month:
                widget_id = f"cash_flow_{year}_{month}"
                df = self.transactions[
                    (self.transactions["Date"].dt.year == year)
                    & (self.transactions["Date"].dt.month == month)
                ]
            else:
                widget_id = f"cash_flow_{year}_all"
                df = self.transactions[self.transactions["Date"].dt.year == year]

            totals = get_cash_flow_totals(df)
            net_color = "green" if totals["net"] >= 0 else "red"

            cash_flow_widget = self.query_one(f"#{widget_id}", Static)
            cash_flow_widget.update(
                f"[bold]Income:[/bold] [green]{totals['total_income']:,.2f}[/green]  |  "
                f"[bold]Expenses:[/bold] [red]{totals['total_expenses']:,.2f}[/red]  |  "
                f"[bold]Net:[/bold] [{net_color}]{totals['net']:,.2f}[/{net_color}]  |  "
                f"[bold]Savings Rate:[/bold] {totals['savings_rate']:.1f}%"
            )
        except Exception as e:
            logging.warning(f"Error updating cash flow for {year}/{month}: {e}")

    def update_all_year_income_view(self, year: int) -> None:
        """Populates the income categories table in the 'All Year' tab."""
        try:
            table = self.query_one(f"#income_breakdown_{year}_all", DataTable)
        except Exception as e:
            logging.warning(f"Income breakdown table not found for year {year}: {e}")
            return

        cursor_row = table.cursor_row
        table.clear(columns=True)
        table.add_columns("Category", "Amount", "Percentage")

        year_df = self.transactions[self.transactions["Date"].dt.year == year]
        # Filter to income only
        if "Type" in year_df.columns:
            year_df = year_df[year_df["Type"] == "income"]

        total = 0.0
        if not year_df.empty:
            category_summary = year_df.groupby("Category")["Amount"].sum().reset_index()
            category_summary = category_summary.sort_values(
                by="Amount", ascending=False
            )

            total = category_summary["Amount"].sum()
            selected_style = Style(bgcolor="yellow", color="black")
            for _, row in category_summary.iterrows():
                category = row["Category"]
                style = selected_style if category in self.selected_rows else ""
                percentage = (row["Amount"] / total) * 100 if total > 0 else 0
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                    Text(f"{percentage:.2f}%", style=style),
                ]
                table.add_row(*styled_row, key=f"income_{category}")

        # Update the title with the total
        try:
            title_widget = self.query_one(f"#income_title_{year}_all", Static)
            title_widget.update(f"Income Categories (Total: {total:,.2f})")
        except Exception as e:
            logging.warning(f"Income title widget not found for year {year}: {e}")

        table.move_cursor(row=cursor_row)

    def update_month_income_view(self, year: int, month: int) -> None:
        """Populates the income categories table for a specific month."""
        try:
            table = self.query_one(f"#income_breakdown_{year}_{month}", DataTable)
        except Exception as e:
            logging.warning(f"Income breakdown table not found for {year}/{month}: {e}")
            return

        cursor_row = table.cursor_row
        table.clear(columns=True)
        table.add_columns("Category", "Amount", "Percentage", "Bar")

        month_df = self.transactions[
            (self.transactions["Date"].dt.year == year)
            & (self.transactions["Date"].dt.month == month)
        ]
        # Filter to income only
        if "Type" in month_df.columns:
            month_df = month_df[month_df["Type"] == "income"]

        total = 0.0
        if not month_df.empty:
            category_summary = (
                month_df.groupby("Category")["Amount"].sum().reset_index()
            )
            category_summary = category_summary.sort_values(
                by="Amount", ascending=False
            )

            total = category_summary["Amount"].sum()
            max_amount = category_summary["Amount"].max()
            selected_style = Style(bgcolor="yellow", color="black")
            for _, row in category_summary.iterrows():
                category = row["Category"]
                style = selected_style if category in self.selected_rows else ""
                percentage = (row["Amount"] / total) * 100 if total > 0 else 0
                bar = self._get_spending_bar(row["Amount"], max_amount, bar_length=25)
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                    Text(f"{percentage:.2f}%", style=style),
                    bar,
                ]
                table.add_row(*styled_row, key=f"income_{category}")

        # Update the title with the total
        try:
            title_widget = self.query_one(f"#income_title_{year}_{month}", Static)
            title_widget.update(f"Income Categories (Total: {total:,.2f})")
        except Exception as e:
            logging.warning(f"Income title widget not found for {year}/{month}: {e}")

        table.move_cursor(row=cursor_row)

    def update_top_income_view(self, year: int, month: Optional[int] = None) -> None:
        """Populates the top income sources table for a given period."""
        if month:
            table_id = f"top_income_{year}_{month}"
            df = self.transactions[
                (self.transactions["Date"].dt.year == year)
                & (self.transactions["Date"].dt.month == month)
            ].copy()
        else:
            table_id = f"top_income_{year}_all"
            df = self.transactions[self.transactions["Date"].dt.year == year].copy()

        # Filter to income only
        if "Type" in df.columns:
            df = df[df["Type"] == "income"]

        try:
            table = self.query_one(f"#{table_id}", DataTable)
        except Exception as e:
            logging.warning(f"DataTable for {table_id} not found: {e}")
            return

        table.clear(columns=True)
        table.add_columns("Source", "Category", "Amount")

        if not df.empty:
            # Ensure DisplayMerchant column exists
            if "DisplayMerchant" not in df.columns:
                df["DisplayMerchant"] = df["Merchant"]

            # Group by DisplayMerchant (alias) to combine transactions with same alias
            merchant_summary = (
                df.groupby("DisplayMerchant", as_index=False)
                .agg(
                    {
                        "Amount": "sum",
                        "Category": lambda x: (
                            x.mode()[0] if len(x.mode()) > 0 else "Other"
                        ),
                    }
                )
                .sort_values("Amount", ascending=False)
            )

            for _, row in merchant_summary.iterrows():
                display_merchant = row["DisplayMerchant"]
                amount = row["Amount"]
                category = row["Category"]
                table.add_row(
                    display_merchant,
                    category,
                    f"{amount:,.2f}",
                    key=f"income_{display_merchant}",
                )

    def _calculate_historical_stats(self):
        """Calculate rolling mean and std for anomaly detection."""
        all_monthly_summary = self.transactions.pivot_table(
            index="Category",
            columns=pd.Grouper(key="Date", freq="MS"),
            values="Amount",
            aggfunc="sum",
            fill_value=0,
        )
        # Transpose, apply rolling (on rows), then transpose back
        # This replaces the deprecated axis=1 parameter
        transposed = all_monthly_summary.T
        rolling_mean = transposed.rolling(window=12, min_periods=1).mean().shift(1).T
        rolling_std = (
            transposed.rolling(window=12, min_periods=1).std().shift(1).fillna(0).T
        )
        return rolling_mean, rolling_std

    def _prepare_monthly_summary(self, year_df, month_map):
        """Prepare and format monthly summary dataframe."""
        monthly_summary = year_df.pivot_table(
            index="Category",
            columns=year_df["Date"].dt.month,
            values="Amount",
            aggfunc="sum",
            fill_value=0,
        )

        # Ensure all 12 months are present
        for m in range(1, 13):
            if m not in monthly_summary.columns:
                monthly_summary[m] = 0
        monthly_summary = monthly_summary[sorted(monthly_summary.columns)]

        # Rename columns to month names
        monthly_summary.rename(columns=month_map, inplace=True)

        # Add totals and averages
        month_columns_for_avg = list(month_map.values())
        monthly_summary["Total"] = monthly_summary.sum(axis=1)
        non_zero_months = (monthly_summary[month_columns_for_avg] > 0).sum(axis=1)
        monthly_summary["Average"] = (
            monthly_summary["Total"].divide(non_zero_months).fillna(0)
        )
        monthly_summary = monthly_summary.sort_values(by="Total", ascending=False)

        return monthly_summary

    def _create_monthly_cell(
        self,
        amount,
        trend,
        category_name,
        year,
        month_name,
        style,
        rolling_mean,
        rolling_std,
        trend_styles,
    ):
        """Create a styled cell for a monthly amount with trend."""
        month_num = datetime.strptime(month_name, "%b").month
        current_date = pd.Timestamp(f"{year}-{month_num}-01")

        cell_style = style
        # Check for anomalies
        if category_name in rolling_mean.index and current_date in rolling_mean.columns:
            historical_mean = rolling_mean.loc[category_name, current_date]
            historical_std = rolling_std.loc[category_name, current_date]
            if (
                pd.notna(historical_mean)
                and pd.notna(historical_std)
                and historical_mean > 0
                and historical_std > 0
                and amount > historical_mean + 2 * historical_std
            ):
                cell_style = style + Style(bgcolor="dark_red")

        cell_text = Text(f"{amount:,.2f}", style=cell_style)
        if amount > 0:
            cell_text.append(f" {trend}", style=trend_styles.get(trend, Style()))
        return cell_text

    def _populate_monthly_breakdown(self, table: DataTable, year: int) -> None:
        """Helper function to populate a table with monthly breakdown data, with categories as rows."""
        try:
            table.clear(columns=True)
            year_df = self.transactions[self.transactions["Date"].dt.year == year]
            # Filter to expenses only
            if "Type" in year_df.columns:
                year_df = year_df[year_df["Type"] == "expense"]
            if year_df.empty:
                return

            # Prepare data
            month_map = {m: datetime(2000, m, 1).strftime("%b") for m in range(1, 13)}
            monthly_summary = self._prepare_monthly_summary(year_df, month_map)
            rolling_mean, rolling_std = self._calculate_historical_stats()

            # Setup table
            month_columns = list(month_map.values())
            columns = ["Category", "Total", "Average"] + month_columns
            table.add_columns(*columns)

            # Add total row
            total_row_data = monthly_summary[month_columns].sum()
            total_row_data["Total"] = total_row_data.sum()
            total_row_data["Average"] = total_row_data["Total"] / 12
            total_row_values = [total_row_data["Total"], total_row_data["Average"]] + [
                total_row_data[col] for col in month_columns
            ]
            table.add_row(
                "[bold]Total[/bold]",
                *[f"[bold]{val:,.2f}[/bold]" for val in total_row_values],
            )

            # Add category rows
            selected_style = Style(bgcolor="yellow", color="black")
            trend_styles = {
                "↑": Style(bold=True, color="red"),
                "↓": Style(bold=True, color="green"),
                "=": Style(bold=True, color="yellow"),
                "-": Style(),
            }

            for category_name, row in monthly_summary.iterrows():
                style = (
                    selected_style
                    if category_name in self.selected_rows
                    else Style.null()
                )
                styled_cells = [Text(category_name, style=style)]
                styled_cells.append(Text(f"{row['Total']:,.2f}", style=style))
                styled_cells.append(Text(f"{row['Average']:,.2f}", style=style))

                monthly_values = [row[col] for col in month_columns]
                trends = calculate_trends(monthly_values)

                for i, month_name in enumerate(month_columns):
                    cell = self._create_monthly_cell(
                        monthly_values[i],
                        trends[i][1],
                        category_name,
                        year,
                        month_name,
                        style,
                        rolling_mean,
                        rolling_std,
                        trend_styles,
                    )
                    styled_cells.append(cell)

                table.add_row(*styled_cells, key=category_name)
        except Exception as e:
            logging.error(
                f"An error occurred in _populate_monthly_breakdown: {e}", exc_info=True
            )

    def _populate_monthly_income_breakdown(self, table: DataTable, year: int) -> None:
        """Helper function to populate a table with monthly income breakdown data."""
        try:
            table.clear(columns=True)
            year_df = self.transactions[self.transactions["Date"].dt.year == year]
            # Filter to income only
            if "Type" in year_df.columns:
                year_df = year_df[year_df["Type"] == "income"]
            if year_df.empty:
                return

            # Prepare data
            month_map = {m: datetime(2000, m, 1).strftime("%b") for m in range(1, 13)}
            monthly_summary = self._prepare_monthly_summary(year_df, month_map)

            # Setup table
            month_columns = list(month_map.values())
            columns = ["Category", "Total", "Average"] + month_columns
            table.add_columns(*columns)

            # Add total row
            total_row_data = monthly_summary[month_columns].sum()
            total_row_data["Total"] = total_row_data.sum()
            total_row_data["Average"] = total_row_data["Total"] / 12
            total_row_values = [total_row_data["Total"], total_row_data["Average"]] + [
                total_row_data[col] for col in month_columns
            ]
            table.add_row(
                "[bold]Total[/bold]",
                *[f"[bold]{val:,.2f}[/bold]" for val in total_row_values],
            )

            # Add category rows
            selected_style = Style(bgcolor="yellow", color="black")
            for category_name, row in monthly_summary.iterrows():
                style = (
                    selected_style
                    if category_name in self.selected_rows
                    else Style.null()
                )
                styled_cells = [Text(category_name, style=style)]
                styled_cells.append(Text(f"{row['Total']:,.2f}", style=style))
                styled_cells.append(Text(f"{row['Average']:,.2f}", style=style))

                for month_name in month_columns:
                    value = row[month_name]
                    cell_text = f"{value:,.2f}" if value > 0 else "-"
                    styled_cells.append(Text(cell_text, style=style))

                table.add_row(*styled_cells, key=f"income_{category_name}")
        except Exception as e:
            logging.error(
                f"An error occurred in _populate_monthly_income_breakdown: {e}",
                exc_info=True,
            )

    def update_all_year_monthly_view(self, year: int) -> None:
        """Populates the monthly breakdown tables in the 'All Year' tab."""
        try:
            table = self.query_one(f"#monthly_breakdown_{year}_all", DataTable)
            table.fixed_columns = 3
            self._populate_monthly_breakdown(table, year)
        except Exception as e:
            logging.warning(
                f"Error updating monthly expense breakdown for year {year}: {e}"
            )

        try:
            income_table = self.query_one(
                f"#monthly_income_breakdown_{year}_all", DataTable
            )
            income_table.fixed_columns = 3
            self._populate_monthly_income_breakdown(income_table, year)
        except Exception as e:
            logging.warning(
                f"Error updating monthly income breakdown for year {year}: {e}"
            )

    def on_data_table_cell_selected(self, event: DataTable.CellSelected) -> None:
        """Handle cell selection to navigate to the transaction screen."""
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        year = int(year_tabs.active.split("_")[1])

        table_id = event.data_table.id
        row_key = event.cell_key.row_key
        category_renderable = event.data_table.get_row(row_key)[0]
        category_string = str(category_renderable)

        category = None
        month = None

        # Logic for Monthly Breakdown table
        if table_id and table_id.startswith("monthly_breakdown"):
            column_key = event.cell_key.column_key
            column = event.data_table.columns[column_key]
            month_name = str(column.label)

            if month_name in ["Total", "Average", "Category"]:
                return

            try:
                month = datetime.strptime(month_name, "%b").month
            except ValueError:
                return  # Not a month column

            if "Total" not in category_string:
                category = category_string

        # Logic for Category Breakdown tables
        elif table_id and table_id.startswith("category_breakdown"):
            if "Total" in category_string:
                return

            category = category_string
            month_tabs_id = f"#month_tabs_{year}"
            month_tabs = self.query_one(month_tabs_id, TabbedContent)
            active_month_pane_id = month_tabs.active.split("_")
            if active_month_pane_id[-1] != "all":
                month = int(active_month_pane_id[-1])
        else:
            return

        self.app.push_screen(
            self.app.SCREENS["transactions"](
                category=category, year=year, month=month, source=self._get_single_source_filter()
            )
        )

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """Handle row selection (clicking on rows with cursor_type='row')."""
        table = event.data_table
        table_id = table.id

        # Get year context
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        year = int(year_tabs.active.split("_")[1])

        # Get the first cell value (category or merchant name)
        try:
            first_cell = table.get_cell_at((event.cursor_row, 0))
            first_cell_str = str(first_cell).strip()

            # Skip if it's a total row
            if "Total" in first_cell_str or "total" in first_cell_str.lower():
                return
        except Exception as e:
            logging.warning(f"Could not get cell value: {e}")
            return

        category = None
        month = None
        merchant = None

        # Determine month context
        month_tabs_id = f"#month_tabs_{year}"
        month_tabs = self.query_one(month_tabs_id, TabbedContent)
        active_month_pane_id = month_tabs.active.split("_")
        if active_month_pane_id[-1] != "all":
            month = int(active_month_pane_id[-1])

        # Handle different table types
        if table_id and table_id.startswith("category_breakdown"):
            category = first_cell_str
        elif table_id and table_id.startswith("top_merchants"):
            # For top merchants, use the row key which contains the full merchant name
            row_key = event.row_key
            merchant = str(row_key.value)

        # Navigate to transactions screen
        if merchant:
            # For merchants, show transactions for that merchant
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    merchant=merchant, year=year, month=month, source=self._get_single_source_filter()
                )
            )
        elif category:
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    category=category, year=year, month=month, source=self._get_single_source_filter()
                )
            )

    def _get_current_month_context(self, year: int) -> Optional[int]:
        """Get the current month context from tabs, if applicable."""
        month_tabs_id = f"#month_tabs_{year}"
        month_tabs = self.query_one(month_tabs_id, TabbedContent)
        active_month_pane_id = month_tabs.active.split("_")
        if active_month_pane_id[-1] != "all":
            return int(active_month_pane_id[-1])
        return None

    def _handle_category_breakdown_table(self, first_cell_str: str, year: int):
        """Handle drill-down for category breakdown tables."""
        category = first_cell_str
        month = self._get_current_month_context(year)
        return category, None, month

    def _handle_top_merchants_table(self, table: DataTable, year: int):
        """Handle drill-down for top merchants tables."""
        try:
            cell_key = table.coordinate_to_cell_key((table.cursor_row, 0))
            merchant = str(cell_key.row_key.value)
            month = self._get_current_month_context(year)
            return None, merchant, month
        except Exception as e:
            logging.warning(f"Could not get row key: {e}")
            return None, None, None

    def _handle_monthly_breakdown_table(
        self, table: DataTable, first_cell_str: str, year: int
    ):
        """Handle drill-down for monthly breakdown tables."""
        category = first_cell_str
        month = None

        # For cell cursor tables, we can get the column
        if hasattr(table, "cursor_column") and table.cursor_column is not None:
            try:
                column = table.columns[table.cursor_column]
                month_name = str(column.label)

                if month_name not in ["Total", "Average", "Category"]:
                    try:
                        month = datetime.strptime(month_name, "%b").month
                    except ValueError:
                        pass  # Not a month column, drill down for whole year
            except Exception as e:
                logging.warning(f"Could not determine month column: {e}")

        return category, None, month

    def action_drill_down(self) -> None:
        """Drill down into transactions from the current table row or cell."""
        focused_widget = self.app.focused
        if (
            not isinstance(focused_widget, DataTable)
            or focused_widget.cursor_row is None
        ):
            return

        table = focused_widget
        table_id = table.id

        year_tabs = self.query_one("#year_tabs", TabbedContent)
        year = int(year_tabs.active.split("_")[1])

        # Get the first column value (category or merchant name)
        try:
            first_cell = table.get_cell_at((table.cursor_row, 0))
            first_cell_str = str(first_cell).strip()
            # Skip if it's a total row
            if "Total" in first_cell_str or "total" in first_cell_str.lower():
                return
        except Exception as e:
            logging.warning(f"Could not get cell value: {e}")
            return

        # Handle different table types
        category, merchant, month = None, None, None
        if table_id and table_id.startswith("category_breakdown"):
            category, merchant, month = self._handle_category_breakdown_table(
                first_cell_str, year
            )
        elif table_id and table_id.startswith("top_merchants"):
            category, merchant, month = self._handle_top_merchants_table(table, year)
        elif table_id and table_id.startswith("monthly_breakdown"):
            category, merchant, month = self._handle_monthly_breakdown_table(
                table, first_cell_str, year
            )
        else:
            return

        # Navigate to transactions screen
        if merchant:
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    merchant=merchant, year=year, month=month, source=self._get_single_source_filter()
                )
            )
        elif category:
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    category=category, year=year, month=month, source=self._get_single_source_filter()
                )
            )

    def update_table(self) -> None:
        """Update the table."""
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        year = int(year_tabs.active.split("_")[1])
        month_tabs = self.query_one(f"#month_tabs_{year}", TabbedContent)
        active_month_pane_id = month_tabs.active.split("_")

        if active_month_pane_id[-1] == "all":
            self.update_all_year_category_view(year)
            self.update_all_year_monthly_view(year)
        else:
            month = int(active_month_pane_id[-1])
            self.update_month_view(year, month)
