"""Screen for importing payslip PDFs and computing pension-aware savings."""
import logging

import pandas as pd
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.widgets import Button, DataTable, Input, Select, Static

from expenses.screens.base_screen import BaseScreen
from expenses.screens.file_browser_screen import FileBrowserScreen
from expenses.payslip_handler import (
    DEFAULT_OWNER,
    add_payslip_folder,
    get_payslip_folders,
    list_owners,
    remove_payslip_folder,
    scan_owner,
    upsert_payslips,
)


class PayslipsScreen(BaseScreen):
    """Scan each person's payslip folders, preview, and import.

    A person can have more than one folder: changing employer part-way through
    a year leaves that year's payslips split across directories, and both must
    be scanned together for the year's totals to be complete.
    """

    DEFAULT_CSS = """
    PayslipsScreen .owner-bar {
        height: auto;
        padding: 1 0;
    }

    PayslipsScreen .owner-bar > Select {
        width: 1fr;
        margin: 0 1;
    }

    PayslipsScreen .owner-bar > Input {
        width: 1fr;
        margin: 0 1;
    }

    PayslipsScreen .folder-bar {
        height: auto;
    }

    PayslipsScreen #payslip_folder_label {
        height: auto;
        padding: 0 1;
    }

    PayslipsScreen #payslip_preview {
        height: 1fr;
    }
    """

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._preview_df = pd.DataFrame()
        self._owner = DEFAULT_OWNER

    def _owner_options(self) -> list:
        """Selectable people: those already saved, plus one not yet saved.

        A newly named person has no folder yet, and only folders are persisted,
        so they would vanish from the saved list the moment they were named.
        Carrying the current selection keeps them choosable long enough to give
        them one.
        """
        owners = list_owners() or [DEFAULT_OWNER]
        if self._owner not in owners:
            owners.append(self._owner)
        return owners

    def compose_content(self) -> ComposeResult:
        # Options must be non-empty at construction when blanks are disallowed,
        # so seed from the configured owners rather than filling in on mount.
        owners = self._owner_options()
        self._owner = owners[0]
        with Vertical():
            with Horizontal(classes="owner-bar"):
                yield Select(
                    [(name, name) for name in owners],
                    id="owner_select",
                    value=self._owner,
                    allow_blank=False,
                )
                yield Input(placeholder="Add person…", id="new_owner_input")
            yield Static(id="payslip_folder_label")
            with Horizontal(classes="folder-bar"):
                yield Button("Add Folder", id="add_folder_button")
                yield Button("Remove Folder", id="remove_folder_button")
                yield Button("Scan", id="scan_button")
            yield DataTable(id="payslip_preview", cursor_type="row")
            yield Static(id="payslip_status")
            yield Button("Import Payslips", id="import_payslips_button")

    def on_mount(self) -> None:
        self._refresh_owners()

    def _refresh_owners(self) -> None:
        # Replacing the options makes Select emit a change of its own, so hold
        # the intended selection across it rather than reading it back after.
        owner = self._owner
        owners = self._owner_options()
        select = self.query_one("#owner_select", Select)
        select.set_options([(name, name) for name in owners])
        self._owner = owner
        select.value = owner
        self._refresh_folder_label()

    def _refresh_folder_label(self) -> None:
        folders = get_payslip_folders(self._owner)
        label = self.query_one("#payslip_folder_label", Static)
        if folders:
            listed = "\n".join(f"  • {folder}" for folder in folders)
            label.update(f"[bold]Folders for {self._owner}:[/bold]\n{listed}")
        else:
            label.update(f"[bold]Folders for {self._owner}:[/bold] (none chosen yet)")

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id != "owner_select" or event.value is None:
            return
        owner = str(event.value)
        # Rebuilding the option list re-emits this for the unchanged selection;
        # acting on that would discard a preview the user just scanned.
        if owner == self._owner:
            return
        self._owner = owner
        self._clear_preview()
        self._refresh_folder_label()

    def _clear_preview(self) -> None:
        """Drop the previous person's results so nothing stale is attributed."""
        self._preview_df = pd.DataFrame()
        self.query_one("#payslip_preview", DataTable).clear(columns=True)
        self.query_one("#payslip_status", Static).update(
            f"Press Scan to preview {self._owner}'s payslips."
        )

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id != "new_owner_input":
            return
        name = event.value.strip()
        if not name:
            return
        # A person only becomes real once they have a folder, so select them and
        # let the folder picker do the saving.
        self._owner = name
        event.input.value = ""
        self._refresh_owners()
        self.app.show_notification(f"Now add a payslip folder for {name}.", timeout=5)

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "add_folder_button":
            self.app.push_screen(
                FileBrowserScreen(select_dirs=True, file_suffix=".pdf"),
                self._handle_folder_chosen,
            )
        elif event.button.id == "remove_folder_button":
            self._remove_last_folder()
        elif event.button.id == "scan_button":
            self._scan()
        elif event.button.id == "import_payslips_button":
            self._import()

    def _handle_folder_chosen(self, path) -> None:
        # FileBrowserScreen only invokes this callback when a folder is actually
        # selected (via dismiss); cancelling with Escape/Back pops without calling
        # back, so there is no cancel branch to handle here.
        if path:
            add_payslip_folder(str(path), owner=self._owner)
            self._refresh_owners()

    def _remove_last_folder(self) -> None:
        folders = get_payslip_folders(self._owner)
        if not folders:
            self.app.show_notification("No folder to remove.", timeout=5)
            return
        removed = folders[-1]
        remove_payslip_folder(removed, owner=self._owner)
        self._refresh_owners()
        self.app.show_notification(f"Removed {removed}", timeout=5)

    def _scan(self) -> None:
        if not get_payslip_folders(self._owner):
            self.app.show_notification("Add a payslip folder first.", timeout=5)
            return
        try:
            df, skipped = scan_owner(self._owner)
        except Exception as exc:  # noqa: BLE001
            logging.warning("Payslip scan failed: %s", exc)
            self.app.show_notification(f"Scan failed: {exc}", timeout=10)
            return
        self._preview_df = df
        self._render_preview(df, skipped)

    def _render_preview(self, df: pd.DataFrame, skipped) -> None:
        table = self.query_one("#payslip_preview", DataTable)
        table.clear(columns=True)
        table.add_columns("Month", "Gross", "Net", "EE Pens", "ER Pens", "Flag")
        for _, row in df.iterrows():
            flags = [] if row["YTDReconciled"] else ["⚠ YTD"]
            if not row.get("NetReconciled", True):
                flags.append("⚠ NET")
            table.add_row(
                row["Month"], f"{row['Gross']:,.2f}", f"{row['Net']:,.2f}",
                f"{row['PensionEE'] + row['AVC']:,.2f}", f"{row['PensionER']:,.2f}",
                " ".join(flags),
            )
        status = self.query_one("#payslip_status", Static)
        msg = f"{len(df)} month(s) parsed for {self._owner}."
        if skipped:
            msg += f" Skipped: {', '.join(skipped)}"
        status.update(msg)

    def _import(self) -> None:
        if self._preview_df.empty:
            self.app.show_notification("Nothing to import. Scan first.", timeout=5)
            return
        combined = upsert_payslips(self._preview_df)
        self.app.show_notification(
            f"Imported. {len(combined)} month(s) stored across "
            f"{combined['Owner'].nunique()} person(s).",
            timeout=5,
        )
