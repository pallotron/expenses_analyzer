import unittest

import pandas as pd

from expenses.tags import (
    add_tags_to_cell,
    all_tags_in_series,
    cell_matches_patterns,
    is_valid_pattern,
    join_tags,
    namespaces_in_series,
    normalize_pattern,
    normalize_tag,
    parse_tags,
    remove_tags_from_cell,
    series_has_tag,
    series_has_tag_prefix,
)


class TestTagHelpers(unittest.TestCase):

    def test_normalize_tag(self) -> None:
        self.assertEqual(normalize_tag("  Emergency "), "emergency")
        self.assertEqual(normalize_tag("Trip: Paris Jun26"), "trip:-paris-jun26")
        self.assertEqual(normalize_tag("trip:paris jun26"), "trip:paris-jun26")
        self.assertEqual(normalize_tag("we!rd@"), "werd")
        self.assertEqual(normalize_tag("   "), "")

    def test_parse_tags(self) -> None:
        self.assertEqual(parse_tags("emergency,trip:x"), ["emergency", "trip:x"])
        self.assertEqual(parse_tags(""), [])
        self.assertEqual(parse_tags(None), [])
        self.assertEqual(parse_tags(float("nan")), [])

    def test_join_tags_normalizes_and_dedups(self) -> None:
        self.assertEqual(
            join_tags(["Emergency", "emergency", "trip:x"]), "emergency,trip:x"
        )
        self.assertEqual(join_tags(["", "  "]), "")

    def test_add_and_remove_cell(self) -> None:
        self.assertEqual(add_tags_to_cell("", ["emergency"]), "emergency")
        self.assertEqual(add_tags_to_cell("emergency", ["trip:x"]), "emergency,trip:x")
        self.assertEqual(add_tags_to_cell("emergency", ["emergency"]), "emergency")
        self.assertEqual(
            remove_tags_from_cell("emergency,trip:x", ["emergency"]), "trip:x"
        )
        self.assertEqual(remove_tags_from_cell("trip:x", ["nope"]), "trip:x")

    def test_series_has_tag_exact_token(self) -> None:
        s = pd.Series(["emergency", "trip:x", "emergency,trip:x", "", None])
        self.assertEqual(
            series_has_tag(s, "emergency").tolist(), [True, False, True, False, False]
        )
        # exact token: "trip" must not match "trip:x"
        self.assertEqual(
            series_has_tag(s, "trip").tolist(), [False, False, False, False, False]
        )

    def test_series_has_tag_prefix(self) -> None:
        s = pd.Series(["trip:x", "trip:y,emergency", "emergency"])
        self.assertEqual(
            series_has_tag_prefix(s, "trip:").tolist(), [True, True, False]
        )

    def test_all_tags_in_series(self) -> None:
        s = pd.Series(["trip:x,emergency", "emergency", ""])
        self.assertEqual(all_tags_in_series(s), ["emergency", "trip:x"])

    def test_normalize_pattern(self) -> None:
        self.assertEqual(normalize_pattern("  Travel:* "), "travel:*")
        self.assertEqual(normalize_pattern("Emergency"), "emergency")
        self.assertEqual(normalize_pattern("*"), "*")

    def test_is_valid_pattern(self) -> None:
        self.assertTrue(is_valid_pattern("emergency"))
        self.assertTrue(is_valid_pattern("travel:*"))
        self.assertFalse(is_valid_pattern("*"))
        self.assertFalse(is_valid_pattern("tra*vel"))
        self.assertFalse(is_valid_pattern(""))
        self.assertFalse(is_valid_pattern("Travel:*"))  # not normalized

    def test_cell_matches_patterns(self) -> None:
        self.assertTrue(cell_matches_patterns("emergency", ["emergency"]))
        self.assertTrue(cell_matches_patterns("travel:x,emergency", ["travel:*"]))
        self.assertFalse(cell_matches_patterns("travel:x", ["emergency"]))
        self.assertFalse(cell_matches_patterns("", ["emergency"]))
        self.assertFalse(cell_matches_patterns(None, ["travel:*"]))
        self.assertFalse(cell_matches_patterns("travel:x", []))
        # normalization applied to patterns
        self.assertTrue(cell_matches_patterns("travel:x", ["  Travel:* "]))
        # bare "*" must not match everything (invalid prefix is ignored)
        self.assertFalse(cell_matches_patterns("travel:x", ["*"]))

    def test_namespaces_in_series(self) -> None:
        s = pd.Series(["travel:x,emergency", "travel:y", "work:conf", ""])
        self.assertEqual(namespaces_in_series(s), ["travel:", "work:"])


if __name__ == "__main__":
    unittest.main()
