from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static
from textual.containers import Vertical, Horizontal

from expenses.truelayer_handler import (
    load_truelayer_connections,
    remove_truelayer_connection,
)


class ManageTrueLayerConnectionsScreen(ModalScreen):
    """A modal screen for managing TrueLayer connections."""

    def compose(self) -> ComposeResult:
        with Vertical(id="manage_connections_dialog"):
            yield Static("Manage TrueLayer Connections", classes="title")
            yield Vertical(id="connection_buttons", classes="connections_list")
            yield Horizontal(
                Button("Add New Connection", id="add_connection", variant="primary"),
                Button("Close", id="close_dialog"),
                classes="horizontal_buttons",
            )

    def on_mount(self) -> None:
        """Load existing connections and populate the list."""
        self.update_connections_list()

    def update_connections_list(self) -> None:
        """Clear and repopulate the connections list."""
        connections = load_truelayer_connections()
        buttons_container = self.query_one("#connection_buttons")
        buttons_container.remove_children()

        if not connections:
            buttons_container.mount(Static("No connections found."))
        else:
            for conn in connections:
                provider_name = conn.get("provider_name", "Unknown")
                connection_id = conn.get("connection_id")
                label = f"{provider_name} ({connection_id})"
                buttons_container.mount(
                    Button(
                        f"Remove {label}",
                        id=f"remove_{connection_id}",
                        variant="error",
                    )
                )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "add_connection":
            self.dismiss(result=("add", None))
        elif event.button.id == "close_dialog":
            self.dismiss(result=("close", None))
        elif event.button.id and event.button.id.startswith("remove_"):
            connection_id = event.button.id.split("_")[1]
            remove_truelayer_connection(connection_id)
            self.update_connections_list()
