import logging
import pandas as pd
from textual.app import ComposeResult
from textual.widgets import Button, Static, Input, DataTable, Select, Checkbox
from textual.containers import Vertical, VerticalScroll

from typing import Any
from expenses.screens.base_screen import BaseScreen
from expenses.data_handler import clean_amount, append_transactions, get_unique_sources


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
                Static(
                    "Amount Out Column (optional - for banks with separate in/out columns):"
                ),
                Select(
                    [("None - use single column", "")], id="amount_out_select", value=""
                ),
                Static("Transaction Type:"),
                Select(
                    [
                        ("Auto-detect from amount sign", "auto"),
                        ("All Expenses", "expense"),
                        ("All Income", "income"),
                    ],
                    value="auto",
                    id="type_select",
                ),
                Static("Source/Account Name (optional):"),
                Select([], id="source_select"),
                Input(
                    placeholder="Enter custom source name...",
                    id="custom_source_input",
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

        # Populate source selector with existing sources
        self._populate_source_selector()
        # Hide custom source input by default
        self.query_one("#custom_source_input").display = False

    def _populate_source_selector(self) -> None:
        """Populate the source selector with existing sources from the database."""
        existing_sources = get_unique_sources()

        # Build options: existing sources + "Custom..." option
        if existing_sources:
            options = [(source, source) for source in existing_sources]
            default_value = existing_sources[0]
        else:
            # Fallback for empty database
            options = [("CSV Import", "CSV Import")]
            default_value = "CSV Import"
        options.append(("Custom...", "__custom__"))

        source_select = self.query_one("#source_select", Select)
        source_select.set_options(options)
        source_select.value = default_value

    def on_select_changed(self, event: Select.Changed) -> None:
        """Handle source selector changes to show/hide custom input."""
        if event.select.id == "source_select":
            custom_input = self.query_one("#custom_source_input", Input)
            if event.value == "__custom__":
                custom_input.display = True
                custom_input.focus()
            else:
                custom_input.display = False
                custom_input.value = ""

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
        """Trigger import when Enter is pressed in the custom source input."""
        if event.input.id == "custom_source_input":
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

            # Amount out selector has an extra "None" option
            amount_out_options = [("None - use single column", "")] + options
            self.query_one("#amount_out_select", Select).set_options(amount_out_options)

            # Show the data sections
            self.query_one("#file_preview_label").display = True
            self.query_one("#file_preview").display = True
            self.query_one("#map_columns_label").display = True
            self.query_one("#import_button").disabled = False

        except Exception as e:
            logging.error(f"Error loading file: {e}")

    def _parse_date_smart(self, date_str: str) -> pd.Timestamp:
        """Smart date parsing that detects format automatically."""
        date_str = str(date_str).strip()

        if not date_str or len(date_str) < 8:
            return pd.NaT

        # ISO format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (starts with 4-digit year)
        if date_str[:4].isdigit() and len(date_str) > 4 and date_str[4] in ["-", "/"]:
            try:
                return pd.to_datetime(date_str, format="ISO8601", errors="raise")
            except (ValueError, TypeError):
                return pd.to_datetime(date_str, errors="coerce")

        # European format: DD/MM/YYYY or D/M/YYYY (contains / or - separator)
        if "/" in date_str or "-" in date_str:
            return pd.to_datetime(date_str, errors="coerce", dayfirst=True)

        # Unknown format, use pandas auto-detection
        return pd.to_datetime(date_str, errors="coerce")

    def _is_valid_merchant(self, merchant_val) -> bool:
        """Check if merchant value is valid."""
        return (
            merchant_val is not None
            and not pd.isna(merchant_val)
            and str(merchant_val).strip() != ""
        )

    def _should_skip_paypal_row(self, row) -> bool:
        """Check if PayPal row should be skipped based on Balance Impact."""
        return "Balance Impact" in self.df.columns and row["Balance Impact"] != "Debit"

    def _process_row(
        self,
        index,
        row,
        date_col,
        merchant_col,
        amount_col,
        type_mode,
        skip_counts,
        amount_out_col=None,
    ):
        """Process a single row from the CSV.

        If amount_out_col is provided (dual-column mode), the amount_col is treated
        as "money in" (income) and amount_out_col as "money out" (expenses).
        """
        logging.debug(f"Processing row {index}")
        logging.debug(f"Raw row data: {row.to_dict()}")

        # Parse date
        date_val = self._parse_date_smart(row[date_col])
        if pd.isna(date_val):
            skip_counts["invalid_date"] += 1
            logging.debug(f"Row {index}: Skipping - invalid date '{row[date_col]}'")
            return None

        # Validate merchant
        if not self._is_valid_merchant(row[merchant_col]):
            skip_counts["empty_merchant"] += 1
            logging.debug(f"Row {index}: Skipping - empty merchant")
            return None

        # Parse amount - handle dual-column mode
        if amount_out_col:
            # Dual-column mode: separate columns for money in/out
            amount_in_val = clean_amount(pd.Series([row[amount_col]]))[0]
            amount_out_val = clean_amount(pd.Series([row[amount_out_col]]))[0]
            logging.debug(
                f"Row {index}: Dual-column - in: {amount_in_val}, out: {amount_out_val}"
            )

            # Determine which column has the value
            has_income = amount_in_val != 0
            has_expense = amount_out_val != 0

            if has_income and has_expense:
                # Both columns have values - unusual, log warning and use the larger absolute value
                logging.warning(
                    f"Row {index}: Both in/out columns have values, using larger absolute value"
                )
                if abs(amount_in_val) >= abs(amount_out_val):
                    amount_val = abs(amount_in_val)
                    transaction_type = "income"
                else:
                    amount_val = abs(amount_out_val)
                    transaction_type = "expense"
            elif has_income:
                amount_val = abs(amount_in_val)
                transaction_type = "income"
            elif has_expense:
                amount_val = abs(amount_out_val)
                transaction_type = "expense"
            else:
                # Neither column has a value
                skip_counts["zero_amount"] += 1
                logging.debug(f"Row {index}: Skipping - zero amount in both columns")
                return None
        else:
            # Single-column mode (original behavior)
            amount_val = clean_amount(pd.Series([row[amount_col]]))[0]
            logging.debug(f"Row {index}: Cleaned amount: {amount_val}")

            # Skip zero amounts
            if amount_val == 0:
                skip_counts["zero_amount"] += 1
                logging.debug(f"Row {index}: Skipping - zero amount")
                return None

            # Determine transaction type
            if type_mode == "expense":
                transaction_type = "expense"
            elif type_mode == "income":
                transaction_type = "income"
            else:  # auto-detect
                # Negative amounts are expenses, positive are income
                transaction_type = "expense" if amount_val < 0 else "income"

            amount_val = abs(amount_val)

        # Special PayPal check - only for auto mode with expenses (single-column only)
        if (
            not amount_out_col
            and type_mode == "auto"
            and self._should_skip_paypal_row(row)
        ):
            skip_counts["not_debit"] += 1
            logging.debug(f"Row {index}: Skipping - not a debit transaction")
            return None

        # Successfully processed
        logging.debug(
            f"Row {index}: Successfully processed {transaction_type} transaction"
        )
        return {
            "Date": date_val,
            "Merchant": str(row[merchant_col]),
            "Amount": amount_val,
            "Type": transaction_type,
        }

    def _log_import_summary(self, total_processed, total_imported, skip_counts):
        """Log summary statistics for the import."""
        total_skipped = sum(skip_counts.values())
        logging.info(
            f"CSV import complete: {total_imported} transactions imported, "
            f"{total_skipped} rows skipped (of {total_processed} total)"
        )

        if total_skipped > 0:
            skip_details = ", ".join(
                [
                    f"{count} {reason}"
                    for reason, count in skip_counts.items()
                    if count > 0
                ]
            )
            logging.info(f"Skip breakdown: {skip_details}")

    def import_data(self) -> None:
        """Process and import the transactions from the mapped columns."""
        if self.df is None:
            return

        try:
            date_col = self.query_one("#date_select", Select).value
            merchant_col = self.query_one("#merchant_select", Select).value
            amount_col = self.query_one("#amount_select", Select).value
            amount_out_val = self.query_one("#amount_out_select", Select).value
            amount_out_col = (
                amount_out_val
                if amount_out_val and amount_out_val != Select.BLANK
                else None
            )
            type_mode = self.query_one("#type_select", Select).value
            suggest_categories = self.query_one(
                "#suggest_categories_checkbox", Checkbox
            ).value

            # Get source from selector or custom input
            source_select_value = self.query_one("#source_select", Select).value
            if source_select_value == "__custom__":
                source = (
                    self.query_one("#custom_source_input", Input).value or "CSV Import"
                )
            else:
                source = source_select_value or "CSV Import"

            transactions_to_append = []
            skip_counts = {
                "invalid_date": 0,
                "empty_merchant": 0,
                "zero_amount": 0,
                "not_debit": 0,
            }

            if amount_out_col:
                logging.info(
                    f"Starting CSV import with dual-column mode (in: {amount_col}, out: {amount_out_col})..."
                )
            else:
                logging.info(f"Starting CSV import with type mode: {type_mode}...")

            # Process each row
            for index, row in self.df.iterrows():
                transaction = self._process_row(
                    index,
                    row,
                    date_col,
                    merchant_col,
                    amount_col,
                    type_mode,
                    skip_counts,
                    amount_out_col,
                )
                if transaction:
                    transactions_to_append.append(transaction)

            # Log summary
            self._log_import_summary(
                len(self.df), len(transactions_to_append), skip_counts
            )

            # Import transactions
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
