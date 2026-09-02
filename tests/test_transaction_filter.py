import unittest
import pandas as pd
import numpy as np
from expenses.transaction_filter import apply_filters


class TestTransactionFilter(unittest.TestCase):

    def setUp(self) -> None:
        """Create a sample DataFrame for testing."""
        self.df = pd.DataFrame(
            {
                "date": pd.to_datetime(
                    ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
                ),
                "amount": [100.0, 200.0, 150.0, 300.0],
                "merchant": ["Starbucks", "Whole Foods", "Shell", "Amazon"],
                "category": ["Coffee", "Groceries", "Fuel", "Shopping"],
                "description": [
                    "Coffee purchase",
                    "Weekly groceries",
                    "Gas fill",
                    "Online order",
                ],
            }
        )

    def test_no_filters(self) -> None:
        """Test that empty filters return the original DataFrame."""
        result = apply_filters(self.df, {})
        pd.testing.assert_frame_equal(result, self.df)

    def test_greater_than_or_equal_filter(self) -> None:
        """Test >= operator on amount column."""
        filters = {"amount_filter": ("amount", ">=", 200.0)}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 2)
        self.assertTrue(all(result["amount"] >= 200.0))
        self.assertIn("Whole Foods", result["merchant"].values)
        self.assertIn("Amazon", result["merchant"].values)

    def test_less_than_or_equal_filter(self) -> None:
        """Test <= operator on amount column."""
        filters = {"amount_filter": ("amount", "<=", 150.0)}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 2)
        self.assertTrue(all(result["amount"] <= 150.0))
        self.assertIn("Starbucks", result["merchant"].values)
        self.assertIn("Shell", result["merchant"].values)

    def test_contains_filter(self) -> None:
        """Test contains operator on string column."""
        filters = {"merchant_filter": ("merchant", "contains", "food")}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["merchant"], "Whole Foods")

    def test_contains_filter_case_insensitive(self) -> None:
        """Test that contains operator is case-insensitive."""
        filters = {"merchant_filter": ("merchant", "contains", "STARBUCKS")}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["merchant"], "Starbucks")

    def test_equals_filter(self) -> None:
        """Test == operator on string column."""
        filters = {"category_filter": ("category", "==", "Groceries")}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["category"], "Groceries")

    def test_multiple_filters(self) -> None:
        """Test applying multiple filters together."""
        filters = {
            "amount_filter": ("amount", ">=", 150.0),
            "category_filter": ("category", "contains", "Shop"),
        }
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["merchant"], "Amazon")
        self.assertEqual(result.iloc[0]["amount"], 300.0)

    def test_filter_with_none_value(self) -> None:
        """Test that filters with None value are ignored."""
        filters = {"amount_filter": ("amount", ">=", None)}
        result = apply_filters(self.df, filters)

        pd.testing.assert_frame_equal(result, self.df)

    def test_filter_with_empty_string(self) -> None:
        """Test that filters with empty string are ignored."""
        filters = {"merchant_filter": ("merchant", "contains", "")}
        result = apply_filters(self.df, filters)

        pd.testing.assert_frame_equal(result, self.df)

    def test_filter_with_nan_value(self) -> None:
        """Test that filters with NaN value are ignored."""
        filters = {"amount_filter": ("amount", ">=", np.nan)}
        result = apply_filters(self.df, filters)

        pd.testing.assert_frame_equal(result, self.df)

    def test_filter_on_nonexistent_column(self) -> None:
        """Test that filtering on non-existent column raises KeyError."""
        filters = {"invalid_filter": ("nonexistent_column", "==", "value")}

        # The function doesn't catch KeyError, so it will be raised
        with self.assertRaises(KeyError):
            apply_filters(self.df, filters)

    def test_invalid_operator_comparison(self) -> None:
        """Test handling of invalid type comparisons."""
        filters = {"bad_filter": ("merchant", ">=", "string")}
        result = apply_filters(self.df, filters)

        # String comparison with >= works in pandas, returns empty result
        # since merchant strings are not >= "string"
        self.assertEqual(len(result), 0)

    def test_contains_with_special_characters(self) -> None:
        """Test contains filter with special regex characters."""
        df_special = pd.DataFrame(
            {"merchant": ["Store (Main)", "Store [Branch]", "Store.com"]}
        )
        filters = {"merchant_filter": ("merchant", "contains", "Store")}
        result = apply_filters(df_special, filters)

        self.assertEqual(len(result), 3)

    def test_empty_dataframe(self) -> None:
        """Test filtering an empty DataFrame."""
        empty_df = pd.DataFrame(columns=["date", "amount", "merchant"])
        filters = {"amount_filter": ("amount", ">=", 100.0)}
        result = apply_filters(empty_df, filters)

        self.assertEqual(len(result), 0)
        self.assertListEqual(list(result.columns), ["date", "amount", "merchant"])

    def test_date_filters(self) -> None:
        """Test filtering on date column."""
        filters = {"date_filter": ("date", ">=", pd.to_datetime("2024-01-03"))}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 2)
        self.assertTrue(all(result["date"] >= pd.to_datetime("2024-01-03")))

    def test_original_dataframe_unchanged(self) -> None:
        """Test that original DataFrame is not modified."""
        original_len = len(self.df)
        filters = {"amount_filter": ("amount", ">=", 200.0)}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(self.df), original_len)
        self.assertNotEqual(len(result), original_len)

    def test_all_filters_exclude_data(self) -> None:
        """Test when filters exclude all data."""
        filters = {"amount_filter": ("amount", ">=", 1000.0)}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 0)

    def test_contains_filter_with_na_values(self) -> None:
        """Test contains filter when DataFrame has NA values."""
        df_with_na = pd.DataFrame(
            {
                "merchant": ["Starbucks", None, "Amazon", pd.NA],
                "amount": [100.0, 200.0, 300.0, 400.0],
            }
        )
        filters = {"merchant_filter": ("merchant", "contains", "Amazon")}
        result = apply_filters(df_with_na, filters)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["merchant"], "Amazon")


