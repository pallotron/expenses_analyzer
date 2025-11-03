from expenses.analysis import calculate_trends
from typing import List, Tuple, cast


def test_increasing_trend() -> None:
    """Test a simple increasing list of numbers."""
    data: List[int] = [10, 20, 30, 40]
    expected: List[Tuple[float, str]] = [(10.0, "-"), (20.0, "↑"), (30.0, "↑"), (40.0, "↑")]
    assert calculate_trends(cast(List[float], data)) == expected


def test_decreasing_trend() -> None:
    """Test a simple decreasing list of numbers."""
    data: List[int] = [40, 30, 20, 10]
    expected: List[Tuple[float, str]] = [(40.0, "-"), (30.0, "↓"), (20.0, "↓"), (10.0, "↓")]
    assert calculate_trends(cast(List[float], data)) == expected


def test_stable_trend() -> None:
    """Test a list of numbers that are all the same."""
    data: List[int] = [50, 50, 50, 50]
    expected: List[Tuple[float, str]] = [(50.0, "-"), (50.0, "="), (50.0, "="), (50.0, "=")]
    assert calculate_trends(cast(List[float], data)) == expected


def test_mixed_trend() -> None:
    """Test a list with a mix of increasing, decreasing, and stable trends."""
    data: List[int] = [25, 50, 50, 40, 80]
    expected: List[Tuple[float, str]] = [(25.0, "-"), (50.0, "↑"), (50.0, "="), (40.0, "↓"), (80.0, "↑")]
    assert calculate_trends(cast(List[float], data)) == expected


def test_with_zeros() -> None:
    """Test a list that includes zeros."""
    data: List[int] = [10, 0, 0, 10]
    expected: List[Tuple[float, str]] = [(10.0, "-"), (0.0, "↓"), (0.0, "="), (10.0, "↑")]
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
