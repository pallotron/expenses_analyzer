import logging
import webbrowser

from textual.app import ComposeResult
from textual.widgets import Static, Button, DataTable
from textual.containers import Vertical, VerticalScroll
from textual.timer import Timer
from textual.worker import Worker, WorkerState

import pandas as pd
import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import (
    ItemPublicTokenExchangeRequest,
)

from expenses.screens.base_screen import BaseScreen
from expenses.config import PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV
from expenses.plaid_handler import (
    save_plaid_item,
    load_plaid_items,
    fetch_transactions,
    convert_plaid_transactions_to_dataframe,
    update_plaid_item_cursor,
)
from expenses.data_handler import append_transactions
from expenses.plaid_oauth_server import (
    run_oauth_server,
    get_public_token,
    set_link_token,
)


class PlaidScreen(BaseScreen):
    """A screen for Plaid integration to link bank accounts."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.link_token: str | None = None
        self.plaid_client: plaid_api.PlaidApi | None = None
        self.token_check_timer: Timer | None = None
        self.pending_transactions: pd.DataFrame | None = None
        self.pending_cursor: str | None = None
        self.pending_item_id: str | None = None

    def compose_content(self) -> ComposeResult:
        yield Vertical(
            Static("Plaid Integration", classes="title"),
            Static(
                "Link your bank account to automatically import transactions.",
                classes="label",
            ),
            Button("Generate Plaid Link", id="generate_link_button"),
            Button("Sync Transactions", id="sync_transactions_button"),
            Static(
                "After you log in with your bank, the token will be retrieved automatically.",
                id="token_info",
                classes="label",
            ),
            Static("", id="sync_status", classes="label"),
            VerticalScroll(
                Static("Transaction Preview:", classes="label", id="preview_label"),
                DataTable(id="transaction_preview", cursor_type="row"),
                Button("Import These Transactions", id="import_button", disabled=True),
                id="preview_section",
            ),
            id="plaid_dialog",
        )

    def on_mount(self) -> None:
        """Initialize Plaid client and set initial button visibility."""
        self._initialize_plaid_client()
        self.query_one("#token_info").display = False
        self.query_one("#sync_status").display = False
        self.query_one("#preview_section").display = False

        plaid_items = load_plaid_items()
        if plaid_items:
            self.query_one("#generate_link_button").display = False
            self.query_one("#sync_transactions_button").display = True
        else:
            self.query_one("#generate_link_button").display = True
            self.query_one("#sync_transactions_button").display = False

    def on_unmount(self) -> None:
        """Stop the token check timer when the screen is closed."""
        if self.token_check_timer:
            self.token_check_timer.stop()

    def _initialize_plaid_client(self) -> None:
        """Initializes the Plaid client."""
        if not PLAID_CLIENT_ID or not PLAID_SECRET:
            self.app.show_notification(
                "Plaid API keys not set. Please set PLAID_CLIENT_ID and PLAID_SECRET environment variables.",
                timeout=10,
            )
            logging.error("Plaid API keys not found.")
            return

        host = getattr(plaid.Environment, PLAID_ENV.capitalize())
        configuration = plaid.Configuration(
            host=host,
            api_key={
                "clientId": PLAID_CLIENT_ID,
                "secret": PLAID_SECRET,
            },
        )
        api_client = plaid.ApiClient(configuration)
        self.plaid_client = plaid_api.PlaidApi(api_client)
        logging.info(f"Plaid client initialized for environment: {PLAID_ENV}")

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "generate_link_button":
            await self._generate_link_token()
        elif event.button.id == "sync_transactions_button":
            self._sync_transactions()
        elif event.button.id == "import_button":
            self._import_transactions()

    async def _generate_link_token(self) -> None:
        """Generates a Plaid Link token, starts the callback server, and opens the URL."""
        if not self.plaid_client:
            self.app.show_notification("Plaid client not initialized.", timeout=5)
            return

        try:
            run_oauth_server()

            request = LinkTokenCreateRequest(
                user=LinkTokenCreateRequestUser(client_user_id="user-id"),
                client_name="Expenses Analyzer",
                products=[Products("transactions")],
                country_codes=[
                    CountryCode("US"),
                    CountryCode("IE"),
                    CountryCode("GB"),
                    CountryCode("ES"),
                    CountryCode("FR"),
                    CountryCode("DE"),
                    CountryCode("NL"),
                ],
                language="en",
                redirect_uri="http://localhost:3000/oauth-callback",
            )
            response = self.plaid_client.link_token_create(request)
            self.link_token = response["link_token"]

            # Store the link token for OAuth reinitialization
            set_link_token(self.link_token)

            link_url = f"https://cdn.plaid.com/link/v2/stable/link.html?token={self.link_token}"

            webbrowser.open(link_url)
            self.query_one("#generate_link_button").display = False
            self.query_one("#token_info").display = True
            self.app.show_notification(
                "Plaid Link opened in browser. Please complete the login.", timeout=5
            )

            self.token_check_timer = self.set_interval(1, self.check_for_token)

        except Exception as e:
            logging.error(f"Error generating Plaid Link token: {e}")
            self.app.show_notification(f"Error generating Plaid Link: {e}", timeout=10)

    async def check_for_token(self) -> None:
        """Periodically check if the public token or OAuth state ID has been received."""
        public_token = get_public_token()
        if public_token:
            if self.token_check_timer:
                self.token_check_timer.stop()
            logging.info("Public token retrieved from callback server.")
            await self._exchange_public_token(public_token)
            return

        # The OAuth reinitialization is now handled automatically by the callback HTML page

    async def _exchange_public_token(self, public_token: str) -> None:
        """Exchanges the public token for an access token and saves it."""
        if not self.plaid_client:
            self.app.show_notification("Plaid client not initialized.", timeout=5)
            return

        try:
            request = ItemPublicTokenExchangeRequest(public_token=public_token)
            response = self.plaid_client.item_public_token_exchange(request)
            access_token = response["access_token"]
            item_id = response["item_id"]

            institution_name = "Linked Bank Account"

            plaid_item = {
                "item_id": item_id,
                "access_token": access_token,
                "institution_name": institution_name,
            }
            save_plaid_item(plaid_item)

            self.app.show_notification(
                f"Successfully linked {institution_name}!", timeout=5
            )
            logging.debug(f"Successfully exchanged public token for item_id: {item_id}")

            # Update button visibility to show Sync button instead of Generate Link
            self.query_one("#generate_link_button").display = False
            self.query_one("#sync_transactions_button").display = True
            self.query_one("#token_info").display = False

        except Exception as e:
            logging.error(f"Error exchanging public token: {e}")
            self.app.show_notification(
                f"Error exchanging public token: {e}", timeout=10
            )

    def _sync_transactions(self) -> None:
        """Fetch and store transactions for all linked Plaid items."""
        self.query_one("#sync_status").display = True
        self.query_one("#sync_status").update("Syncing transactions...")
        self.app.show_notification("Starting transaction sync...", timeout=5)
        self.run_worker(self._sync_transactions_worker, exclusive=True, thread=True)

    def _sync_transactions_worker(
        self,
    ) -> tuple[pd.DataFrame | None, str | None, str | None, str | None]:
        """The actual transaction syncing logic, run in a background thread.

        Returns:
            A tuple of (transactions_df, new_cursor, item_id, error_message)
        """
        plaid_items = load_plaid_items()

        if not plaid_items:
            return (None, None, None, "No Plaid accounts linked")

        # For simplicity, just sync the first item
        item = plaid_items[0]
        item_id = item.get("item_id")
        access_token = item.get("access_token")
        cursor = item.get("transactions_cursor")

        try:
            transactions = fetch_transactions(access_token, cursor)
            if transactions:
                df = convert_plaid_transactions_to_dataframe(transactions)
                new_cursor = transactions.get("cursor")
                return (df, new_cursor, item_id, None)
            else:
                return (None, None, item_id, "No transactions fetched")

        except Exception as e:
            logging.error(f"Error syncing transactions for item {item_id}: {e}")
            return (None, None, item_id, f"Error syncing transactions: {e}")

    def on_worker_state_changed(self, event: Worker.StateChanged) -> None:
        """Handle worker state changes."""
        if event.worker.name == "_sync_transactions_worker":
            if event.state == WorkerState.SUCCESS:
                try:
                    df, new_cursor, item_id, error_message = event.worker.result

                    if error_message:
                        self.query_one("#sync_status").update(f"Error: {error_message}")
                        self.app.show_notification(error_message, timeout=10)
                    elif df is None or len(df) == 0:
                        status_message = (
                            "No new transactions found (already up to date)."
                        )
                        self.query_one("#sync_status").update(status_message)
                        self.app.show_notification(status_message, timeout=5)
                    else:
                        # Store pending transactions for preview
                        self.pending_transactions = df
                        self.pending_cursor = new_cursor
                        self.pending_item_id = item_id

                        # Show preview
                        self._show_transaction_preview(df)
                        status_message = (
                            f"Found {len(df)} new transactions. "
                            "Review below and click Import to continue."
                        )
                        self.query_one("#sync_status").update(status_message)
                        self.app.show_notification(status_message, timeout=5)
                except Exception as e:
                    logging.error(f"Error handling worker result: {e}")
                    self.app.show_notification(
                        f"Error completing sync: {e}", timeout=10
                    )
            elif event.state == WorkerState.ERROR:
                logging.error(f"Worker failed: {event.worker.error}")
                self.query_one("#sync_status").update(
                    f"Sync failed: {event.worker.error}"
                )
                self.app.show_notification(
                    f"Sync failed: {event.worker.error}", timeout=10
                )

    def _show_transaction_preview(self, df: pd.DataFrame) -> None:
        """Display a preview of the transactions."""
        table = self.query_one("#transaction_preview", DataTable)
        table.clear(columns=True)

        # Show first 10 transactions
        preview_df = df.head(10)
        table.add_columns(*preview_df.columns.astype(str))
        for row in preview_df.itertuples(index=False, name=None):
            table.add_row(*[str(x) for x in row])

        # Show the preview section
        self.query_one("#preview_section").display = True
        self.query_one("#import_button").disabled = False

    def _import_transactions(self) -> None:
        """Import the pending transactions."""
        if self.pending_transactions is None:
            self.app.show_notification("No transactions to import", timeout=5)
            return

        try:
            # Get institution name for source tracking
            plaid_items = load_plaid_items()
            institution_name = "Plaid"
            if plaid_items and self.pending_item_id:
                for item in plaid_items:
                    if item.get("item_id") == self.pending_item_id:
                        institution_name = (
                            f"Plaid - {item.get('institution_name', 'Unknown')}"
                        )
                        break

            append_transactions(
                self.pending_transactions,
                suggest_categories=True,
                source=institution_name,
            )

            # Update cursor
            if self.pending_cursor and self.pending_item_id:
                update_plaid_item_cursor(self.pending_item_id, self.pending_cursor)

            count = len(self.pending_transactions)
            self.app.show_notification(
                f"Successfully imported {count} transactions!", timeout=5
            )
            logging.info(f"Imported {count} transactions from Plaid")

            # Clear pending data
            self.pending_transactions = None
            self.pending_cursor = None
            self.pending_item_id = None

            # Clear the preview section
            self._clear_preview()

            # Close the screen
            self.app.pop_screen()

        except Exception as e:
            logging.error(f"Error importing transactions: {e}")
            self.app.show_notification(f"Error importing transactions: {e}", timeout=10)

    def _clear_preview(self) -> None:
        """Clear the transaction preview."""
        table = self.query_one("#transaction_preview", DataTable)
        table.clear(columns=True)
        self.query_one("#preview_section").display = False
        self.query_one("#sync_status").display = False
        self.query_one("#sync_status").update("")
        self.query_one("#import_button").disabled = True
