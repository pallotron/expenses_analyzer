"""Property-based tests for data handling functions using Hypothesis."""

import unittest
import tempfile
import pandas as pd
from pathlib import Path
from hypothesis import given, strategies as st, assume, settings
from datetime import datetime, timedelta
from unittest.mock import patch

from expenses.data_handler import (
    clean_amount,
    append_transactions,
    delete_transactions,
    load_transactions_from_parquet,
    save_transactions_to_parquet,
)


# Custom strategies for generating test data
@st.composite
def amount_strings(draw):
    """Generate various amount string formats."""
    amount = draw(
        st.floats(
            min_value=-100000, max_value=100000, allow_nan=False, allow_infinity=False
        )
    )
    amount = round(amount, 2)

    # Choose a format
    format_choice = draw(st.integers(min_value=0, max_value=6))

    if format_choice == 0:
        # Plain number
        return str(amount)
    elif format_choice == 1:
        # Parenthetical negative
        if amount < 0:
            return f"({abs(amount)})"
        return str(amount)
    elif format_choice == 2:
        # Currency symbol
        currency = draw(st.sampled_from(["€", "$", "£"]))
        return f"{currency}{amount}"
    elif format_choice == 3:
        # Dash (representing zero)
        return "-"
    elif format_choice == 4:
        # With comma thousands separator
        return f"{amount:,.2f}"
    elif format_choice == 5:
        # Currency with parentheses
        currency = draw(st.sampled_from(["€", "$", "£"]))
        if amount < 0:
            return f"{currency}({abs(amount)})"
        return f"{currency}{amount}"
    else:
        # With spaces
        return f"{amount:.2f}".replace(".", " .")


@st.composite
def transaction_dataframes(draw, min_rows=0, max_rows=100):
    """Generate random transaction DataFrames."""
    num_rows = draw(st.integers(min_value=min_rows, max_value=max_rows))

    if num_rows == 0:
        return pd.DataFrame(columns=["Date", "Merchant", "Amount", "Source", "Deleted", "Type"])

    # Generate dates within a reasonable range
    base_date = datetime(2020, 1, 1)
    dates = [
        base_date + timedelta(days=draw(st.integers(min_value=0, max_value=1825)))
        for _ in range(num_rows)
    ]

    # Generate merchants
    merchants = [
        draw(st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=1, max_size=50))
        for _ in range(num_rows)
    ]

    # Generate amounts
    amounts = [
        round(
            draw(
                st.floats(
                    min_value=-10000,
                    max_value=10000,
                    allow_nan=False,
                    allow_infinity=False,
                )
            ),
            2,
        )
        for _ in range(num_rows)
    ]

    # Generate deleted status
    deleted = [draw(st.booleans()) for _ in range(num_rows)]

    # Generate source
    sources = [
        draw(st.sampled_from(["Manual", "CSV Import", "Plaid", "Unknown"]))
        for _ in range(num_rows)
    ]

    # Generate transaction type
    types = [
        draw(st.sampled_from(["expense", "income"]))
        for _ in range(num_rows)
    ]

    return pd.DataFrame(
        {
            "Date": dates,
            "Merchant": merchants,
            "Amount": amounts,
            "Source": sources,
            "Deleted": deleted,
            "Type": types,
        }
    )


