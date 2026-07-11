from typing import Any, Dict
from unittest.mock import Mock
import pandas as pd
import pytest
from expenses.screens.transaction_screen import TransactionScreen


class MockInput:
    """A mock Input widget with a value attribute."""

    def __init__(self, value: str):
        self.value = value


class MockButton:
    """A mock Button widget with label and variant attributes."""

    def __init__(self, label: str = "", variant: str = "default"):
        self.label = label
        self.variant = variant


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
def test_populate_table_filtering(
    transaction_screen: TransactionScreen, filters: Dict[str, str], expected_rows: int
) -> None:
    """Test the filtering logic of the populate_table method."""
    data: Dict[str, Any] = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
        "Source": ["CSV Import", "Plaid", "Manual"],
        "Deleted": [False, False, False],
        "Type": ["expense", "expense", "expense"],
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
            "#source_filter": "",
            "#category_filter": "",
            "#tags_filter": "",
        }
        for key, value in filters.items():
            filter_values[f"#{key}"] = value

        widgets: Dict[str, Any] = {
            "#transaction_table": MockDataTable(),
            "#merchant_summary_table": MockDataTable(),
            "#total_display": MockStatic(),
            "#select_all_button": MockButton(),
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

    def add_column(self, label: str, key: str = None, width: int = None) -> None:
        self.columns.append({"label": label, "key": key, "width": width})

    def add_rows(self, rows: list[Any]) -> None:
        self.rows.extend(rows)

    def add_row(self, *row: Any, key: Any = None) -> None:
        self.rows.append({"key": key, "row": row})

    def move_cursor(self, row: int) -> None:
        self.cursor_row = row


class MockStatic:
    """A mock Static widget with an update method."""

    def update(self, content: Any) -> None:
        pass


def test_toggle_selection_keeps_cursor_position(
    transaction_screen: TransactionScreen,
) -> None:
    """Test that the cursor position is maintained after toggling a selection."""
    data: Dict[str, Any] = {
        "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
        "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
        "Amount": [10.0, 20.0, 30.0],
        "Source": ["CSV Import", "Plaid", "Manual"],
        "Category": ["Category 1", "Category 2", "Category 1"],
        "Type": ["expense", "expense", "expense"],
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
        "#merchant_summary_table": MockDataTable(),
        "#total_display": MockStatic(),
        "#select_all_button": MockButton(),
        "#date_min_filter": MockInput(value=""),
        "#date_max_filter": MockInput(value=""),
        "#merchant_filter": MockInput(value=""),
        "#amount_min_filter": MockInput(value=""),
        "#amount_max_filter": MockInput(value=""),
        "#source_filter": MockInput(value=""),
        "#category_filter": MockInput(value=""),
        "#tags_filter": MockInput(value=""),
    }[selector]

    # Call the action
    transaction_screen.action_toggle_selection()

    # Assert that the cursor position is still the same
    assert mock_table.cursor_row == 1


def make_query_one(filter_values: Dict[str, str] | None = None):
    """Build a query_one mock plus the widget dict it serves."""
    values: Dict[str, str] = {
        "#date_min_filter": "",
        "#date_max_filter": "",
        "#merchant_filter": "",
        "#amount_min_filter": "",
        "#amount_max_filter": "",
        "#source_filter": "",
        "#category_filter": "",
        "#tags_filter": "",
    }
    if filter_values:
        values.update({f"#{key}": value for key, value in filter_values.items()})

    widgets: Dict[str, Any] = {
        "#transaction_table": MockDataTable(),
        "#merchant_summary_table": MockDataTable(),
        "#total_display": MockStatic(),
        "#select_all_button": MockButton(),
        "#budget_all_button": MockButton(),
        "#budget_essential_button": MockButton(),
        "#budget_discretionary_button": MockButton(),
        "#type_all_button": MockButton(),
        "#type_income_button": MockButton(),
        "#type_expense_button": MockButton(),
    }
    for key, value in values.items():
        widgets[key] = MockInput(value=value)

    return (lambda selector, type: widgets[selector]), widgets


def _budget_test_data(transaction_screen: TransactionScreen) -> None:
    """Three transactions: Category 1 is essential, Category 2 discretionary."""
    transaction_screen.transactions = pd.DataFrame(
        {
            "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
            "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
            "Amount": [10.0, 20.0, 30.0],
            "Source": ["CSV Import", "Plaid", "Manual"],
            "Deleted": [False, False, False],
            "Type": ["expense", "expense", "expense"],
        }
    )
    transaction_screen.categories = {
        "Merchant A": "Category 1",
        "Merchant B": "Category 2",
        "Merchant C": "Category 1",
    }
    transaction_screen.category_types = {
        "essential": {"categories": ["Category 1"], "annual_budget": None},
        "discretionary": {"categories": [], "annual_budget": None},
    }


def test_budget_column_derived_from_category(
    transaction_screen: TransactionScreen,
) -> None:
    """Budget column holds essential/discretionary and renders Ess./Discr."""
    _budget_test_data(transaction_screen)
    query_one, widgets = make_query_one()
    transaction_screen.query_one = query_one

    transaction_screen.populate_table()

    assert "Budget" in transaction_screen.display_df.columns
    budgets = dict(
        zip(
            transaction_screen.display_df["Merchant"],
            transaction_screen.display_df["Budget"],
        )
    )
    assert budgets == {
        "Merchant A": "essential",
        "Merchant B": "discretionary",
        "Merchant C": "essential",
    }

    # Rendered cells use the Summary screen abbreviations.
    table = widgets["#transaction_table"]
    column_labels = [col["key"] for col in table.columns]
    budget_idx = column_labels.index("Budget")
    rendered = {str(row["row"][1]): str(row["row"][budget_idx]) for row in table.rows}
    assert rendered == {
        "Merchant A": "Ess.",
        "Merchant B": "Discr.",
        "Merchant C": "Ess.",
    }


def test_budget_type_filter_masks_rows(
    transaction_screen: TransactionScreen,
) -> None:
    """filter_budget_type restricts display_df to matching budget types."""
    _budget_test_data(transaction_screen)
    query_one, _ = make_query_one()
    transaction_screen.query_one = query_one

    transaction_screen.filter_budget_type = "essential"
    transaction_screen.populate_table()
    assert len(transaction_screen.display_df) == 2
    assert set(transaction_screen.display_df["Budget"]) == {"essential"}

    transaction_screen.filter_budget_type = "discretionary"
    transaction_screen.populate_table()
    assert list(transaction_screen.display_df["Merchant"]) == ["Merchant B"]


def test_cycle_budget_type_cycles_and_updates_buttons(
    transaction_screen: TransactionScreen,
) -> None:
    """x-key action cycles All -> essential -> discretionary -> All."""
    query_one, widgets = make_query_one()
    transaction_screen.query_one = query_one
    transaction_screen.populate_table = Mock()

    assert transaction_screen.filter_budget_type is None

    transaction_screen.action_cycle_budget_type()
    assert transaction_screen.filter_budget_type == "essential"
    assert widgets["#budget_essential_button"].variant == "primary"
    assert widgets["#budget_all_button"].variant == "default"

    transaction_screen.action_cycle_budget_type()
    assert transaction_screen.filter_budget_type == "discretionary"
    assert widgets["#budget_discretionary_button"].variant == "primary"

    transaction_screen.action_cycle_budget_type()
    assert transaction_screen.filter_budget_type is None
    assert widgets["#budget_all_button"].variant == "primary"


def test_type_filter_masks_rows(
    transaction_screen: TransactionScreen,
) -> None:
    """filter_type restricts display_df to matching transaction types."""
    transaction_screen.transactions = pd.DataFrame(
        {
            "Date": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"]),
            "Merchant": ["Merchant A", "Merchant B", "Merchant C"],
            "Amount": [10.0, 20.0, 30.0],
            "Source": ["CSV Import", "Plaid", "Manual"],
            "Deleted": [False, False, False],
            "Type": ["income", "expense", "expense"],
        }
    )
    transaction_screen.categories = {}
    query_one, _ = make_query_one()
    transaction_screen.query_one = query_one

    transaction_screen.filter_type = "income"
    transaction_screen.populate_table()
    assert list(transaction_screen.display_df["Merchant"]) == ["Merchant A"]

    transaction_screen.filter_type = "expense"
    transaction_screen.populate_table()
    assert set(transaction_screen.display_df["Merchant"]) == {
        "Merchant B",
        "Merchant C",
    }


def test_type_buttons_set_filter(
    transaction_screen: TransactionScreen,
) -> None:
    """Type buttons set filter_type and sync button variants."""
    query_one, widgets = make_query_one()
    transaction_screen.query_one = query_one
    transaction_screen.populate_table = Mock()

    assert transaction_screen.filter_type is None

    transaction_screen._set_type_filter("income")
    assert transaction_screen.filter_type == "income"
    assert widgets["#type_income_button"].variant == "primary"
    assert widgets["#type_all_button"].variant == "default"

    transaction_screen._set_type_filter("expense")
    assert transaction_screen.filter_type == "expense"
    assert widgets["#type_expense_button"].variant == "primary"
    assert widgets["#type_income_button"].variant == "default"

    transaction_screen._set_type_filter(None)
    assert transaction_screen.filter_type is None
    assert widgets["#type_all_button"].variant == "primary"
    assert transaction_screen.populate_table.call_count == 3
