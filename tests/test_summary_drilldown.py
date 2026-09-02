"""Clicking a Summary row must open the transaction view already filtered to it."""

from typing import Any, List
from unittest.mock import patch

import pandas as pd
import pytest
from textual.widgets import Button, DataTable

from expenses.app import ExpensesApp
from expenses.screens.summary_screen import SummaryScreen
from expenses.screens.transaction_screen import TransactionScreen

CATEGORIES = {"Electric Ireland": "Utilities", "Booking.com": "Travel"}
CATEGORY_TYPES = {
    "essential": {"categories": ["Utilities"], "annual_budget": 100.0},
    "discretionary": {"categories": ["Travel"], "annual_budget": 100.0},
}


def _make_df() -> pd.DataFrame:
    rows: List[dict] = []
    for month in range(1, 4):
        rows.append(
            {
                "Date": pd.Timestamp(year=2026, month=month, day=15),
                "Merchant": "Electric Ireland",
                "Amount": 100.0,
                "Source": "CSV Import",
                "Type": "expense",
                "Deleted": False,
                "Tags": "",
            }
        )
    rows.append(
        {
            "Date": pd.Timestamp(year=2026, month=2, day=20),
            "Merchant": "Booking.com",
            "Amount": 50.0,
            "Source": "CSV Import",
            "Type": "expense",
            "Deleted": False,
            "Tags": "",
        }
    )
    return pd.DataFrame(rows)


@pytest.fixture
def patched_data():
    """Point both screens at the same synthetic frame."""
    df = _make_df()
    targets = {
        "load_transactions_from_parquet": lambda *a, **k: df.copy(),
        "load_categories": lambda: dict(CATEGORIES),
        "load_merchant_aliases": lambda: {},
        "load_category_types": lambda: dict(CATEGORY_TYPES),
    }
    patches = []
    for module in (
        "expenses.screens.summary_screen",
        "expenses.screens.transaction_screen",
    ):
        for name, fn in targets.items():
            patches.append(patch(f"{module}.{name}", fn))
    patches.append(
        patch(
            "expenses.screens.summary_screen.load_tag_settings",
            return_value={"exclude_from_summary": []},
        )
    )
    patches.append(
        patch(
            "expenses.screens.summary_screen.load_payslips", return_value=pd.DataFrame()
        )
    )
    for p in patches:
        p.start()
    yield df
    for p in patches:
        p.stop()


async def _click_row(pilot: Any, table_id: str, row: int) -> TransactionScreen:
    """Put the cursor on a row of a Summary table and select it."""
    summary = pilot.app.screen
    assert isinstance(summary, SummaryScreen)
    table = summary.query_one(f"#{table_id}", DataTable)
    table.focus()
    table.move_cursor(row=row)
    await pilot.pause()
    await pilot.press("enter")
    await pilot.pause()
    return pilot.app.screen


def _variant(screen: TransactionScreen, button_id: str) -> str:
    return screen.query_one(f"#{button_id}", Button).variant


@pytest.mark.asyncio
async def test_expense_merchant_drilldown_filters_to_expenses(patched_data) -> None:
    """Drilling into Top Expense Merchants must exclude income."""
    async with ExpensesApp().run_test() as pilot:
        await pilot.pause()
        screen = await _click_row(pilot, "top_merchants_2026_all", 0)

        assert isinstance(screen, TransactionScreen)
        assert screen.filter_type == "expense"


@pytest.mark.asyncio
async def test_expense_merchant_drilldown_carries_budget_type(patched_data) -> None:
    """Electric Ireland is Utilities, an essential category."""
    async with ExpensesApp().run_test() as pilot:
        await pilot.pause()
        screen = await _click_row(pilot, "top_merchants_2026_all", 0)

        assert screen.filter_budget_type == "essential"


@pytest.mark.asyncio
async def test_drilldown_toggle_buttons_match_the_filters(patched_data) -> None:
    """The buttons must agree with the filters the screen opened with."""
    async with ExpensesApp().run_test() as pilot:
        await pilot.pause()
        screen = await _click_row(pilot, "top_merchants_2026_all", 0)

        assert _variant(screen, "type_expense_button") == "primary"
        assert _variant(screen, "type_all_button") == "default"
        assert _variant(screen, "budget_essential_button") == "primary"
        assert _variant(screen, "budget_all_button") == "default"


@pytest.mark.asyncio
async def test_discretionary_category_drilldown_carries_budget_type(
    patched_data,
) -> None:
    """A discretionary category must open with the Discretionary toggle set."""
    async with ExpensesApp().run_test() as pilot:
        await pilot.pause()
        summary = pilot.app.screen
        table = summary.query_one("#category_breakdown_2026_all", DataTable)
        rows = [str(table.get_cell_at((i, 0))) for i in range(table.row_count)]
        travel_row = next(i for i, name in enumerate(rows) if "Travel" in name)

        screen = await _click_row(pilot, "category_breakdown_2026_all", travel_row)

        assert screen.filter_budget_type == "discretionary"
        assert screen.filter_type == "expense"
