import pandas as pd
import pytest
from expenses.screens.transaction_screen import TransactionScreen


class MockInput:
    """A mock Input widget with a value attribute."""
    def __init__(self, value: str):
        self.value = value


@pytest.fixture
def transaction_screen():
    """Fixture to create a TransactionScreen instance."""
    return TransactionScreen()


def test_apply_filters_to_transactions(transaction_screen):
    """Test the filtering logic of the _apply_filters_to_transactions method."""
    data = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
        "Category": ["Category 1", "Category 2", "Category 1"],
    }
    df = pd.DataFrame(data)

    # Mock the input widgets
    transaction_screen.query_one = lambda selector, type: {
        "#date_min_filter": MockInput(value="2025-01-02"),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value=""),
        "#category_filter": MockInput(value=""),
    }[selector]

    filtered_df = transaction_screen._apply_filters_to_transactions(df)
    assert len(filtered_df) == 2
    assert filtered_df["Date"].min() == pd.to_datetime("2025-01-02")

    transaction_screen.query_one = lambda selector, type: {
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value="2025-01-02"),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value=""),
        "#category_filter": MockInput(value=""),
    }[selector]

    filtered_df = transaction_screen._apply_filters_to_transactions(df)
    assert len(filtered_df) == 2
    assert filtered_df["Date"].max() == pd.to_datetime("2025-01-02")

    transaction_screen.query_one = lambda selector, type: {
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value="Merchant A"),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value=""),
        "#category_filter": MockInput(value=""),
    }[selector]

    filtered_df = transaction_screen._apply_filters_to_transactions(df)
    assert len(filtered_df) == 1
    assert filtered_df["Merchant"].iloc[0] == "Merchant A"

    transaction_screen.query_one = lambda selector, type: {
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value="15.0"),
        "#amount_max_filter": MockInput(value=""),
        "#category_filter": MockInput(value=""),
    }[selector]

    filtered_df = transaction_screen._apply_filters_to_transactions(df)
    assert len(filtered_df) == 2
    assert filtered_df["Amount"].min() == 20.0

    transaction_screen.query_one = lambda selector, type: {
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value="25.0"),
        "#category_filter": MockInput(value=""),
    }[selector]

    filtered_df = transaction_screen._apply_filters_to_transactions(df)
    assert len(filtered_df) == 2
    assert filtered_df["Amount"].max() == 20.0

    transaction_screen.query_one = lambda selector, type: {
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value=""),
        "#category_filter": MockInput(value="Category 1"),
    }[selector]

    filtered_df = transaction_screen._apply_filters_to_transactions(df)
    assert len(filtered_df) == 2
    assert all(filtered_df["Category"] == "Category 1")
