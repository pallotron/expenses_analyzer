import pandas as pd
import pytest

from expenses.analysis import calculate_trends, exclude_tagged_transactions
from typing import List, Tuple, cast


def test_increasing_trend() -> None:
    """Test a simple increasing list of numbers."""
    data: List[int] = [10, 20, 30, 40]
    expected: List[Tuple[float, str]] = [
        (10.0, "-"),
        (20.0, "↑"),
        (30.0, "↑"),
        (40.0, "↑"),
    ]
    assert calculate_trends(cast(List[float], data)) == expected


def test_decreasing_trend() -> None:
    """Test a simple decreasing list of numbers."""
    data: List[int] = [40, 30, 20, 10]
    expected: List[Tuple[float, str]] = [
        (40.0, "-"),
        (30.0, "↓"),
        (20.0, "↓"),
        (10.0, "↓"),
    ]
    assert calculate_trends(cast(List[float], data)) == expected


def test_stable_trend() -> None:
    """Test a list of numbers that are all the same."""
    data: List[int] = [50, 50, 50, 50]
    expected: List[Tuple[float, str]] = [
        (50.0, "-"),
        (50.0, "="),
        (50.0, "="),
        (50.0, "="),
    ]
    assert calculate_trends(cast(List[float], data)) == expected


def test_mixed_trend() -> None:
    """Test a list with a mix of increasing, decreasing, and stable trends."""
    data: List[int] = [25, 50, 50, 40, 80]
    expected: List[Tuple[float, str]] = [
        (25.0, "-"),
        (50.0, "↑"),
        (50.0, "="),
        (40.0, "↓"),
        (80.0, "↑"),
    ]
    assert calculate_trends(cast(List[float], data)) == expected


def test_with_zeros() -> None:
    """Test a list that includes zeros."""
    data: List[int] = [10, 0, 0, 10]
    expected: List[Tuple[float, str]] = [
        (10.0, "-"),
        (0.0, "↓"),
        (0.0, "="),
        (10.0, "↑"),
    ]
    assert calculate_trends(cast(List[float], data)) == expected


def test_empty_list() -> None:
    """Test an empty list, which should return an empty list."""
    data: List[int] = []
    expected: List[Tuple[float, str]] = []
    assert calculate_trends(cast(List[float], data)) == expected


def test_single_element_list() -> None:
    """Test a list with only one element."""
    data: List[int] = [100]
    expected: List[Tuple[float, str]] = [(100.0, "-")]
    assert calculate_trends(cast(List[float], data)) == expected


def test_exclude_tagged_transactions() -> None:
    df = pd.DataFrame(
        {
            "Date": pd.to_datetime(
                ["2026-03-13", "2026-03-14", "2026-03-15", "2026-03-16"]
            ),
            "Merchant": ["AerLingus", "Tesco", "Ryanair", "Refund Inc"],
            "Amount": [298.99, 12.00, 213.56, 50.00],
            "Type": ["expense", "expense", "expense", "income"],
            "Tags": ["emergency", "", "emergency,trip:x", "emergency"],
        }
    )
    filtered, hidden = exclude_tagged_transactions(df, ["emergency"])
    assert filtered["Merchant"].tolist() == ["Tesco"]
    # income row is excluded from view but NOT counted in hidden expense total
    assert hidden == pytest.approx(512.55)


def test_exclude_tagged_transactions_no_tags_column() -> None:
    df = pd.DataFrame({"Amount": [1.0], "Type": ["expense"]})
    filtered, hidden = exclude_tagged_transactions(df, ["emergency"])
    assert len(filtered) == 1
    assert hidden == 0.0


def test_exclude_tagged_transactions_empty_exclusion_list() -> None:
    df = pd.DataFrame({"Amount": [1.0], "Type": ["expense"], "Tags": ["emergency"]})
    filtered, hidden = exclude_tagged_transactions(df, [])
    assert len(filtered) == 1
    assert hidden == 0.0


def test_exclude_tagged_transactions_normalizes_excluded_tags() -> None:
    df = pd.DataFrame(
        {
            "Merchant": ["AerLingus", "Tesco"],
            "Amount": [298.99, 12.00],
            "Type": ["expense", "expense"],
            "Tags": ["emergency", ""],
        }
    )
    filtered, hidden = exclude_tagged_transactions(df, ["  Emergency "])
    assert filtered["Merchant"].tolist() == ["Tesco"]
    assert hidden == pytest.approx(298.99)


def test_exclude_tagged_transactions_prefix_pattern() -> None:
    df = pd.DataFrame(
        {
            "Date": pd.to_datetime(
                ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13"]
            ),
            "Merchant": ["AerLingus", "Conad", "Tesco", "Hotel"],
            "Amount": [312.85, 14.61, 12.00, 200.00],
            "Type": ["expense", "expense", "expense", "income"],
            "Tags": [
                "travel:paris-june-2026",
                "travel:rome-2026",
                "",
                "travel:rome-2026",
            ],
        }
    )
    filtered, hidden = exclude_tagged_transactions(df, ["emergency", "travel:*"])
    assert filtered["Merchant"].tolist() == ["Tesco"]
    # income row removed from view but not counted in hidden expense total
    assert hidden == pytest.approx(327.46)
