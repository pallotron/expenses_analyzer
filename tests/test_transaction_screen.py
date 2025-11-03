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


@pytest.mark.parametrize(
    "filters, expected_rows",
    [
        ({"date_min_filter": "2025-01-02"}, 2),
        ({"date_max_filter": "2025-01-02"}, 2),
        ({"merchant_filter": "Merchant A"}, 1),
        ({"amount_min_filter": "15.0"}, 2),
        ({"amount_max_filter": "25.0"}, 2),
        ({"category_filter": "Category 1"}, 2),
    ],
)
def test_populate_table_filtering(transaction_screen, filters, expected_rows):
    """Test the filtering logic of the populate_table method."""
    data = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
        "Category": ["Category 1", "Category 2", "Category 1"],
    }
    df = pd.DataFrame(data)
    transaction_screen.transactions = df
    transaction_screen.categories = {}

    # Mock the input widgets
    def query_one_mock(selector, type):
        filter_values = {
            "#date_min_filter": "",
            "#date_max_filter": "",
            "#merchant_filter": "",
            "#amount_min_filter": "",
            "#amount_max_filter": "",
            "#category_filter": "",
        }
        for key, value in filters.items():
            filter_values[f"#{key}"] = value

        widgets = {
            "#transaction_table": MockDataTable(),
            "#total_display": MockStatic(),
        }
        for key, value in filter_values.items():
            widgets[key] = MockInput(value=value)

        return widgets[selector]

    transaction_screen.query_one = query_one_mock

    transaction_screen.populate_table()
    filtered_df = transaction_screen.display_df
    assert len(filtered_df) == expected_rows


class MockDataTable:
    """A mock DataTable widget with a cursor_row attribute."""

    def __init__(self):
        self.cursor_row = 0
        self.columns = []
        self.rows = []

    def clear(self, columns=False):
        if columns:
            self.columns = []
        self.rows = []

    def add_column(self, label, key, width):
        self.columns.append({"label": label, "key": key, "width": width})

    def add_rows(self, rows):
        self.rows.extend(rows)

    def add_row(self, *row, key):
        self.rows.append({"key": key, "row": row})

    def move_cursor(self, row):
        self.cursor_row = row


class MockStatic:
    """A mock Static widget with an update method."""

    def update(self, content):
        pass


def test_toggle_selection_keeps_cursor_position(transaction_screen):
    """Test that the cursor position is maintained after toggling a selection."""
    data = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
        "Category": ["Category 1", "Category 2", "Category 1"],
    }
    df = pd.DataFrame(data)
    transaction_screen.display_df = df
    transaction_screen.transactions = df
    transaction_screen.categories = {}

    mock_table = MockDataTable()
    mock_table.cursor_row = 1  # Set the cursor to the second row

    # Mock the query_one method to return our mock table and other widgets
    transaction_screen.query_one = lambda selector, type: {
        "#transaction_table": mock_table,
        "#total_display": MockStatic(),
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value=""),
        "#category_filter": MockInput(value=""),
    }[selector]

    # Call the action
    transaction_screen.action_toggle_selection()

    # Assert that the cursor position is still the same
    assert mock_table.cursor_row == 1
