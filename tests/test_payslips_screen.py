import json
import unittest
from unittest.mock import patch

import expenses.config as config
from expenses.app import ExpensesApp
from expenses.payslip_handler import add_payslip_folder
from expenses.screens.payslips_screen import PayslipsScreen


def _screen(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PAYSLIP_SETTINGS_FILE", tmp_path / "s.json")
    monkeypatch.setattr(config, "PAYSLIP_DIR", None)
    return PayslipsScreen()


def test_owner_options_default_when_nothing_configured(monkeypatch, tmp_path):
    screen = _screen(monkeypatch, tmp_path)
    assert screen._owner_options() == ["self"]


def test_owner_options_keeps_a_person_who_has_no_folder_yet(monkeypatch, tmp_path):
    # Only folders are persisted, so a just-named person is absent from the
    # saved owners. They must stay selectable long enough to be given a folder,
    # otherwise naming someone silently reverts to the previous selection.
    screen = _screen(monkeypatch, tmp_path)
    add_payslip_folder("/mine", owner="self")

    screen._owner = "Someone New"
    assert screen._owner_options() == ["self", "Someone New"]


def test_owner_options_does_not_duplicate_a_saved_person(monkeypatch, tmp_path):
    screen = _screen(monkeypatch, tmp_path)
    add_payslip_folder("/mine", owner="self")
    add_payslip_folder("/theirs", owner="other")

    screen._owner = "other"
    assert screen._owner_options() == ["self", "other"]


class TestPreviewFollowsSelectedOwner(unittest.IsolatedAsyncioTestCase):
    """The table must never show one person's months under another's name."""

    async def _open_payslips(self, stack, settings):
        import tempfile
        from pathlib import Path
        from textual.widgets import Select, DataTable

        tmp = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        (tmp / "s.json").write_text(json.dumps(settings))
        stack.enter_context(patch.object(config, "PAYSLIP_SETTINGS_FILE", tmp / "s.json"))
        stack.enter_context(patch.object(config, "PAYSLIP_DIR", None))

        app = ExpensesApp()
        pilot = await stack.enter_async_context(app.run_test())
        await pilot.press("y")
        await pilot.pause()
        screen = app.screen
        return pilot, screen, screen.query_one("#owner_select", Select), \
            screen.query_one("#payslip_preview", DataTable)

    async def test_switching_owner_clears_the_previous_preview(self):
        from contextlib import AsyncExitStack

        async with AsyncExitStack() as stack:
            pilot, screen, select, table = await self._open_payslips(
                stack,
                {"owners": {"self": {"folders": ["/a"]},
                            "other": {"folders": ["/b"]}}},
            )
            # Stand in for a completed scan of the first person.
            table.add_columns("Month")
            table.add_row("2025-01")
            assert table.row_count == 1

            select.value = "other"
            await pilot.pause()
            assert screen._owner == "other"
            assert table.row_count == 0, "previous person's rows were left on screen"

    async def test_rebuilding_options_keeps_an_existing_preview(self):
        from contextlib import AsyncExitStack

        async with AsyncExitStack() as stack:
            pilot, screen, _select, table = await self._open_payslips(
                stack, {"owners": {"self": {"folders": ["/a"]}}}
            )
            table.add_columns("Month")
            table.add_row("2025-01")

            # Adding a folder refreshes the option list for the same person;
            # that must not throw away results already on screen.
            screen._refresh_owners()
            await pilot.pause()
            assert table.row_count == 1
