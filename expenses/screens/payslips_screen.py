"""Screen for importing payslip PDFs and computing pension-aware savings."""
import logging

import pandas as pd
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.widgets import Button, DataTable, Static

from expenses.screens.base_screen import BaseScreen
from expenses.screens.file_browser_screen import FileBrowserScreen
from expenses.payslip_handler import (
    get_payslip_folder,
    set_payslip_folder,
    scan_folder,
    upsert_payslips,
)


class PayslipsScreen(BaseScreen):
    """Scan a folder of payslip PDFs, preview, and import."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._preview_df = pd.DataFrame()

    def compose_content(self) -> ComposeResult:
        with Vertical():
            yield Static(id="payslip_folder_label")
            with Horizontal():
                yield Button("Choose Folder", id="choose_folder_button")
                yield Button("Scan", id="scan_button")
            yield DataTable(id="payslip_preview", cursor_type="row")
            yield Static(id="payslip_status")
            yield Button("Import Payslips", id="import_payslips_button")

    def on_mount(self) -> None:
        self._refresh_folder_label()

    def _refresh_folder_label(self) -> None:
        folder = get_payslip_folder()
        label = self.query_one("#payslip_folder_label", Static)
        label.update(f"[bold]Folder:[/bold] {folder or '(none chosen yet)'}")

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "choose_folder_button":
            self.app.push_screen(
                FileBrowserScreen(select_dirs=True, file_suffix=".pdf"),
                self._handle_folder_chosen,
            )
        elif event.button.id == "scan_button":
            self._scan()
        elif event.button.id == "import_payslips_button":
            self._import()

    def _handle_folder_chosen(self, path) -> None:
        # FileBrowserScreen only invokes this callback when a folder is actually
        # selected (via dismiss); cancelling with Escape/Back pops without calling
        # back, so there is no cancel branch to handle here.
        if path:
            set_payslip_folder(str(path))
            self._refresh_folder_label()

    def _scan(self) -> None:
        folder = get_payslip_folder()
        if not folder:
            self.app.show_notification("Choose a payslip folder first.", timeout=5)
            return
        try:
            df, skipped = scan_folder(folder)
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
                f"{row['PensionEE'] + row['AVC']:,.2f}", f"{row['PensionER']:,.2f}", flag,
            )
        status = self.query_one("#payslip_status", Static)
        msg = f"{len(df)} month(s) parsed."
        if skipped:
            msg += f" Skipped: {', '.join(skipped)}"
        status.update(msg)

    def _import(self) -> None:
        if self._preview_df.empty:
            self.app.show_notification("Nothing to import. Scan first.", timeout=5)
            return
        combined = upsert_payslips(self._preview_df)
        self.app.show_notification(
            f"Imported. {len(combined)} month(s) stored.", timeout=5
        )