def test_contains_filter_on_tags_column():
    df = pd.DataFrame({"Tags": ["emergency", "trip:x", "emergency,trip:y", ""]})
    filtered = apply_filters(df, {"tags": ("Tags", "contains", "trip:")})
    assert filtered["Tags"].tolist() == ["trip:x", "emergency,trip:y"]


if __name__ == "__main__":
    unittest.main()


class TestQuotedExactMatching(unittest.TestCase):
    """A quoted filter value means "this exactly", not "contains this"."""

    def setUp(self) -> None:
        self.df = pd.DataFrame(
            {
                "merchant": ["NS", "Bunsen", "AXA Insurance", "NS"],
                "category": ["Home", "Home Improvement", "Dining", "Home"],
            }
        )

    def test_quoted_value_excludes_substring_matches(self) -> None:
        """'NS' is a substring of Bunsen and Insurance; quoting must exclude them."""
        filters = {"merchant": ("merchant", "contains", '"NS"')}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 2)
        self.assertTrue(all(result["merchant"] == "NS"))

    def test_bare_value_still_matches_substrings(self) -> None:
        """Typing a bare value keeps searching, which is what it is for."""
        filters = {"merchant": ("merchant", "contains", "NS")}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 4)

    def test_quoted_value_is_case_insensitive(self) -> None:
        """Exactness is about the whole value, not about capitals."""
        filters = {"category": ("category", "contains", '"home"')}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 2)
        self.assertTrue(all(result["category"] == "Home"))

    def test_quoted_value_with_no_exact_match_returns_nothing(self) -> None:
        """A quoted near-miss must not silently fall back to substring."""
        filters = {"merchant": ("merchant", "contains", '"Insurance"')}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 0)

    def test_lone_quote_is_treated_as_text(self) -> None:
        """An unbalanced quote is a typo, not a mode switch."""
        filters = {"merchant": ("merchant", "contains", '"NS')}
        result = apply_filters(self.df, filters)

        self.assertEqual(len(result), 0)
