"""The merchant editor must say what a pattern would do before it is saved."""

import pandas as pd
import pytest

from expenses.merchant_editor import preview_alias_change


@pytest.fixture
def transactions() -> pd.DataFrame:
    rows = [
        ("Erfgo museum 1", 12.0),
        ("Erfgo museum 2", 12.0),
        ("Erfgo shop", 53.0),
        ("Fnac Antwerp", 40.0),
        ("Dunnes Stores", 25.0),
    ]
    return pd.DataFrame(
        {"Merchant": [m for m, _ in rows], "Amount": [a for _, a in rows]}
    )


CATEGORIES = {
    "Erfgo museum 1": "Insurance",
    "Erfgo museum 2": "Insurance",
    "Erfgo shop": "Hobbies",
    "Fnac Antwerp": "Shopping",
    "Dunnes Stores": "Groceries",
}


def test_counts_the_transactions_a_pattern_would_claim(transactions) -> None:
    preview = preview_alias_change(
        r"Erfgo.*", "AG CIA Erfgoed", transactions, {}, CATEGORIES
    )

    assert preview.matched == 3
    assert preview.total == pytest.approx(77.0)


def test_reports_what_those_rows_are_categorised_as_today(transactions) -> None:
    """So you can see "2 currently Insurance" before you overwrite it."""
    preview = preview_alias_change(
        r"Erfgo.*", "AG CIA Erfgoed", transactions, {}, CATEGORIES
    )

    assert dict(preview.current_categories) == {"Insurance": 2, "Hobbies": 1}


def test_lists_every_merchant_the_pattern_claims(transactions) -> None:
    """The list is the safety net: an unexpected name means too broad a pattern."""
    preview = preview_alias_change(
        r"Erfgo.*", "AG CIA Erfgoed", transactions, {}, CATEGORIES
    )

    assert dict(preview.merchants) == {
        "Erfgo museum 1": 1,
        "Erfgo museum 2": 1,
        "Erfgo shop": 1,
    }


def test_a_too_broad_pattern_shows_the_merchants_it_sweeps_in(transactions) -> None:
    """ "Dunnes Stores" in the list is how you learn the regex is wrong."""
    preview = preview_alias_change(r".*s.*", "Museum", transactions, {}, CATEGORIES)

    assert "Dunnes Stores" in preview.merchants
    assert "Fnac Antwerp" not in preview.merchants


def test_an_appended_pattern_cannot_steal_from_an_earlier_one(transactions) -> None:
    """Aliases are first-match-wins, so a new rule only claims unclaimed rows."""
    aliases = {r"Erfgo museum.*": "Museum"}

    preview = preview_alias_change(
        r"Erfgo.*", "AG CIA Erfgoed", transactions, aliases, CATEGORIES
    )

    assert preview.matched == 1
    assert dict(preview.merchants) == {"Erfgo shop": 1}


def test_an_invalid_regex_is_reported_not_raised(transactions) -> None:
    preview = preview_alias_change("Erfgo(", "Museum", transactions, {}, CATEGORIES)

    assert preview.error is not None
    assert preview.matched == 0


def test_an_empty_pattern_previews_nothing(transactions) -> None:
    preview = preview_alias_change("", "Museum", transactions, {}, CATEGORIES)

    assert preview.error is None
    assert preview.matched == 0
