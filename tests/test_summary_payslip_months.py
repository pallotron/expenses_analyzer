"""Tests that a month with a payslip but no bank transactions still gets a tab."""

from unittest.mock import patch

import pandas as pd
import pytest
from textual.app import ComposeResult
from textual.screen import Screen
from textual.widgets import Static, TabbedContent, TabPane

from expenses.app import ExpensesApp
from expenses.screens.summary_screen import SummaryScreen


def _transactions() -> pd.DataFrame:
    """Synthetic bank data covering July and August 2026 only."""
    rows = [
        {
            "Date": pd.Timestamp(year=2026, month=month, day=15),
            "Merchant": "Merchant A",
            "Amount": 10.0,
            "Source": "CSV Import",
            "Type": "expense",
            "Deleted": False,
            "Tags": "",
        }
        for month in (7, 8)
    ]
    return pd.DataFrame(rows)


def _payslip(month: str) -> dict:
    return {
        "Owner": "self", "Month": month, "Gross": 5000.0, "Net": 3000.0,
        "TaxTotal": 1500.0, "PensionEE": 200.0, "AVC": 50.0, "PensionER": 150.0,
        "Bonus": 0.0, "OnCall": 0.0, "SourceFiles": f"{month}.pdf",
        "YTDReconciled": True, "NetReconciled": True,
    }


class _Blank(Screen):
    def compose(self) -> ComposeResult:
        yield Static("blank")


@pytest.fixture
def data_holder():
    """Patch the summary screen's data sources with mutable frames."""
    holder = {
        "transactions": _transactions(),
        "payslips": pd.DataFrame([_payslip("2026-08"), _payslip("2026-09")]),
    }

    with (
        patch(
            "expenses.screens.summary_screen.load_transactions_from_parquet",
            lambda: holder["transactions"].copy(),
        ),
        patch("expenses.screens.summary_screen.load_categories", return_value={}),
        patch("expenses.screens.summary_screen.load_merchant_aliases", return_value={}),
        patch("expenses.screens.summary_screen.load_category_types", return_value={}),
        patch(
            "expenses.screens.summary_screen.load_tag_settings",
            return_value={"exclude_from_summary": []},
        ),
        patch(
            "expenses.screens.summary_screen.load_payslips",
            lambda: holder["payslips"].copy(),
        ),
    ):
        yield holder


def _pane_ids(summary: SummaryScreen) -> set:
    return {pane.id for pane in summary.query(TabPane)}


@pytest.mark.asyncio
async def test_payslip_only_month_gets_a_tab(data_holder) -> None:
    app = ExpensesApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        summary = pilot.app.screen
        assert isinstance(summary, SummaryScreen)
        assert "month_2026_9" in _pane_ids(summary)


@pytest.mark.asyncio
async def test_payslip_only_month_explains_itself(data_holder) -> None:
    app = ExpensesApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        summary = pilot.app.screen
        summary.query_one("#month_tabs_2026", TabbedContent).active = "month_2026_9"
        await pilot.pause()
        await pilot.pause()

        text = str(summary.query_one("#cash_flow_2026_9", Static).render())
        assert "No bank transactions" in text
        # Pension is employee + AVC + employer from the payslip: 200 + 50 + 150.
        assert "400.00" in text
        # A rate against no bank income would read 100% and mean nothing.
        assert "Savings Rate" not in text


@pytest.mark.asyncio
async def test_importing_a_payslip_adds_its_tab_on_resume(data_holder) -> None:
    data_holder["payslips"] = pd.DataFrame([_payslip("2026-08")])
    app = ExpensesApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        assert "month_2026_9" not in _pane_ids(pilot.app.screen)

        data_holder["payslips"] = pd.DataFrame([_payslip("2026-08"), _payslip("2026-09")])
        await pilot.app.push_screen(_Blank())
        await pilot.pause()
        pilot.app.pop_screen()
        await pilot.pause()
        await pilot.pause()

        assert "month_2026_9" in _pane_ids(pilot.app.screen)
