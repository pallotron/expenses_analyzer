import pandas as pd
import pytest

from expenses.analysis import calculate_trends, exclude_tagged_transactions, get_enhanced_savings_totals
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


def _payslips():
    return pd.DataFrame([
        {"Month": "2026-01", "Gross": 13681.25, "Net": 8200.0, "TaxTotal": 5000.0,
         "PensionEE": 1040.0, "AVC": 260.0, "PensionER": 1040.0,
         "Bonus": 0.0, "OnCall": 681.25, "SourceFiles": "a.pdf", "YTDReconciled": True},
        {"Month": "2026-02", "Gross": 14000.0, "Net": 8400.0, "TaxTotal": 5100.0,
         "PensionEE": 1040.0, "AVC": 260.0, "PensionER": 1040.0,
         "Bonus": 0.0, "OnCall": 0.0, "SourceFiles": "b.pdf", "YTDReconciled": True},
    ])


def test_enhanced_savings_single_month():
    bank = {"total_income": 8200.0, "total_expenses": 6200.0, "net": 2000.0,
            "savings_rate": 24.39}
    result = get_enhanced_savings_totals(bank, _payslips(), year=2026, month=1)
    assert result is not None
    assert result["pension_saved"] == 1040.0 + 260.0 + 1040.0        # 2340
    assert result["enhanced_saved"] == 2000.0 + 2340.0               # 4340
    # total-comp basis: 4340 / (Gross 13681.25 + PensionER 1040) = 29.48%
    assert round(result["rate_totalcomp"], 2) == 29.48
    # post-tax basis: 4340 / (Net 8200 + 2340) = 41.18%
    assert round(result["rate_posttax"], 2) == 41.18
    assert result["reconciled"] is True


def test_enhanced_savings_year_sums_months():
    bank = {"total_income": 16600.0, "total_expenses": 12000.0, "net": 4600.0,
            "savings_rate": 27.71}
    result = get_enhanced_savings_totals(bank, _payslips(), year=2026)
    assert result["pension_saved"] == 2 * 2340.0


def test_enhanced_savings_none_when_no_payslip():
    bank = {"total_income": 100.0, "total_expenses": 50.0, "net": 50.0,
            "savings_rate": 50.0}
    assert get_enhanced_savings_totals(bank, _payslips(), year=2099, month=5) is None
