from textual.app import ComposeResult
from textual.widgets import Static, TabbedContent, TabPane, DataTable
from textual.containers import Horizontal, Vertical
import pandas as pd
from datetime import datetime

from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import load_transactions_from_parquet, load_categories


class SummaryScreen(BaseScreen):
    """A summary screen with transactions per year and month."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.load_and_prepare_data()

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

                    with TabbedContent(id=f"month_tabs_{year}", initial=f"month_{year}_all"):
                        # Add "All Year" tab first
                        with TabPane("All Year", id=f"month_{year}_all"):
                            yield Vertical(
                                Horizontal(
                                    Vertical(
                                        Static("Category breakdown", classes="table_title"),
                                        DataTable(id=f"category_breakdown_{year}_all", zebra_stripes=True),
                                        classes="category-breakdown",
                                    ),
                                    Vertical(
                                        Static("Monthly Breakdown", classes="table_title"),
                                        DataTable(id=f"monthly_breakdown_{year}_all", zebra_stripes=True),
                                        classes="monthly-breakdown",
                                    ),
                                    classes="summary-grid"
                                ),
                                id=f"all_year_container_{year}"
                            )

                        # Add individual month tabs
                        for month in months_in_year:
                            month_name = datetime(2000, month, 1).strftime("%B")
                            with TabPane(month_name, id=f"month_{year}_{month}"):
                                yield Vertical(
                                    Static("Category breakdown", classes="table_title"),
                                    DataTable(id=f"category_breakdown_{year}_{month}", zebra_stripes=True),
                                    classes="single_month_container"
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



    def update_all_year_category_view(self, year: int):
        """Populates the table in the 'All Year' tab."""
        table = self.query_one(f"#category_breakdown_{year}_all", DataTable)
        table.clear(columns=True)
        table.add_columns("Category", "Amount")

        year_df = self.transactions[self.transactions["Date"].dt.year == year]
        if not year_df.empty:
            category_summary = year_df.groupby("Category")["Amount"].sum().reset_index()
            category_summary = category_summary.sort_values(by="Amount", ascending=False)
            for _, row in category_summary.iterrows():
                table.add_row(row["Category"], f"{row['Amount']:,.2f}")
            total = category_summary["Amount"].sum()
            table.add_row("[bold]Total[/bold]", f"[bold]{total:,.2f}[/bold]")



    def update_month_view(self, year: int, month: int):
        """Populates the left-hand table with a monthly category breakdown."""
        category_table = self.query_one(f"#category_breakdown_{year}_{month}", DataTable)
        category_table.clear(columns=True)
        category_table.add_columns("Category", "Amount")
        month_df = self.transactions[(self.transactions["Date"].dt.year == year) & (self.transactions["Date"].dt.month == month)]

        if not month_df.empty:
            category_summary = month_df.groupby("Category")["Amount"].sum().reset_index()
            category_summary = category_summary.sort_values(by="Amount", ascending=False)
            for _, row in category_summary.iterrows():
                category_table.add_row(row["Category"], f"{row['Amount']:,.2f}")
            total = category_summary["Amount"].sum()
            category_table.add_row("[bold]Total[/bold]", f"[bold]{total:,.2f}[/bold]")

        title_widget = self.query_one(f"#month_{year}_{month} .table_title", Static)
        title_widget.update("Category breakdown")

    def _populate_monthly_breakdown(self, table: DataTable, year: int):
        """Helper function to populate a table with monthly breakdown data, with categories as rows."""
        table.clear(columns=True)
        year_df = self.transactions[self.transactions["Date"].dt.year == year]

        if not year_df.empty:
            # Pivot to get categories as rows and months as columns
            monthly_summary = year_df.pivot_table(
                index='Category',
                columns=year_df['Date'].dt.month,
                values='Amount',
                aggfunc='sum',
                fill_value=0
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
            monthly_summary['Total'] = monthly_summary.sum(axis=1)

            # Add an 'Average' column
            monthly_summary['Average'] = monthly_summary['Total'] / 12

            # Sort by total in descending order
            monthly_summary = monthly_summary.sort_values(by='Total', ascending=False)

            # Add a 'Total' row for the sum of each month
            month_columns = list(month_map.values())
            total_row_data = monthly_summary[month_columns].sum() # Sum only month columns
            total_row_data['Total'] = total_row_data.sum() # Calculate total of totals
            total_row_data['Average'] = total_row_data['Total'] / 12 # Calculate average of totals
            total_row_data.name = "[bold]Total[/bold]"

            # Set up table columns
            columns = ["Category", "Total", "Average"] + month_columns
            table.add_columns(*columns)

            # Add the 'Total' row first
            total_row_values = [total_row_data['Total'], total_row_data['Average']] + [total_row_data[col] for col in month_columns]
            table.add_row(
                total_row_data.name,
                *[f"[bold]{val:,.2f}[/bold]" for val in total_row_values]
            )

            # Add the data for each category
            category_data = monthly_summary
            for category_name, row in category_data.iterrows():
                row_values = [row['Total'], row['Average']] + [row[col] for col in month_columns]
                table.add_row(
                    category_name,
                    *[f"{val:,.2f}" for val in row_values]
                )

    def update_all_year_monthly_view(self, year: int):
        """Populates the right-hand table in the 'All Year' tab."""
        try:
            table = self.query_one(f"#monthly_breakdown_{year}_all", DataTable)
            self._populate_monthly_breakdown(table, year)
        except Exception:
            pass # Table might not exist yet

    def on_data_table_cell_selected(self, event: DataTable.CellSelected) -> None:
        """Handle cell selection to navigate to the transaction screen."""
        # Get the year from the active year tab
        year_tabs = self.query_one("#year_tabs", TabbedContent)
        year = int(year_tabs.active.split("_")[1])

        # Get the month from the active month tab
        month_tabs_id = f"#month_tabs_{year}"
        month_tabs = self.query_one(month_tabs_id, TabbedContent)
        active_month_pane_id = month_tabs.active.split("_")
        
        month = None
        if active_month_pane_id[-1] != "all":
            month = int(active_month_pane_id[-1])

        # Get the category from the selected row
        table = event.data_table
        row_key = event.cell_key.row_key
        category = str(table.get_row(row_key)[0])

        # Don't navigate if the user clicks the total row
        if "Total" in category:
            return

        # Navigate to the transaction screen with the filters
        self.app.push_screen(
            self.app.SCREENS["transactions"](
                category=category,
                year=year,
                month=month
            )
        )

