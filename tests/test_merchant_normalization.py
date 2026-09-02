"""Merchant strings that carry the transaction date must still name one merchant."""

import json
from unittest.mock import patch

import pytest

from expenses.data_handler import (
    apply_merchant_alias,
    load_categories,
    normalize_merchant_name,
)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("CNC AKODRIE 13/08 10:24", "CNC AKODRIE"),
        ("CNC AG CIA Erfgo 10/08 0", "CNC AG CIA Erfgo"),
        ("POS ST VINCENTS 26/08 09", "POS ST VINCENTS"),
        ("CNC BOOTS 2718 10/06 12:", "CNC BOOTS 2718"),
        ("ATM Fiumicino Aer 09/04", "ATM Fiumicino Aer"),
    ],
)
def test_trailing_date_stamp_is_stripped(raw: str, expected: str) -> None:
    assert normalize_merchant_name(raw) == expected


def test_date_stamp_without_a_separating_space_is_stripped() -> None:
    """This feed sometimes runs the date straight onto the name."""
    assert normalize_merchant_name("ICT BENEDETTA POLL02/07") == "ICT BENEDETTA POLL"


def test_digits_belonging_to_the_name_are_kept() -> None:
    """Only the date goes; "DUBLIN 14 01" is part of what the shop is called."""
    assert normalize_merchant_name("ATM DUBLIN 14 01 23/03 1") == "ATM DUBLIN 14 01"


def test_ordinary_merchant_names_are_untouched() -> None:
    """Most merchants carry no stamp and must survive byte for byte."""
    for name in ("DD Electric Ireland", "Morton's", "Www.totalcycling.com", ""):
        assert normalize_merchant_name(name) == name


def test_two_visits_on_different_days_become_one_merchant() -> None:
    """The whole point: the same shop must not split by date."""
    first = apply_merchant_alias("POS ST VINCENTS 26/08 09", {})
    second = apply_merchant_alias("POS ST VINCENTS 14/03 11", {})

    assert first == second == "POS ST VINCENTS"


def test_an_explicit_alias_still_wins() -> None:
    """Hand-written aliases express intent and must outrank normalisation."""
    aliases = {r".*ST VINCENTS.*": "St Vincent's Hospital"}

    assert (
        apply_merchant_alias("POS ST VINCENTS 26/08 09", aliases)
        == "St Vincent's Hospital"
    )


def test_a_stamped_category_key_answers_to_its_stripped_name(tmp_path) -> None:
    """Categorisations made before normalisation must not be orphaned."""
    categories_file = tmp_path / "categories.json"
    categories_file.write_text(json.dumps({"CNC ROEBUCK PHAR 28/07 1": "Healthcare"}))

    with patch("expenses.data_handler.CATEGORIES_FILE", categories_file):
        categories = load_categories()

    assert categories["CNC ROEBUCK PHAR"] == "Healthcare"
    assert categories["CNC ROEBUCK PHAR 28/07 1"] == "Healthcare"
