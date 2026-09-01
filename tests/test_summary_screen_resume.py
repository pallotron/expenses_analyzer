"""Tests that the Summary screen rebuilds its tabs when new data arrives."""

from typing import Any, List
from unittest.mock import patch

import pandas as pd
import pytest
from textual.app import ComposeResult
from textual.screen import Screen
from textual.widgets import Static, TabPane

from expenses.app import ExpensesApp
from expenses.screens.summary_screen import SummaryScreen


def _make_df(periods: List[tuple], source: str = "CSV Import") -> pd.DataFrame:
    """Build a synthetic transaction frame with one expense per (year, month)."""
    rows = []
    for year, month in periods:
        rows.append(
            {
                "Date": pd.Timestamp(year=year, month=month, day=15),
                "Merchant": "Merchant A",
                "Amount": 10.0,
                "Source": source,
                "Type": "expense",
                "Deleted": False,
                "Tags": "",
            }
        )
    return pd.DataFrame(rows)


class _Blank(Screen):
    def compose(self) -> ComposeResult:
        yield Static("blank")


@pytest.fixture
def data_holder():
    """Patch the summary screen's data source with a mutable frame."""
    holder = {"df": _make_df([(2026, m) for m in range(1, 8)])}

    def _load() -> pd.DataFrame:
        return holder["df"].copy()

    with (
        patch("expenses.screens.summary_screen.load_transactions_from_parquet", _load),
        patch("expenses.screens.summary_screen.load_categories", return_value={}),
        patch("expenses.screens.summary_screen.load_merchant_aliases", return_value={}),
        patch("expenses.screens.summary_screen.load_category_types", return_value={}),
        patch(
            "expenses.screens.summary_screen.load_tag_settings",
            return_value={"exclude_from_summary": []},
        ),
        patch(
            "expenses.screens.summary_screen.load_payslips", return_value=pd.DataFrame()
        ),
    ):
        yield holder


async def _resume_summary(pilot: Any) -> SummaryScreen:
    """Push and pop a screen so the summary screen receives ScreenResume."""
    await pilot.app.push_screen(_Blank())
    await pilot.pause()
    pilot.app.pop_screen()
    await pilot.pause()
    await pilot.pause()
    return pilot.app.screen


@pytest.mark.asyncio
async def test_new_month_in_existing_year_shows_up_on_resume(data_holder) -> None:
    """Importing August into an existing year must add its month tab."""
    app = ExpensesApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        summary = pilot.app.screen
        assert isinstance(summary, SummaryScreen)
        assert not summary.query("#month_2026_8")

        data_holder["df"] = _make_df([(2026, m) for m in range(1, 9)])
        summary = await _resume_summary(pilot)

        panes = {pane.id for pane in summary.query(TabPane)}
        assert "month_2026_8" in panes


@pytest.mark.asyncio
async def test_new_year_still_shows_up_on_resume(data_holder) -> None:
    """The previously handled case (a brand new year) keeps working."""
    app = ExpensesApp()
    async with app.run_test() as pilot:
        await pilot.pause()

        data_holder["df"] = _make_df([(2026, 1), (2027, 1)])
        summary = await _resume_summary(pilot)

        panes = {pane.id for pane in summary.query(TabPane)}
        assert "year_2027" in panes


@pytest.mark.asyncio
async def test_new_source_shows_up_on_resume(data_holder) -> None:
    """A newly imported source must get a filter checkbox, not be filtered out."""
    app = ExpensesApp()
    async with app.run_test() as pilot:
        await pilot.pause()

        df = _make_df([(2026, m) for m in range(1, 8)])
        extra = _make_df([(2026, 7)], source="TrueLayer - Bank")
        data_holder["df"] = pd.concat([df, extra], ignore_index=True)
        summary = await _resume_summary(pilot)

        assert "TrueLayer - Bank" in summary.source_filter
