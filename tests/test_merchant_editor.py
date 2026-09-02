"""The merchant editor must say what a pattern would do before it is saved."""

import pandas as pd
import pytest

from expenses.merchant_editor import (
    apply_merchant_decision,
    pattern_claiming,
    preview_alias_change,
)


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


def test_a_pattern_previews_before_an_alias_has_been_typed(transactions) -> None:
    """You write the pattern first, so it must report matches straight away."""
    preview = preview_alias_change(r"Erfgo.*", "", transactions, {}, CATEGORIES)

    assert preview.matched == 3
    assert preview.total == pytest.approx(77.0)


class TestApplyMerchantDecision:
    """Saving the dialog writes one alias rule and one category, consistently."""

    def test_the_pattern_is_added_to_the_alias_table(self) -> None:
        aliases, _ = apply_merchant_decision(r"Erfgo.*", "AG CIA Erfgoed", None, {}, {})

        assert aliases == {r"Erfgo.*": "AG CIA Erfgoed"}

    def test_the_category_is_keyed_on_the_display_alias(self) -> None:
        """Categories are looked up by display name, so that is what to write."""
        _, categories = apply_merchant_decision(
            r"Erfgo.*", "AG CIA Erfgoed", "Hobbies", {}, {}
        )

        assert categories["AG CIA Erfgoed"] == "Hobbies"

    def test_renaming_the_alias_carries_the_category_to_the_new_name(self) -> None:
        _, categories = apply_merchant_decision(
            r"Erfgo.*",
            "Museums",
            "Hobbies",
            {r"Erfgo.*": "Old Name"},
            {"Old Name": "Hobbies"},
        )

        assert categories["Museums"] == "Hobbies"

    def test_leaving_the_category_unset_touches_no_categories(self) -> None:
        before = {"Something Else": "Groceries"}
        _, categories = apply_merchant_decision(
            r"Erfgo.*", "AG CIA Erfgoed", None, {}, before
        )

        assert categories == before

    def test_the_inputs_are_not_mutated(self) -> None:
        """The caller decides whether to persist, so it keeps its originals."""
        aliases, categories = {}, {}

        apply_merchant_decision(
            r"Erfgo.*", "AG CIA Erfgoed", "Hobbies", aliases, categories
        )

        assert aliases == {} and categories == {}


class TestPatternClaiming:
    """Which rule is actually in force for a merchant, so the editor can show it."""

    ALIASES = {
        r"Erfgo museum.*": "Museum",
        r"Erfgo.*": "Erfgo catch-all",
        r"Dunnes.*": "Dunnes Stores",
    }

    def test_finds_the_pattern_that_claims_the_merchant(self) -> None:
        assert pattern_claiming("Dunnes Stores 12", self.ALIASES) == r"Dunnes.*"

    def test_returns_the_first_match_because_aliases_are_ordered(self) -> None:
        """Two rules match; only the earlier one ever applies."""
        assert pattern_claiming("Erfgo museum 1", self.ALIASES) == r"Erfgo museum.*"

    def test_returns_none_when_no_rule_claims_it(self) -> None:
        assert pattern_claiming("Tesco", self.ALIASES) is None

    def test_a_broken_rule_is_skipped_rather_than_raising(self) -> None:
        """One bad regex in the file must not break the editor."""
        aliases = {"Erfgo(": "Broken", r"Erfgo.*": "Good"}

        assert pattern_claiming("Erfgo museum 1", aliases) == r"Erfgo.*"
