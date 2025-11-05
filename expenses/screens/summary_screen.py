import logging
from textual.app import ComposeResult
from textual.widgets import Static, TabbedContent, TabPane, DataTable
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
from expenses.analysis import calculate_trends
from typing import Dict, Set, Optional, Any


class SummaryScreen(BaseScreen, DataTableOperationsMixin):
    """A summary screen with transactions per year and month."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
        Binding("enter", "drill_down", "Drill Down"),
    ]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.load_and_prepare_data()
        self.selected_rows: Set[str] = set()

    def load_and_prepare_data(self) -> None:
        """Loads and prepares transaction and category data."""
        self.transactions: pd.DataFrame = load_transactions_from_parquet()
        self.categories: Dict[str, str] = load_categories()
        self.merchant_aliases: Dict[str, str] = load_merchant_aliases()
        logging.info(f"Loaded {len(self.merchant_aliases)} merchant alias patterns")
        if not self.transactions.empty:
            self.transactions["Date"] = pd.to_datetime(self.transactions["Date"])
            # Apply merchant aliases for display
            self.transactions["DisplayMerchant"] = apply_merchant_aliases_to_series(
                self.transactions["Merchant"], self.merchant_aliases
            )
            # Log some examples
            if len(self.merchant_aliases) > 0:
                sample_size = min(5, len(self.transactions))
                logging.debug(f"Sample after applying aliases:")
                for idx, row in self.transactions.head(sample_size).iterrows():
                    logging.debug(f"  '{row['Merchant']}' -> '{row['DisplayMerchant']}'")
            self.transactions["Category"] = (
                self.transactions["Merchant"].map(self.categories).fillna("Other")
            )

    def compose_content(self) -> ComposeResult:
        yield Static("Expenses Summary", classes="title")

        if self.transactions.empty:
            yield Static("No transactions found.")
            return

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
                                Horizontal(
                                    Vertical(
                                        Static(
                                            "Category breakdown", classes="table_title"
                                        ),
                                        DataTable(
                                            id=f"category_breakdown_{year}_all",
                                            cursor_type="row",
                                            zebra_stripes=True,
                                        ),
                                        Static("Top Merchants", classes="table_title"),
                                        DataTable(
                                            id=f"top_merchants_{year}_all",
                                            cursor_type="row",
                                            zebra_stripes=True,
                                        ),
                                        classes="category-breakdown",
                                    ),
                                    Vertical(
                                        Static(
                                            "Monthly Breakdown", classes="table_title"
                                        ),
                                        DataTable(
                                            id=f"monthly_breakdown_{year}_all",
                                            zebra_stripes=True,
                                        ),
                                        classes="monthly-breakdown",
                                    ),
                                    classes="summary-grid",
                                ),
                                id=f"all_year_container_{year}",
                            )

                        # Add individual month tabs
                        for month in months_in_year:
                            month_name = datetime(2000, month, 1).strftime("%B")
                            with TabPane(month_name, id=f"month_{year}_{month}"):
                                yield Vertical(
                                    Static("Category breakdown", classes="table_title"),
                                    DataTable(
                                        id=f"category_breakdown_{year}_{month}",
                                        zebra_stripes=True,
                                    ),
                                    Static("Top Merchants", classes="table_title"),
                                    DataTable(
                                        id=f"top_merchants_{year}_{month}",
                                        cursor_type="row",
                                        zebra_stripes=True,
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
        old_transactions = self.transactions.copy() if not self.transactions.empty else pd.DataFrame()

        # Reload data
        self.load_and_prepare_data()

        # Check if we need to recompose (new years/months added or data appeared/disappeared)
        needs_recompose = False
        if old_transactions.empty != self.transactions.empty:
            # Data went from empty to populated or vice versa - need full recompose
            needs_recompose = True
        elif not self.transactions.empty and not old_transactions.empty:
            old_years = set(old_transactions["Date"].dt.year.unique())
            new_years = set(self.transactions["Date"].dt.year.unique())
            if old_years != new_years:
                needs_recompose = True

        if needs_recompose:
            # Recompose the entire screen if structure changed
            self.app.pop_screen()
            self.app.push_screen("summary")
        elif not self.transactions.empty:
            # Only update views if we have transactions and widgets exist
            try:
                year_tabs = self.query_one("#year_tabs", TabbedContent)
                active_year_id = year_tabs.active
                if active_year_id:
                    year = int(active_year_id.split("_")[1])

                    # Check which month tab is active
                    month_tabs = self.query_one(f"#month_tabs_{year}", TabbedContent)
                    active_month_id = month_tabs.active

                    if active_month_id and active_month_id.endswith("_all"):
                        # Update "All Year" view
                        self.update_all_year_category_view(year)
                        self.update_all_year_monthly_view(year)
                        self.update_top_merchants_view(year)
                    elif active_month_id:
                        # Update specific month view
                        month = int(active_month_id.split("_")[2])
                        self.update_month_view(year, month)
                        self.update_top_merchants_view(year, month)
            except Exception as e:
                logging.warning(f"Error updating summary screen on resume: {e}")

    def update_initial_views(self) -> None:
        """Helper to populate the views after the initial layout is ready."""
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        active_year_id = year_tabs.active
        if active_year_id:
            year = int(active_year_id.split("_")[1])
            self.update_all_year_category_view(year)
            self.update_all_year_monthly_view(year)
            self.update_top_merchants_view(year)
            self.query_one(f"#category_breakdown_{year}_all", DataTable).focus()

    def on_tabbed_content_tab_activated(
        self, event: TabbedContent.TabActivated
    ) -> None:
        """Handle tab changes to update the data."""
        self.load_and_prepare_data()  # Reload data on every tab change

        if event.tabbed_content.id == "year_tabs":
            year = int(event.pane.id.split("_")[1])
            self.update_all_year_category_view(year)
            self.update_all_year_monthly_view(year)
            self.update_top_merchants_view(year)

        elif event.tabbed_content.id.startswith("month_tabs_"):
            year = int(event.tabbed_content.id.split("_")[2])
            pane_id = event.pane.id.split("_")

            if pane_id[-1] == "all":
                self.update_all_year_category_view(year)
                self.update_all_year_monthly_view(year)
                self.update_top_merchants_view(year)
            else:
                month = int(pane_id[2])
                self.update_month_view(year, month)
                self.update_top_merchants_view(year, month)

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

        title_widget.update(f"Category breakdown (Total: {total:,.2f})")
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
                bar = self._get_spending_bar(row["Amount"], max_amount, bar_length=50)
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                    Text(f"{percentage:.2f}%", style=style),
                    bar,  # Plain string, no Text() wrapper, no style
                ]
                category_table.add_row(*styled_row, key=category)

        title_widget.update(f"Category breakdown (Total: {total:,.2f})")
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
                logging.warning("DisplayMerchant column not found, using Merchant instead")
                df["DisplayMerchant"] = df["Merchant"]

            # Debug: Log sample of merchants and their aliases
            if len(df) > 0:
                sample_size = min(5, len(df))
                logging.debug(f"Top merchants view - Sample of {sample_size} transactions:")
                for idx, row in df.head(sample_size).iterrows():
                    logging.debug(f"  Original: '{row['Merchant']}' -> Display: '{row['DisplayMerchant']}'")

            # Group by DisplayMerchant (alias) to combine transactions with same alias
            # Also get the most common category for each display merchant
            merchant_summary = (
                df.groupby("DisplayMerchant", as_index=False)
                .agg({"Amount": "sum", "Category": lambda x: x.mode()[0] if len(x.mode()) > 0 else "Other"})
                .sort_values("Amount", ascending=False)
            )

            logging.debug(f"Top merchants summary has {len(merchant_summary)} unique display merchants")

            for _, row in merchant_summary.iterrows():
                display_merchant = row["DisplayMerchant"]
                amount = row["Amount"]
                category = row["Category"]
                truncated_merchant = display_merchant[:15] + "..." if len(display_merchant) > 15 else display_merchant
                table.add_row(truncated_merchant, category, f"{amount:,.2f}", key=display_merchant)

    def _populate_monthly_breakdown(self, table: DataTable, year: int) -> None:
        """Helper function to populate a table with monthly breakdown data, with categories as rows."""
        try:
            table.clear(columns=True)
            year_df = self.transactions[self.transactions["Date"].dt.year == year]

            if year_df.empty:
                return

            # Pivot to get categories as rows and months as columns
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

            # Pre-calculate historical stats
            all_monthly_summary = self.transactions.pivot_table(
                index="Category",
                columns=pd.Grouper(key="Date", freq="MS"),
                values="Amount",
                aggfunc="sum",
                fill_value=0,
            )
            rolling_mean = (
                all_monthly_summary.rolling(window=12, axis=1, min_periods=1)
                .mean()
                .shift(1, axis=1)
            )
            rolling_std = (
                all_monthly_summary.rolling(window=12, axis=1, min_periods=1)
                .std()
                .shift(1, axis=1)
                .fillna(0)
            )

            month_map = {m: datetime(2000, m, 1).strftime("%b") for m in range(1, 13)}
            monthly_summary.rename(columns=month_map, inplace=True)

            monthly_summary["Total"] = monthly_summary.sum(axis=1)
            month_columns_for_avg = list(month_map.values())
            non_zero_months = (monthly_summary[month_columns_for_avg] > 0).sum(axis=1)
            monthly_summary["Average"] = (
                monthly_summary["Total"].divide(non_zero_months).fillna(0)
            )
            monthly_summary = monthly_summary.sort_values(by="Total", ascending=False)

            month_columns = list(month_map.values())
            total_row_data = monthly_summary[month_columns].sum()
            total_row_data["Total"] = total_row_data.sum()
            total_row_data["Average"] = total_row_data["Total"] / 12
            total_row_data.name = "[bold]Total[/bold]"

            columns = ["Category", "Total", "Average"] + month_columns
            table.add_columns(*columns)

            total_row_values = [total_row_data["Total"], total_row_data["Average"]] + [
                total_row_data[col] for col in month_columns
            ]
            table.add_row(
                total_row_data.name,
                *[f"[bold]{val:,.2f}[/bold]" for val in total_row_values],
            )

            category_data = monthly_summary
            selected_style = Style(bgcolor="yellow", color="black")
            trend_styles = {
                "↑": Style(bold=True, color="red"),
                "↓": Style(bold=True, color="green"),
                "=": Style(bold=True, color="yellow"),
                "-": Style(),
            }

            for category_name, row in category_data.iterrows():
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
                    amount = monthly_values[i]
                    trend = trends[i][1]
                    month_num = datetime.strptime(month_name, "%b").month
                    current_date = pd.Timestamp(f"{year}-{month_num}-01")

                    cell_style = style
                    if (
                        category_name in rolling_mean.index
                        and current_date in rolling_mean.columns
                    ):
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
                        cell_text.append(
                            f" {trend}", style=trend_styles.get(trend, Style())
                        )
                    styled_cells.append(cell_text)

                table.add_row(*styled_cells, key=category_name)
        except Exception as e:
            logging.error(
                f"An error occurred in _populate_monthly_breakdown: {e}", exc_info=True
            )

    def update_all_year_monthly_view(self, year: int) -> None:
        """Populates the right-hand table in the 'All Year' tab."""
        try:
            table = self.query_one(f"#monthly_breakdown_{year}_all", DataTable)
            table.fixed_columns = 3
            self._populate_monthly_breakdown(table, year)
        except Exception as e:
            logging.warning(f"Error updating monthly breakdown for year {year}: {e}")

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
            self.app.SCREENS["transactions"](category=category, year=year, month=month)
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
                    merchant=merchant, year=year, month=month
                )
            )
        elif category:
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    category=category, year=year, month=month
                )
            )

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

        category = None
        month = None
        merchant = None

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
        if table_id and table_id.startswith("category_breakdown"):
            # Category breakdown - drill down by category
            category = first_cell_str
            month_tabs_id = f"#month_tabs_{year}"
            month_tabs = self.query_one(month_tabs_id, TabbedContent)
            active_month_pane_id = month_tabs.active.split("_")
            if active_month_pane_id[-1] != "all":
                month = int(active_month_pane_id[-1])

        elif table_id and table_id.startswith("top_merchants"):
            # Top merchants - drill down by merchant name
            # Use the row key which contains the full merchant name
            try:
                cell_key = table.coordinate_to_cell_key((table.cursor_row, 0))
                merchant = str(cell_key.row_key.value)
            except Exception as e:
                logging.warning(f"Could not get row key: {e}")
                return
            month_tabs_id = f"#month_tabs_{year}"
            month_tabs = self.query_one(month_tabs_id, TabbedContent)
            active_month_pane_id = month_tabs.active.split("_")
            if active_month_pane_id[-1] != "all":
                month = int(active_month_pane_id[-1])

        elif table_id and table_id.startswith("monthly_breakdown"):
            # Monthly breakdown - need both category and column (month)
            category = first_cell_str

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
        else:
            return

        # Navigate to transactions screen
        if merchant:
            # For merchants, we filter by merchant name
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    merchant=merchant, year=year, month=month
                )
            )
        else:
            self.app.push_screen(
                self.app.SCREENS["transactions"](
                    category=category, year=year, month=month
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
