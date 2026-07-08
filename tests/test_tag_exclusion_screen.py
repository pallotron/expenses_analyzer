import unittest

from expenses.screens.tag_exclusion_screen import build_pattern_options


class TestBuildPatternOptions(unittest.TestCase):

    def test_order_namespaces_then_tags_then_stale(self) -> None:
        options = build_pattern_options(
            tags_in_use=["emergency", "travel:rome-2026"],
            namespaces=["travel:"],
            excluded=["emergency", "old-tag"],
        )
        self.assertEqual(
            options,
            [
                ("travel:*", False),
                ("emergency", True),
                ("travel:rome-2026", False),
                ("old-tag", True),
            ],
        )

    def test_no_duplicates_when_excluded_matches_rows(self) -> None:
        options = build_pattern_options(
            tags_in_use=["travel:x"],
            namespaces=["travel:"],
            excluded=["travel:*"],
        )
        self.assertEqual(options, [("travel:*", True), ("travel:x", False)])

    def test_empty_inputs(self) -> None:
        self.assertEqual(build_pattern_options([], [], []), [])


if __name__ == "__main__":
    unittest.main()
