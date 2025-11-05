import logging
import pandas as pd
from textual.app import ComposeResult
from textual.widgets import Button, Static, Input, DataTable, Select, Checkbox
from textual.containers import Vertical, VerticalScroll

from typing import Any
from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import clean_amount, append_transactions


class ImportScreen(BaseScreen):
    """A screen for importing and mapping CSV data."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.file_path: str | None = None
        self.df: pd.DataFrame | None = None

    def compose_content(self) -> ComposeResult:
        yield Vertical(
            Static("Import CSV File", classes="title"),
            VerticalScroll(
                Static("CSV File Path:"),
                Input(
                    placeholder="Press 'Browse' to select a file...",
                    id="file_path_input",
                    disabled=True,
                ),
                Button("Browse", id="browse_button"),
                Static("File Preview:", classes="label", id="file_preview_label"),
                DataTable(id="file_preview", cursor_type="row"),
                Static("Map Columns:", classes="label", id="map_columns_label"),
                Static("Date Column:"),
                Select([], id="date_select"),
                Static("Merchant Column:"),
                Select([], id="merchant_select"),
                Checkbox(
                    "Suggest categories for new merchants with AI",
                    id="suggest_categories_checkbox",
                ),
                Static("Amount Column:"),
                Select([], id="amount_select"),
                Static("Source/Account Name (optional):"),
                Input(
                    placeholder="e.g., 'Chase Checking' or 'CSV Import'",
                    id="source_input",
                    value="CSV Import",
                ),
                Button("Import Transactions", id="import_button", disabled=True),
            ),
            id="import_dialog",
        )

    def on_mount(self) -> None:
        """Hide the data sections until a file is loaded."""
        self.query_one("#file_preview_label").display = False
        self.query_one("#file_preview").display = False
        self.query_one("#map_columns_label").display = False

    def handle_file_select(self, path: str) -> None:
        """Callback for when a file is selected in the browser."""
        if path:
            self.file_path = path
            self.query_one("#file_path_input", Input).value = path
            # Schedule the preview to load after the event loop has settled
            self.call_later(self.load_and_preview_csv)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "browse_button":
            self.app.push_screen("file_browser", self.handle_file_select)
        elif event.button.id == "import_button":
            self.import_data()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Trigger import when Enter is pressed in the source input."""
        if event.input.id == "source_input":
            import_button = self.query_one("#import_button", Button)
            if not import_button.disabled:
                self.import_data()

    def load_and_preview_csv(self) -> None:
        """Load the selected CSV, display a preview, and populate column selectors."""
        if not self.file_path:
            return

        try:
            self.df = pd.read_csv(self.file_path)
            preview_df = self.df.head(5)
            table = self.query_one("#file_preview", DataTable)
            table.clear(columns=True)

            # Display preview
            table.add_columns(*preview_df.columns.astype(str))
            for row in preview_df.itertuples(index=False, name=None):
                table.add_row(*[str(x) for x in row])

            # Populate select widgets
            columns = self.df.columns.tolist()
            options = [(col, col) for col in columns]
            for select_id in ["date_select", "merchant_select", "amount_select"]:
                select = self.query_one(f"#{select_id}", Select)
                select.set_options(options)

            # Show the data sections
            self.query_one("#file_preview_label").display = True
            self.query_one("#file_preview").display = True
            self.query_one("#map_columns_label").display = True
            self.query_one("#import_button").disabled = False

        except Exception as e:
            logging.error(f"Error loading file: {e}")

    def import_data(self) -> None:
        """Process and import the transactions from the mapped columns."""
        if self.df is None:
            return

        try:
            date_col = self.query_one("#date_select", Select).value
            merchant_col = self.query_one("#merchant_select", Select).value
            amount_col = self.query_one("#amount_select", Select).value
            suggest_categories = self.query_one(
                "#suggest_categories_checkbox", Checkbox
            ).value
            source = self.query_one("#source_input", Input).value or "CSV Import"

            transactions_to_append = []
            skip_counts = {
                "invalid_date": 0,
                "empty_merchant": 0,
                "not_expense": 0,
                "not_debit": 0,
            }
            logging.info("Starting CSV import...")

            for index, row in self.df.iterrows():
                logging.debug(f"Processing row {index}")
                logging.debug(f"Raw row data: {row.to_dict()}")

                # --- Date Parsing ---
                # Smart date parsing that detects format automatically
                date_str = str(row[date_col]).strip()
                date_val = pd.NaT

                # Detect format based on date string pattern:
                # - ISO format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (starts with 4-digit year)
                # - European format: DD/MM/YYYY or D/M/YYYY (contains / or - separator)
                if date_str and len(date_str) >= 8:
                    if date_str[:4].isdigit() and len(date_str) > 4 and date_str[4] in ['-', '/']:
                        # ISO format (YYYY-MM-DD): Parse without dayfirst to avoid month/day swap
                        try:
                            date_val = pd.to_datetime(date_str, format="ISO8601", errors="raise")
                        except (ValueError, TypeError):
                            date_val = pd.to_datetime(date_str, errors="coerce")
                    elif '/' in date_str or '-' in date_str:
                        # European format (DD/MM/YYYY): Use dayfirst=True
                        date_val = pd.to_datetime(date_str, errors="coerce", dayfirst=True)
                    else:
                        # Unknown format, use pandas auto-detection
                        date_val = pd.to_datetime(date_str, errors="coerce")

                if pd.isna(date_val):
                    skip_counts["invalid_date"] += 1
                    logging.debug(
                        f"Row {index}: Skipping - invalid date '{row[date_col]}'"
                    )
                    continue

                # --- Merchant Parsing ---
                merchant_val = row[merchant_col]
                if (
                    not merchant_val
                    or pd.isna(merchant_val)
                    or str(merchant_val).strip() == ""
                ):
                    skip_counts["empty_merchant"] += 1
                    logging.debug(f"Row {index}: Skipping - empty merchant")
                    continue

                # --- Amount Parsing ---
                amount_val = clean_amount(pd.Series([row[amount_col]]))[0]
                logging.debug(f"Row {index}: Cleaned amount: {amount_val}")

                # --- Expense Filtering ---
                if amount_val >= 0:
                    skip_counts["not_expense"] += 1
                    logging.debug(
                        f"Row {index}: Skipping - not an expense (amount >= 0)"
                    )
                    continue

                # --- Special PayPal Debit Check ---
                if (
                    "Balance Impact" in self.df.columns
                    and row["Balance Impact"] != "Debit"
                ):
                    skip_counts["not_debit"] += 1
                    logging.debug(f"Row {index}: Skipping - not a debit transaction")
                    continue

                # --- Add to list ---
                final_amount = abs(amount_val)
                transaction = {
                    "Date": date_val,
                    "Merchant": str(merchant_val),
                    "Amount": final_amount,
                }
                transactions_to_append.append(transaction)
                logging.debug(f"Row {index}: Successfully processed transaction")

            # Log summary statistics
            total_processed = len(self.df)
            total_imported = len(transactions_to_append)
            total_skipped = sum(skip_counts.values())

            logging.info(
                f"CSV import complete: {total_imported} transactions imported, "
                f"{total_skipped} rows skipped (of {total_processed} total)"
            )

            # Log skip reasons if any
            if total_skipped > 0:
                skip_details = ", ".join(
                    [
                        f"{count} {reason}"
                        for reason, count in skip_counts.items()
                        if count > 0
                    ]
                )
                logging.info(f"Skip breakdown: {skip_details}")

            if transactions_to_append:
                processed_df = pd.DataFrame(transactions_to_append)
                append_transactions(
                    processed_df, suggest_categories=suggest_categories, source=source
                )
            else:
                logging.warning("No valid transactions found to import")

            self.app.pop_screen()

        except Exception as e:
            logging.error(f"Error during data import: {e}")
