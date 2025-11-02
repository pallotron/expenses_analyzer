from textual.app import ComposeResult
from textual.widgets import Static, TabbedContent, TabPane, DataTable
from textual.containers import Horizontal, Vertical
import pandas as pd
from datetime import datetime

from textual.binding import Binding
from rich.style import Style
from rich.text import Text

from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import load_transactions_from_parquet, load_categories


class SummaryScreen(BaseScreen):
    """A summary screen with transactions per year and month."""

    BINDINGS = [
        Binding("space", "toggle_selection", "Toggle Selection"),
    ]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.load_and_prepare_data()
        self.selected_rows = set()

    def load_and_prepare_data(self):
        """Loads and prepares transaction and category data."""
        self.transactions = load_transactions_from_parquet()
        self.categories = load_categories()
        if not self.transactions.empty:
            self.transactions["Date"] = pd.to_datetime(self.transactions["Date"])
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
                                    classes="single_month_container",
                                )

    def on_mount(self) -> None:
        """Populate the initial view."""
        if self.transactions.empty:
            return
        self.call_after_refresh(self.update_initial_views)

    def update_initial_views(self):
        """Helper to populate the views after the initial layout is ready."""
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        active_year_id = year_tabs.active
        if active_year_id:
            year = int(active_year_id.split("_")[1])
            self.update_all_year_category_view(year)
            self.update_all_year_monthly_view(year)
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

        elif event.tabbed_content.id.startswith("month_tabs_"):
            year = int(event.tabbed_content.id.split("_")[2])
            pane_id = event.pane.id.split("_")

            if pane_id[-1] == "all":
                self.update_all_year_category_view(year)
                self.update_all_year_monthly_view(year)
            else:
                month = int(pane_id[2])
                self.update_month_view(year, month)

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

    def update_all_year_category_view(self, year: int):
        """Populates the table in the 'All Year' tab."""
        table = self.query_one(f"#category_breakdown_{year}_all", DataTable)
        title_widget = self.query_one(
            f"#all_year_container_{year} .table_title", Static
        )
        cursor_row = table.cursor_row
        table.clear(columns=True)
        table.add_columns("Category", "Amount")

        year_df = self.transactions[self.transactions["Date"].dt.year == year]
        total = 0.0
        if not year_df.empty:
            category_summary = year_df.groupby("Category")["Amount"].sum().reset_index()
            category_summary = category_summary.sort_values(
                by="Amount", ascending=False
            )

            selected_style = Style(bgcolor="yellow", color="black")
            for _, row in category_summary.iterrows():
                category = row["Category"]
                style = selected_style if category in self.selected_rows else ""
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                ]
                table.add_row(*styled_row, key=category)

            total = category_summary["Amount"].sum()

        title_widget.update(f"Category breakdown (Total: {total:,.2f})")
        table.move_cursor(row=cursor_row)

    def update_month_view(self, year: int, month: int):
        """Populates the left-hand table with a monthly category breakdown."""
        category_table = self.query_one(
            f"#category_breakdown_{year}_{month}", DataTable
        )
        title_widget = self.query_one(f"#month_{year}_{month} .table_title", Static)
        cursor_row = category_table.cursor_row
        category_table.clear(columns=True)
        category_table.add_columns("Category", "Amount")
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

            selected_style = Style(bgcolor="yellow", color="black")
            for _, row in category_summary.iterrows():
                category = row["Category"]
                style = selected_style if category in self.selected_rows else ""
                styled_row = [
                    Text(category, style=style),
                    Text(f"{row['Amount']:,.2f}", style=style),
                ]
                category_table.add_row(*styled_row, key=category)

            total = category_summary["Amount"].sum()

        title_widget.update(f"Category breakdown (Total: {total:,.2f})")
        category_table.move_cursor(row=cursor_row)

    def _populate_monthly_breakdown(self, table: DataTable, year: int):
        """Helper function to populate a table with monthly breakdown data, with categories as rows."""
        table.clear(columns=True)
        year_df = self.transactions[self.transactions["Date"].dt.year == year]

        if not year_df.empty:
            # Pivot to get categories as rows and months as columns
            monthly_summary = year_df.pivot_table(
                index="Category",
                columns=year_df["Date"].dt.month,
                values="Amount",
                aggfunc="sum",
                fill_value=0,
            )

            # Ensure all 12 months are present, even if there's no data
            for m in range(1, 13):
                if m not in monthly_summary.columns:
                    monthly_summary[m] = 0

            # Sort columns chronologically
            monthly_summary = monthly_summary[sorted(monthly_summary.columns)]

            # Map month numbers to names
            month_map = {m: datetime(2000, m, 1).strftime("%b") for m in range(1, 13)}
            monthly_summary.rename(columns=month_map, inplace=True)

            # Add a 'Total' column for the year-to-date sum for each category
            monthly_summary["Total"] = monthly_summary.sum(axis=1)

            # Add an 'Average' column
            monthly_summary["Average"] = monthly_summary["Total"] / 12

            # Sort by total in descending order
            monthly_summary = monthly_summary.sort_values(by="Total", ascending=False)

            # Add a 'Total' row for the sum of each month
            month_columns = list(month_map.values())
            total_row_data = monthly_summary[
                month_columns
            ].sum()  # Sum only month columns
            total_row_data["Total"] = total_row_data.sum()  # Calculate total of totals
            total_row_data["Average"] = (
                total_row_data["Total"] / 12
            )  # Calculate average of totals
            total_row_data.name = "[bold]Total[/bold]"

            # Set up table columns
            columns = ["Category", "Total", "Average"] + month_columns
            table.add_columns(*columns)

            # Add the 'Total' row first
            total_row_values = [total_row_data["Total"], total_row_data["Average"]] + [
                total_row_data[col] for col in month_columns
            ]
            table.add_row(
                total_row_data.name,
                *[f"[bold]{val:,.2f}[/bold]" for val in total_row_values],
            )

            # Add the data for each category
            category_data = monthly_summary
            selected_style = Style(bgcolor="yellow", color="black")
            for category_name, row in category_data.iterrows():
                style = selected_style if category_name in self.selected_rows else ""
                row_values = [row["Total"], row["Average"]] + [
                    row[col] for col in month_columns
                ]

                styled_cells = [Text(category_name, style=style)]
                styled_cells.extend(
                    [Text(f"{val:,.2f}", style=style) for val in row_values]
                )

                table.add_row(*styled_cells, key=category_name)

    def update_all_year_monthly_view(self, year: int):
        """Populates the right-hand table in the 'All Year' tab."""
        try:
            table = self.query_one(f"#monthly_breakdown_{year}_all", DataTable)
            self._populate_monthly_breakdown(table, year)
        except Exception:
            pass  # Table might not exist yet

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
