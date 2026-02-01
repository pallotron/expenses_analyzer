import logging
import webbrowser
import time
import urllib.parse

from textual.app import ComposeResult
from textual.widgets import Static, Button, DataTable, Checkbox
from textual.containers import Vertical, VerticalScroll, Container, Horizontal
from textual.timer import Timer
from textual.worker import Worker, WorkerState

import pandas as pd

from expenses.screens.base_screen import BaseScreen
from expenses.config import (
    TRUELAYER_CLIENT_ID,
    TRUELAYER_CLIENT_SECRET,
    TRUELAYER_ENV,
    TRUELAYER_SCOPES,
    TRUELAYER_PROVIDERS,
)
from expenses.truelayer_handler import (
    save_truelayer_connection,
    load_truelayer_connections,
    exchange_code_for_token,
    process_and_store_transactions,
    update_connection_last_sync,
    get_provider_name,
    get_accounts,
    _get_auth_base_url,
    get_valid_access_token,
    ScaExceededError,
    remove_truelayer_connection,
)
from expenses.screens.manage_truelayer_connections_screen import (
    ManageTrueLayerConnectionsScreen,
)
from expenses.oauth_server import (
    run_oauth_server,
    get_truelayer_auth_code,
    check_for_truelayer_code,
)


class TrueLayerScreen(BaseScreen):
    """A screen for TrueLayer integration to link bank accounts."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.code_check_timer: Timer | None = None
        self.pending_transactions: pd.DataFrame | None = None
        self.pending_connection_id: str | None = None
        self.pending_provider_name: str | None = None
        self.redirect_uri = "http://localhost:3000/truelayer-callback"
        self.accounts_list: list = []  # Store available accounts
        self.account_checkboxes: dict = {}  # Map account_id to checkbox widget

    def compose_content(self) -> ComposeResult:
        """Compose the screen with a new two-column layout."""
        yield Vertical(
            Static("Link Banks", classes="title"),
            Static(
                "Connect your bank accounts to automatically import transactions.",
                classes="label",
            ),
            # This container will hold the two main columns
            Horizontal(
                # --- Left Column: Connections ---
                Vertical(
                    Static("Connections", classes="table_title"),
                    VerticalScroll(id="connections_list"),
                    Button("Manage Connections", id="manage_connections_button"),
                    Container(
                        Button("Connect Bank Account", id="connect_button"),
                        id="no_connections_container",
                    ),
                    classes="column",
                    id="left_column",
                ),
                # --- Right Column: Accounts & Syncing ---
                Vertical(
                    Static("Available Accounts", classes="table_title"),
                    VerticalScroll(
                        Container(id="accounts_container"),
                    ),
                    Horizontal(
                        Button("Sync Selected Accounts", id="sync_transactions_button"),
                        Button("Force Resync", id="force_resync_button"),
                        classes="horizontal_buttons",
                    ),
                    classes="column",
                    id="right_column",
                ),
                id="main_horizontal_layout",
            ),
            # --- Bottom Section: Status & Preview ---
            Static("", id="sync_status", classes="label"),
            Container(
                Static(
                    "Transaction Preview", classes="table_title", id="preview_title"
                ),
                Static("", id="preview_summary", classes="label"),
                VerticalScroll(
                    DataTable(id="transaction_preview", cursor_type="row"),
                    classes="preview_scroll",
                ),
                Horizontal(
                    Button(
                        "Import These Transactions", id="import_button", disabled=True
                    ),
                    Button("Cancel", id="cancel_preview_button"),
                    classes="horizontal_buttons",
                ),
                id="preview_section",
            ),
            id="truelayer_dialog",
        )

    def on_mount(self) -> None:
        """Initialize and set initial button visibility."""
        self._check_credentials()
        self.query_one("#sync_status").display = False
        self.query_one("#preview_section").display = False
        self._update_connections_view()

    def on_unmount(self) -> None:
        """Stop the code check timer when the screen is closed."""
        if self.code_check_timer:
            self.code_check_timer.stop()

    def _check_credentials(self) -> None:
        """Checks if TrueLayer credentials are configured."""
        if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
            self.app.show_notification(
                "TrueLayer credentials not set. Please set TRUELAYER_CLIENT_ID and "
                "TRUELAYER_CLIENT_SECRET environment variables.",
                timeout=10,
            )
            logging.error("TrueLayer credentials not found.")
        else:
            logging.info(
                f"TrueLayer configured with client_id: {TRUELAYER_CLIENT_ID[:20]}..."
            )
            logging.info(f"TrueLayer environment: {TRUELAYER_ENV}")
            logging.info(f"TrueLayer redirect URI: {self.redirect_uri}")

    def _update_connections_view(self) -> None:
        """Update the visibility of UI sections based on connections."""
        connections = load_truelayer_connections()
        no_connections_container = self.query_one("#no_connections_container")
        right_column = self.query_one("#right_column")
        manage_button = self.query_one("#manage_connections_button")

        if not connections:
            no_connections_container.display = True
            right_column.display = False
            manage_button.display = False
            self.query_one("#connections_list").remove_children()
            self.query_one("#connections_list").mount(
                Static("No bank accounts connected.", classes="label")
            )
        else:
            no_connections_container.display = False
            right_column.display = True
            manage_button.display = True
            self._load_accounts()

    def _load_accounts(self) -> None:
        """Load available accounts from all connections and display them."""
        connections = load_truelayer_connections()
        connections_list_container = self.query_one("#connections_list")
        accounts_container = self.query_one("#accounts_container")

        # Clear existing checkboxes tracking
        self.account_checkboxes = {}
        self.accounts_list = []

        # Remove all children from both containers
        connections_list_container.remove_children()
        accounts_container.remove_children()

        if not connections:
            return

        for connection in connections:
            provider_name = connection.get("provider_name", "Unknown")
            connections_list_container.mount(
                Static(f"✓ {provider_name}", classes="connection_item")
            )

            try:
                access_token = get_valid_access_token(connection)
                if not access_token:
                    self._handle_reauthentication_required(
                        connection.get("connection_id")
                    )
                    continue

                accounts = get_accounts(access_token)
                if not accounts:
                    continue

                self.accounts_list.extend(accounts)

                for account in accounts:
                    account_id = account.get("account_id")
                    display_name = account.get("display_name", "Unknown Account")
                    currency = account.get("currency", "")

                    # Include currency in label for multi-currency accounts (e.g., Revolut)
                    if currency:
                        label = f"{provider_name} - {display_name} ({currency})"
                    else:
                        label = f"{provider_name} - {display_name}"

                    # Create checkbox without ID to avoid conflicts
                    # Store account_id separately for later reference
                    checkbox = Checkbox(label, value=True)
                    checkbox._account_id = account_id  # Store as custom attribute
                    self.account_checkboxes[account_id] = checkbox
                    accounts_container.mount(checkbox)

            except ScaExceededError:
                self._handle_reauthentication_required(connection.get("connection_id"))
                continue

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "connect_button":
            await self._start_oauth_flow()
        elif event.button.id == "manage_connections_button":
            self.app.push_screen(
                ManageTrueLayerConnectionsScreen(),
                self._handle_manage_connections_result,
            )
        elif event.button.id == "sync_transactions_button":
            self._sync_transactions()
        elif event.button.id == "force_resync_button":
            self._sync_transactions(force_resync=True)
        elif event.button.id == "import_button":
            self._import_transactions()
        elif event.button.id == "cancel_preview_button":
            self._clear_preview()

    async def _handle_manage_connections_result(self, result) -> None:
        """Handle the result from the manage connections screen."""
        action, _ = result
        if action == "add":
            await self._start_oauth_flow()
        else:
            self._update_connections_view()

    async def _start_oauth_flow(self) -> None:
        """Starts the TrueLayer OAuth flow."""
        if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
            self.app.show_notification(
                "TrueLayer credentials not configured.", timeout=5
            )
            return

        try:
            run_oauth_server()
            auth_base_url = _get_auth_base_url()
            scopes = TRUELAYER_SCOPES
            params = {
                "response_type": "code",
                "client_id": TRUELAYER_CLIENT_ID,
                "scope": scopes,
                "redirect_uri": self.redirect_uri,
            }
            if TRUELAYER_PROVIDERS:
                params["providers"] = TRUELAYER_PROVIDERS
            elif TRUELAYER_ENV == "sandbox":
                params["providers"] = "uk-cs-mock uk-ob-all uk-oauth-all"
            else:
                params["providers"] = "uk-ob-all uk-oauth-all ie-ob-all"

            auth_url = f"{auth_base_url}/?{urllib.parse.urlencode(params)}"
            webbrowser.open(auth_url)
            self.app.show_notification(
                "Browser opened for TrueLayer authentication.", timeout=5
            )
            self.code_check_timer = self.set_interval(1, self.check_for_auth_code)

        except Exception as e:
            logging.error(f"Error starting TrueLayer OAuth flow: {e}")
            self.app.show_notification(f"Error starting OAuth flow: {e}", timeout=10)

    def _handle_reauthentication_required(
        self, connection_id_to_remove: str | None = None
    ):
        """Handles the UI changes required for re-authentication."""
        if connection_id_to_remove:
            remove_truelayer_connection(connection_id_to_remove)
            self._update_connections_view()
            self.app.show_notification(
                "Permissions expired. Please reconnect your bank account.", timeout=10
            )
        else:
            logging.error("Cannot reauthenticate: connection_id_to_remove is None.")
            self.app.show_notification(
                "Permissions expired. Please reconnect your bank account.", timeout=10
            )

    async def check_for_auth_code(self) -> None:
        """Periodically check if the authorization code has been received."""
        if check_for_truelayer_code():
            if self.code_check_timer:
                self.code_check_timer.stop()

            auth_code = get_truelayer_auth_code()
            if auth_code:
                logging.info("Authorization code retrieved from callback server.")
                await self._exchange_auth_code(auth_code)

    async def _exchange_auth_code(self, code: str) -> None:
        """Exchanges the authorization code for access and refresh tokens."""
        try:
            token_data = exchange_code_for_token(code, self.redirect_uri)

            if not token_data:
                self.app.show_notification(
                    "Error exchanging authorization code for token.", timeout=10
                )
                return

            access_token = token_data["access_token"]
            provider_name = get_provider_name(access_token)

            connection = {
                "connection_id": f"tl_{int(time.time())}",
                "access_token": access_token,
                "refresh_token": token_data.get("refresh_token"),
                "token_obtained_at": token_data.get("token_obtained_at"),
                "expires_in": token_data.get("expires_in", 3600),
                "provider_id": "truelayer",
                "provider_name": provider_name,
            }

            save_truelayer_connection(connection)
            self.app.show_notification(
                f"Successfully connected to {provider_name}!", timeout=5
            )
            self._update_connections_view()

        except ScaExceededError as e:
            logging.error(f"SCA error after exchanging code: {e}")
            self._handle_reauthentication_required()
        except Exception as e:
            logging.error(f"Error exchanging authorization code: {e}")
            self.app.show_notification(
                f"Error exchanging authorization code: {e}", timeout=10
            )

    def _sync_transactions(self, force_resync: bool = False) -> None:
        """Fetch and store transactions for selected accounts."""
        selected_account_ids = [
            acc_id
            for acc_id, checkbox in self.account_checkboxes.items()
            if checkbox.value
        ]

        if not selected_account_ids:
            self.app.show_notification("No accounts selected.", timeout=5)
            return

        self.query_one("#sync_status").display = True
        self.query_one("#sync_status").update("Syncing transactions...")
        self.run_worker(
            lambda: self._sync_transactions_worker(selected_account_ids, force_resync),
            exclusive=True,
            thread=True,
            name="_sync_transactions_worker",
        )

    def _determine_sync_from_date(
        self, connection: dict, force_resync: bool
    ) -> str | None:
        """Determine the start date for transaction sync based on last sync."""
        if force_resync:
            return None
        last_sync = connection.get("last_sync")
        if last_sync:
            return last_sync.split("T")[0]
        return None

    def _process_connection(
        self, connection: dict, selected_account_ids: list, force_resync: bool
    ):
        """Process a single TrueLayer connection and return transactions."""
        access_token = get_valid_access_token(connection)
        if not access_token:
            return None, "Failed to get valid access token."

        provider_name = connection.get("provider_name", "TrueLayer")
        from_date = self._determine_sync_from_date(connection, force_resync)

        all_accounts = get_accounts(access_token)
        selected_accounts = [
            acc for acc in all_accounts if acc.get("account_id") in selected_account_ids
        ]

        if not selected_accounts:
            return None, None

        df = self._sync_selected_accounts(
            access_token, provider_name, selected_accounts, from_date
        )
        return df, None

    def _sync_transactions_worker(
        self, selected_account_ids: list, force_resync: bool = False
    ) -> tuple[pd.DataFrame | None, str | None, str | None, str | None]:
        """The actual transaction syncing logic, run in a background thread."""
        connections = load_truelayer_connections()
        if not connections:
            return (None, None, None, "No TrueLayer accounts connected")

        all_transactions_df = []
        error_message = None

        for connection in connections:
            connection_id = connection.get("connection_id")
            try:
                df, err = self._process_connection(
                    connection, selected_account_ids, force_resync
                )
                if err:
                    error_message = err
                    continue
                if df is not None:
                    all_transactions_df.append(df)

            except ScaExceededError:
                # Must use call_from_thread to update UI from worker thread
                self.app.call_from_thread(
                    self._handle_reauthentication_required, connection_id
                )
                error_message = "Permissions expired for one or more connections."
                continue
            except Exception as e:
                logging.error(f"Error syncing connection {connection_id}: {e}")
                error_message = (
                    f"Error syncing {connection.get('provider_name', 'a bank')}."
                )
                continue

        if not all_transactions_df:
            return (None, None, None, error_message or "No new transactions found")

        combined_df = pd.concat(all_transactions_df, ignore_index=True)
        return (combined_df, "multiple", "multiple", error_message)

    def _sync_selected_accounts(
        self,
        access_token: str,
        provider_name: str,
        selected_accounts: list,
        from_date: str | None = None,
    ) -> pd.DataFrame | None:
        """Sync transactions from selected accounts only.

        Args:
            access_token: TrueLayer access token
            provider_name: Name of the provider/bank
            selected_accounts: List of account dictionaries to sync
            from_date: Start date for transaction sync in YYYY-MM-DD format

        Returns:
            Combined DataFrame of all transactions with account names, or None if no transactions
        """
        from expenses.truelayer_handler import (
            fetch_transactions,
            convert_truelayer_transactions_to_dataframe,
        )

        all_dfs = []

        for account in selected_accounts:
            account_id = account.get("account_id")
            account_type = account.get("account_type", "")
            # Get the _type field to determine if it's a card or account
            resource_type = account.get("_type", "account")

            # Get account name - prefer display_name, fall back to account type + last 4 digits
            display_name = account.get("display_name")
            currency = account.get("currency", "")

            if display_name:
                account_name = display_name
            else:
                # Try to get last 4 digits from account_number or card_number
                account_number = account.get("account_number", {})
                card_number = account.get("card_number", {})
                number = account_number.get("number", "") or card_number.get(
                    "number", ""
                )
                last_4 = number[-4:] if len(number) >= 4 else number
                account_name = (
                    f"{account_type} {last_4}" if last_4 else account_type or "Account"
                )

            # Include currency for multi-currency accounts (e.g., Revolut)
            if currency:
                account_name = f"{account_name} ({currency})"

            logging.info(
                f"Fetching transactions for: {provider_name} - {account_name} ({account_id})"
            )

            transactions = fetch_transactions(
                access_token,
                account_id,
                from_date=from_date,
                account_type=resource_type,
            )
            df = convert_truelayer_transactions_to_dataframe(
                transactions, provider_name
            )

            if df is not None:
                # Add account-specific source identifier
                df["AccountSource"] = f"{provider_name} - {account_name}"
                all_dfs.append(df)

        if not all_dfs:
            return None

        # Combine all account transactions
        combined_df = pd.concat(all_dfs, ignore_index=True)
        logging.info(
            f"Total transactions from {len(selected_accounts)} selected account(s): {len(combined_df)}"
        )

        return combined_df

    def on_worker_state_changed(self, event: Worker.StateChanged) -> None:
        """Handle worker state changes."""
        if event.worker.name == "_sync_transactions_worker":
            if event.state == WorkerState.SUCCESS:
                try:
                    df, connection_ids, _, error_message = event.worker.result

                    if error_message:
                        self.query_one("#sync_status").update(
                            f"Status: {error_message}"
                        )
                        self.app.show_notification(error_message, timeout=10)
                        if "Permissions expired" in error_message:
                            self._update_connections_view()

                    if df is not None and not df.empty:
                        self.pending_transactions = df
                        self.pending_connection_id = connection_ids
                        self.pending_provider_name = "TrueLayer"
                        self._show_transaction_preview(df)
                        status_message = f"Found {len(df)} new transactions."
                        self.query_one("#sync_status").update(status_message)
                    else:
                        self.query_one("#sync_status").update(
                            error_message or "No new transactions found."
                        )

                except Exception as e:
                    logging.error(f"Error handling worker result: {e}", exc_info=True)
                    self.app.show_notification(
                        f"Error completing sync: {e}", timeout=10
                    )

            elif event.state == WorkerState.ERROR:
                logging.error(f"Worker failed: {event.worker.error}", exc_info=True)
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

        # Calculate summary statistics
        total_transactions = len(df)
        total_amount = df["Amount"].sum() if "Amount" in df.columns else 0

        # Group by account source if available
        sources_info = ""
        if "AccountSource" in df.columns:
            sources = df.groupby("AccountSource").size()
            sources_info = " from " + ", ".join(
                [f"{src} ({count})" for src, count in sources.items()]
            )

        # Update summary
        summary_text = (
            f"Found {total_transactions} transaction(s){sources_info}\n"
            f"Total amount: {total_amount:,.2f}"
        )
        self.query_one("#preview_summary").update(summary_text)

        # Display only the essential columns for preview
        display_columns = ["Date", "Merchant", "Amount"]
        if "AccountSource" in df.columns:
            display_columns.append("AccountSource")

        preview_df = df[display_columns].copy()

        # Add columns to table
        table.add_columns(*display_columns)

        # Add rows (limit to first 50 for performance)
        max_preview_rows = 50
        for i, row in enumerate(preview_df.itertuples(index=False, name=None)):
            if i >= max_preview_rows:
                break
            table.add_row(*[str(x) for x in row])

        if total_transactions > max_preview_rows:
            # Add a note about truncation
            self.query_one("#preview_summary").update(
                summary_text
                + f"\n(Showing first {max_preview_rows} of {total_transactions} transactions)"
            )

        # Show the preview section
        self.query_one("#preview_section").display = True
        self.query_one("#import_button").disabled = False

    def _import_transactions(self) -> None:
        """Import the pending transactions."""
        if self.pending_transactions is None:
            self.app.show_notification("No transactions to import", timeout=5)
            return

        try:
            process_and_store_transactions(
                self.pending_transactions, self.pending_provider_name or "TrueLayer"
            )

            if self.pending_connection_id:
                if isinstance(self.pending_connection_id, list):
                    update_connection_last_sync(self.pending_connection_id)
                else:
                    update_connection_last_sync([self.pending_connection_id])

            count = len(self.pending_transactions)
            self.app.show_notification(
                f"Successfully imported {count} transactions!", timeout=5
            )
            self.pending_transactions = None
            self.pending_connection_id = None
            self.pending_provider_name = None
            self._clear_preview()
            self.app.pop_screen()

        except Exception as e:
            logging.error(f"Error importing transactions: {e}")
            self.app.show_notification(f"Error importing transactions: {e}", timeout=10)

    def _clear_preview(self) -> None:
        """Clear the transaction preview."""
        table = self.query_one("#transaction_preview", DataTable)
        table.clear(columns=True)
        self.query_one("#preview_summary").update("")
        self.query_one("#preview_section").display = False
        self.query_one("#sync_status").display = False
        self.query_one("#sync_status").update("")
        self.query_one("#import_button").disabled = True

        # Clear pending transactions
        self.pending_transactions = None
        self.pending_connection_id = None
        self.pending_provider_name = None
