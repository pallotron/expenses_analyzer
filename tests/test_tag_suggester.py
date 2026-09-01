"""Tests for the inline tag completion suggester."""

from typing import List

import pytest

from expenses.tag_suggester import TagSuggester

VOCAB: List[str] = [
    "emergency",
    "trip",
    "trip:paris-jun26",
    "trip:rome-may26",
    "work:expenses",
]


@pytest.mark.asyncio
async def test_completes_a_plain_prefix() -> None:
    assert await TagSuggester(VOCAB).get_suggestion("emer") == "emergency"


@pytest.mark.asyncio
async def test_returns_none_when_nothing_matches() -> None:
    assert await TagSuggester(VOCAB).get_suggestion("zzz") is None


@pytest.mark.asyncio
async def test_returns_none_for_an_empty_value() -> None:
    assert await TagSuggester(VOCAB).get_suggestion("") is None


@pytest.mark.asyncio
async def test_namespace_prefix_completes_to_first_tag_in_it() -> None:
    assert await TagSuggester(VOCAB).get_suggestion("trip:") == "trip:paris-jun26"


@pytest.mark.asyncio
async def test_picks_the_first_match_in_sorted_order() -> None:
    unsorted = ["trip:rome-may26", "trip:paris-jun26"]
    assert await TagSuggester(unsorted).get_suggestion("trip:") == "trip:paris-jun26"


@pytest.mark.asyncio
async def test_exact_match_suggests_nothing_extra() -> None:
    assert await TagSuggester(VOCAB).get_suggestion("emergency") == "emergency"


@pytest.mark.asyncio
async def test_whole_value_is_matched_without_last_segment_mode() -> None:
    """The filter field is a single token: a comma must not split it."""
    assert await TagSuggester(VOCAB).get_suggestion("emergency,tr") is None


@pytest.mark.asyncio
async def test_last_segment_completes_after_a_comma() -> None:
    suggester = TagSuggester(VOCAB, last_segment=True)
    result = await suggester.get_suggestion("emergency,tr")
    assert result == "emergency,trip"


@pytest.mark.asyncio
async def test_last_segment_preserves_the_space_after_a_comma() -> None:
    suggester = TagSuggester(VOCAB, last_segment=True)
    result = await suggester.get_suggestion("emergency, trip:p")
    assert result == "emergency, trip:paris-jun26"


@pytest.mark.asyncio
async def test_last_segment_suggests_nothing_on_a_bare_trailing_comma() -> None:
    suggester = TagSuggester(VOCAB, last_segment=True)
    assert await suggester.get_suggestion("emergency,") is None
    assert await suggester.get_suggestion("emergency, ") is None


@pytest.mark.asyncio
async def test_a_character_no_tag_contains_suggests_nothing() -> None:
    """The fragment is matched as typed, so the ghost text can never disagree."""
    suggester = TagSuggester(VOCAB, last_segment=True)
    assert await suggester.get_suggestion("emer!") is None


@pytest.mark.asyncio
async def test_empty_vocabulary_suggests_nothing() -> None:
    assert await TagSuggester([]).get_suggestion("emer") is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value, last_segment",
    [
        ("emer", False),
        ("trip:", False),
        ("emergency,tr", True),
        ("emergency, trip:p", True),
    ],
)
async def test_suggestion_always_starts_with_the_typed_value(
    value: str, last_segment: bool
) -> None:
    """Textual renders suggestion[len(value):] as ghost text, so this must hold."""
    result = await TagSuggester(VOCAB, last_segment=last_segment).get_suggestion(value)
    assert result is not None
    assert result.startswith(value)


@pytest.mark.asyncio
async def test_is_case_insensitive() -> None:
    """Textual casefolds the value before calling us; tags are stored lowercase."""
    assert TagSuggester(VOCAB).case_sensitive is False


# --- Wiring: the screens that own the free-text tag fields ---


@pytest.mark.asyncio
async def test_tag_modal_input_completes_the_segment_after_a_comma() -> None:
    """The modal field is comma-separated, so it needs last-segment mode."""
    from textual.app import App
    from textual.widgets import Input

    from expenses.screens.tag_transactions_screen import TagTransactionsScreen

    class _Host(App):
        def on_mount(self) -> None:
            self.push_screen(TagTransactionsScreen(3, VOCAB))

    async with _Host().run_test() as pilot:
        await pilot.pause()
        suggester = pilot.app.screen.query_one("#tags_input", Input).suggester
        assert suggester is not None
        assert await suggester.get_suggestion("emergency,tr") == "emergency,trip"


@pytest.mark.asyncio
async def test_transaction_tag_filter_suggests_tags_and_refreshes_on_resume() -> None:
    """The filter field is one token, and its vocabulary must follow the data."""
    from unittest.mock import patch

    import pandas as pd
    from textual.app import App

    from expenses.widgets.clearable_input import ClearableInput

    def _df(tags: str) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "Date": pd.Timestamp("2026-08-15"),
                    "Merchant": "Merchant A",
                    "Amount": 10.0,
                    "Source": "CSV Import",
                    "Type": "expense",
                    "Deleted": False,
                    "Tags": tags,
                }
            ]
        )

    holder = {"df": _df("emergency")}

    with (
        patch(
            "expenses.screens.transaction_screen.load_transactions_from_parquet",
            lambda: holder["df"].copy(),
        ),
        patch("expenses.screens.transaction_screen.load_categories", return_value={}),
        patch(
            "expenses.screens.transaction_screen.load_category_types", return_value={}
        ),
        patch(
            "expenses.screens.transaction_screen.load_merchant_aliases", return_value={}
        ),
    ):
        from expenses.screens.transaction_screen import TransactionScreen

        class _Host(App):
            def on_mount(self) -> None:
                self.push_screen(TransactionScreen(year=2026))

        async with _Host().run_test() as pilot:
            await pilot.pause()
            screen = pilot.app.screen
            field = screen.query_one("#tags_filter", ClearableInput)
            assert field.suggester is not None
            assert await field.suggester.get_suggestion("emer") == "emergency"
            # A single-token field must not split on a comma.
            assert await field.suggester.get_suggestion("emergency,tr") is None

            holder["df"] = _df("trip:paris-jun26")
            screen.on_screen_resume(None)
            await pilot.pause()
            assert await field.suggester.get_suggestion("trip:") == "trip:paris-jun26"
