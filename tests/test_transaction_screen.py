from typing import Any, Dict
import pandas as pd
import pytest
from expenses.screens.transaction_screen import TransactionScreen


class MockInput:
    """A mock Input widget with a value attribute."""

    def __init__(self, value: str):
        self.value = value


@pytest.fixture
def transaction_screen() -> TransactionScreen:
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
def test_populate_table_filtering(transaction_screen: TransactionScreen, filters: Dict[str, str], expected_rows: int) -> None:
    """Test the filtering logic of the populate_table method."""
    data: Dict[str, Any] = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
    }
    df: pd.DataFrame = pd.DataFrame(data)
    transaction_screen.transactions = df
    # Set up categories mapping (Category column is added by populate_table)
    transaction_screen.categories = {
        "Merchant A": "Category 1",
        "Merchant B": "Category 2",
        "Merchant C": "Category 1",
    }

    # Mock the input widgets
    def query_one_mock(selector: str, type: Any) -> Any:
        filter_values: Dict[str, str] = {
            "#date_min_filter": "",
            "#date_max_filter": "",
            "#merchant_filter": "",
            "#amount_min_filter": "",
            "#amount_max_filter": "",
            "#category_filter": "",
        }
        for key, value in filters.items():
            filter_values[f"#{key}"] = value

        widgets: Dict[str, Any] = {
            "#transaction_table": MockDataTable(),
            "#total_display": MockStatic(),
        }
        for key, value in filter_values.items():
            widgets[key] = MockInput(value=value)

        return widgets[selector]

    transaction_screen.query_one = query_one_mock

    transaction_screen.populate_table()
    filtered_df: pd.DataFrame = transaction_screen.display_df
    assert len(filtered_df) == expected_rows


class MockDataTable:
    """A mock DataTable widget with a cursor_row attribute."""

    def __init__(self) -> None:
        self.cursor_row: int = 0
        self.columns: list[Dict[str, Any]] = []
        self.rows: list[Any] = []

    def clear(self, columns: bool = False) -> None:
        if columns:
            self.columns = []
        self.rows = []

    def add_column(self, label: str, key: str, width: int) -> None:
        self.columns.append({"label": label, "key": key, "width": width})

    def add_rows(self, rows: list[Any]) -> None:
        self.rows.extend(rows)

    def add_row(self, *row: Any, key: Any) -> None:
        self.rows.append({"key": key, "row": row})

    def move_cursor(self, row: int) -> None:
        self.cursor_row = row


class MockStatic:
    """A mock Static widget with an update method."""

    def update(self, content: Any) -> None:
        pass


def test_toggle_selection_keeps_cursor_position(transaction_screen: TransactionScreen) -> None:
    """Test that the cursor position is maintained after toggling a selection."""
    data: Dict[str, Any] = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
        "Category": ["Category 1", "Category 2", "Category 1"],
    }
    df: pd.DataFrame = pd.DataFrame(data)
    transaction_screen.display_df = df
    transaction_screen.transactions = df
    transaction_screen.categories = {}

    mock_table: MockDataTable = MockDataTable()
    mock_table.cursor_row = 1  # Set the cursor to the second row

    # Mock the query_one method to return our mock table and other widgets
    transaction_screen.query_one = lambda selector, type: {  # type: ignore[assignment]
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