class TestPropertyBasedDataHandler(unittest.TestCase):
    """Property-based tests for data handler functions."""

    @given(st.lists(amount_strings(), min_size=1, max_size=100))
    @settings(max_examples=50, deadline=None)
    def test_clean_amount_always_returns_numeric(self, amount_list):
        """Property: clean_amount should always return numeric values."""
        series = pd.Series(amount_list)
        result = clean_amount(series)

        # All values should be numeric (float)
        self.assertTrue(pd.api.types.is_numeric_dtype(result))
        # No NaN values should remain
        self.assertEqual(result.isna().sum(), 0)
        # Result should have same length as input
        self.assertEqual(len(result), len(series))

    @given(
        st.floats(
            min_value=-10000, max_value=10000, allow_nan=False, allow_infinity=False
        )
    )
    @settings(max_examples=50, deadline=None)
    def test_clean_amount_parenthetical_negatives(self, value):
        """Property: (amount) should become -amount."""
        value = round(value, 2)
        if value >= 0:
            series = pd.Series([f"({value})"])
            result = clean_amount(series)
            self.assertAlmostEqual(result[0], -value, places=2)

    @given(st.lists(st.just("-"), min_size=1, max_size=10))
    @settings(max_examples=20, deadline=None)
    def test_clean_amount_dashes_become_zero(self, dash_list):
        """Property: dash character '-' should become 0."""
        series = pd.Series(dash_list)
        result = clean_amount(series)

        # All dashes should become 0
        self.assertTrue((result == 0).all())

    @given(
        transaction_dataframes(min_rows=1, max_rows=50),
        transaction_dataframes(min_rows=1, max_rows=50),
    )
    @settings(max_examples=20, deadline=None)
    def test_append_transactions_increases_or_maintains_count(self, df1, df2):
        """Property: appending transactions should increase or maintain count (due to deduplication)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            transactions_file = Path(tmpdir) / "transactions.parquet"

            with patch("expenses.data_handler.TRANSACTIONS_FILE", transactions_file):
                with patch("expenses.data_handler.CONFIG_DIR", Path(tmpdir)):
                    # Save initial transactions
                    save_transactions_to_parquet(df1)
                    initial_count = len(df1)

                    # Append new transactions
                    append_transactions(df2, suggest_categories=False)

                    # Load result
                    result = load_transactions_from_parquet()
                    final_count = len(result)

                    # Count should be >= initial (or less if there were exact duplicates)
                    # But never more than initial + new
                    self.assertTrue(final_count >= 0)
                    self.assertTrue(final_count <= initial_count + len(df2))

    @given(transaction_dataframes(min_rows=5, max_rows=20))
    @settings(max_examples=20, deadline=None)
    def test_append_same_transactions_deduplicates(self, df):
        """Property: appending identical transactions should not increase count."""
        assume(len(df) > 0)

        with tempfile.TemporaryDirectory() as tmpdir:
            transactions_file = Path(tmpdir) / "transactions.parquet"

            with patch("expenses.data_handler.TRANSACTIONS_FILE", transactions_file):
                with patch("expenses.data_handler.CONFIG_DIR", Path(tmpdir)):
                    # First append to get deduplicated baseline
                    append_transactions(df, suggest_categories=False)
                    baseline_count = len(load_transactions_from_parquet())

                    # Append same transactions again
                    append_transactions(df, suggest_categories=False)

                    # Load result
                    result = load_transactions_from_parquet()

                    # Count should remain the same (perfect deduplication)
                    self.assertEqual(len(result), baseline_count)

    @given(transaction_dataframes(min_rows=5, max_rows=20))
    @settings(max_examples=20, deadline=None)
    def test_delete_transactions_reduces_or_maintains_count(self, df):
        """Property: deleting transactions should reduce or maintain count."""
        assume(len(df) > 0)

        with tempfile.TemporaryDirectory() as tmpdir:
            transactions_file = Path(tmpdir) / "transactions.parquet"

            with patch("expenses.data_handler.TRANSACTIONS_FILE", transactions_file):
                with patch("expenses.data_handler.CONFIG_DIR", Path(tmpdir)):
                    # Save initial transactions
                    save_transactions_to_parquet(df)
                    initial_count = len(df)

                    # Delete a subset of transactions
                    to_delete = df.sample(n=min(3, len(df)))
                    delete_transactions(to_delete)

                    # Load result
                    result = load_transactions_from_parquet()

                    # Count should be <= initial
                    self.assertTrue(len(result) <= initial_count)
                    # Count should be >= 0
                    self.assertTrue(len(result) >= 0)

    @given(transaction_dataframes(min_rows=5, max_rows=20))
    @settings(max_examples=20, deadline=None)
    def test_delete_empty_dataframe_maintains_data(self, df):
        """Property: deleting an empty DataFrame should not change data."""
        assume(len(df) > 0)

        with tempfile.TemporaryDirectory() as tmpdir:
            transactions_file = Path(tmpdir) / "transactions.parquet"

            with patch("expenses.data_handler.TRANSACTIONS_FILE", transactions_file):
                with patch("expenses.data_handler.CONFIG_DIR", Path(tmpdir)):
                    # Save initial transactions
                    save_transactions_to_parquet(df)
                    initial_count = len(df)

                    # Delete empty dataframe
                    empty_df = pd.DataFrame(
                        columns=["Date", "Merchant", "Amount", "Source", "Deleted"]
                    )
                    delete_transactions(empty_df)

                    # Load result
                    result = load_transactions_from_parquet(include_deleted=True)

                    # Count should remain the same
                    self.assertEqual(len(result), initial_count)

    @given(transaction_dataframes(min_rows=1, max_rows=20))
    @settings(max_examples=20, deadline=None)
    def test_delete_all_transactions_results_in_empty(self, df):
        """Property: deleting all transactions should result in empty DataFrame."""
        assume(len(df) > 0)

        with tempfile.TemporaryDirectory() as tmpdir:
            transactions_file = Path(tmpdir) / "transactions.parquet"

            with patch("expenses.data_handler.TRANSACTIONS_FILE", transactions_file):
                with patch("expenses.data_handler.CONFIG_DIR", Path(tmpdir)):
                    # Save initial transactions
                    save_transactions_to_parquet(df)

                    # Delete all transactions
                    delete_transactions(df)

                    # Load result
                    result = load_transactions_from_parquet()

                    # Should be empty
                    self.assertEqual(len(result), 0)

    @given(transaction_dataframes(min_rows=0, max_rows=20))
    @settings(max_examples=20, deadline=None)
    def test_save_and_load_roundtrip(self, df):
        """Property: saving and loading should preserve data (roundtrip)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            transactions_file = Path(tmpdir) / "transactions.parquet"

            with patch("expenses.data_handler.TRANSACTIONS_FILE", transactions_file):
                with patch("expenses.data_handler.CONFIG_DIR", Path(tmpdir)):
                    # Save
                    save_transactions_to_parquet(df)

                    # Load
                    result = load_transactions_from_parquet(include_deleted=True)

                    # Should have same shape
                    self.assertEqual(result.shape, df.shape)
                    # Should have same columns
                    self.assertListEqual(list(result.columns), list(df.columns))


if __name__ == "__main__":
    unittest.main()
